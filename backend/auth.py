"""Google sign-in verification + server-side session handling.

Flow: the frontend uses Google Identity Services, obtains an ID token and
POSTs it here. We verify the signature/audience/expiry against Google's
keys, then issue a random opaque session token. Only the SHA-256 hash of
the token is stored, so a database leak does not leak usable sessions.
"""
import functools
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from flask import request, jsonify, g

from config import Config
from db import q, execute


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat()


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_google_credential(credential: str) -> dict:
    """Verify a Google ID token. Returns {'email','name','picture'}.

    Raises ValueError on any verification failure.
    NOTE for deployment: needs outbound access to www.googleapis.com
    (for Google's public certs). That domain is on the PythonAnywhere
    free-tier whitelist at the time of writing; verify before launch.
    """
    if not Config.GOOGLE_CLIENT_ID:
        raise ValueError("Server missing GOOGLE_CLIENT_ID")
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as grequests
        info = id_token.verify_oauth2_token(
            credential, grequests.Request(), Config.GOOGLE_CLIENT_ID)
    except Exception as exc:  # signature, expiry, audience, network
        raise ValueError(f"Invalid Google credential: {exc.__class__.__name__}")
    email = (info.get("email") or "").strip().lower()
    if not email or not info.get("email_verified", False):
        raise ValueError("Google account email not verified")
    return {
        "email": email,
        "name": (info.get("name") or email.split("@")[0])[:80],
        "picture": (info.get("picture") or "")[:500],
    }


def get_or_create_user(email: str, name: str, picture: str) -> dict:
    row = q("SELECT * FROM users WHERE email = ?", (email,), one=True)
    now = _iso(_now())
    if row is None:
        from economy import STARTING_COINS, START_RATING
        cur = execute(
            "INSERT INTO users (email, name, picture, coins, rating, created_at,"
            " last_login) VALUES (?,?,?,?,?,?,?)",
            (email, name, picture, STARTING_COINS, START_RATING, now, now))
        uid = cur.lastrowid
        execute("INSERT INTO transactions (user_id, delta, reason, created_at)"
                " VALUES (?,?,?,?)", (uid, STARTING_COINS, "welcome_grant", now))
        row = q("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    else:
        execute("UPDATE users SET name=?, picture=?, last_login=? WHERE id=?",
                (name, picture, now, row["id"]))
        row = q("SELECT * FROM users WHERE id = ?", (row["id"],), one=True)
    return dict(row)


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = _now()
    # Bound stolen-token exposure and session-table growth.
    execute("DELETE FROM sessions WHERE expires_at <= ?", (_iso(now),))
    rows = q("SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
    for row in rows[Config.MAX_SESSIONS_PER_USER - 1:]:
        execute("DELETE FROM sessions WHERE id = ?", (row["id"],))
    execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)"
        " VALUES (?,?,?,?)",
        (hash_token(token), user_id, _iso(now),
         _iso(now + timedelta(days=Config.SESSION_TTL_DAYS))))
    return token


def destroy_session(token: str):
    execute("DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),))


def current_user():
    """Resolve the bearer token to a user dict, or None."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    now = _iso(_now())
    row = q(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
        " WHERE s.token_hash = ? AND s.expires_at > ?",
        (hash_token(token), now), one=True)
    return dict(row) if row else None


def user_blocked_reason(user: dict):
    """Moderation gate: suspended or currently banned users cannot play."""
    if user.get("suspended"):
        return "החשבון מושהה. פנה למנהל האתר."
    bu = user.get("banned_until")
    if bu and bu > _iso(_now()):
        return f"החשבון חסום עד {bu}."
    return None


def require_auth(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"error": "unauthorized"}), 401
        g.user = user
        return fn(*args, **kwargs)
    return wrapper


def require_admin(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"error": "unauthorized"}), 401
        if user["email"].lower() != Config.ADMIN_EMAIL.lower():
            return jsonify({"error": "forbidden"}), 403
        g.user = user
        return fn(*args, **kwargs)
    return wrapper
