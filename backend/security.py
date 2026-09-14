"""Rate limiting (SQLite-backed) and HTTP security headers."""
import time
import hashlib
import secrets

from flask import request, jsonify

from config import Config
from db import get_db


def rate_limit(bucket: str, identity: str) -> bool:
    """Return True if the request is allowed under the configured limit."""
    limit, window = Config.RATE_LIMITS.get(bucket, Config.RATE_LIMITS["default"])
    key = f"{bucket}:{identity}"
    now = time.time()
    db = get_db()
    row = db.execute("SELECT * FROM rate_limits WHERE key = ?", (key,)).fetchone()
    if row is None or now - row["window_start"] > window:
        db.execute(
            "INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1)"
            " ON CONFLICT(key) DO UPDATE SET window_start=?, count=1",
            (key, now, now))
        db.commit()
        return True
    if row["count"] >= limit:
        return False
    db.execute("UPDATE rate_limits SET count = count + 1 WHERE key = ?", (key,))
    db.commit()
    return True


def limited(bucket):
    """Helper for routes: identity = user id when authed else client IP."""
    from flask import g
    ident = str(g.user["id"]) if getattr(g, "user", None) else request.remote_addr or "?"
    if not rate_limit(bucket, ident):
        return jsonify({"error": "rate_limited",
                        "error_he": "יותר מדי בקשות. נסה שוב בעוד דקה."}), 429
    return None


def request_ip_hash():
    """Pseudonymous abuse signal; never store a raw IP address."""
    ip = request.remote_addr or "unknown"
    return hashlib.sha256((Config.SECRET_KEY + ":" + ip).encode()).hexdigest()[:24]


def init_security(app):
    @app.before_request
    def reject_bad_requests():
        # Flask enforces MAX_CONTENT_LENGTH while parsing; reject unexpected
        # content types on state-changing API calls before route code runs.
        if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH"):
            if request.content_length and request.content_length > app.config["MAX_CONTENT_LENGTH"]:
                return jsonify({"error": "request_too_large"}), 413
            if request.content_length and not request.is_json:
                return jsonify({"error": "json_required"}), 415
        if request.method != "OPTIONS" and request.path.startswith("/api/"):
            origin = request.headers.get("Origin")
            if origin and origin not in Config.ALLOWED_ORIGINS:
                return jsonify({"error": "origin_not_allowed"}), 403
        return None

    @app.after_request
    def add_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        resp.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        resp.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        resp.headers["Cross-Origin-Resource-Policy"] = "same-site"
        resp.headers["X-Request-ID"] = request.headers.get("X-Request-ID", "")[:64] or secrets.token_hex(12)
        # CORS: only the configured frontend origins may call the API.
        origin = request.headers.get("Origin")
        if origin and origin in Config.ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
            resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        return resp

    @app.before_request
    def handle_preflight():
        if request.method == "OPTIONS":
            return "", 204
        return None
