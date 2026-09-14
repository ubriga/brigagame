"""Brigagame 2.0 by OrelAI - Flask backend.

Server-authoritative multiplayer artillery game. The client renders only;
every game rule, coin movement and validation happens here.
"""
import json
import secrets
import time
from datetime import datetime, timezone

from flask import Flask, g, jsonify, request

from auth import (create_session, current_user, destroy_session,
                  get_or_create_user, require_admin, require_auth,
                  user_blocked_reason, verify_google_credential)
from config import Config
from db import execute, get_db, init_db, q
from economy import (CATALOG, COINS_PER_DAMAGE, COINS_PER_LOSS, COINS_PER_WIN,
                     DAILY_BASE, DAILY_CAP, DAILY_STREAK_STEP, DEFAULT_SKIN,
                     MAX_HIT_COINS_PER_MATCH, elo_delta, rank_for)
from game_logic import (ai_choose_shot, cooldown_for, fire_weapon, new_state,
                        tower_hp)
from security import init_security, limited, request_ip_hash

app = Flask(__name__)
app.config.from_object(Config)
init_security(app)


@app.teardown_appcontext
def _close(exc):
    from db import close_db
    close_db(exc)


@app.cli.command("init-db")
def _init_db_cmd():
    init_db()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).date().isoformat()


def public_user(u):
    return {
        "id": u["id"], "name": u["name"], "picture": u["picture"],
        "coins": u["coins"], "rating": u["rating"],
        "rank": rank_for(u["rating"]),
        "wins": u["wins"], "losses": u["losses"],
        "matches_played": u["matches_played"],
        "is_admin": u["email"].lower() == Config.ADMIN_EMAIL.lower(),
    }




def audit(action, target_type="", target_id="", details=None, actor_id=None):
    """Append-only, privacy-minimized operator/security activity record."""
    safe = details if isinstance(details, dict) else {}
    # Keep the operational log bounded while meeting the two-year benchmark
    # in the Israeli Privacy Protection Authority's Reg. 10 guidance.
    execute("DELETE FROM audit_logs WHERE created_at < datetime('now', '-2 years')")
    execute("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id,"
            " details, ip_hash, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?)",
            (actor_id if actor_id is not None else (getattr(g, "user", {}) or {}).get("id"),
             str(action)[:80], str(target_type)[:40], str(target_id)[:120],
             json.dumps(safe, ensure_ascii=False)[:2000], request_ip_hash(),
             request.headers.get("User-Agent", "")[:300], _now_iso()))

def add_coins(user_id, delta, reason, ref=""):
    """Single place where coins move. Writes the ledger row too."""
    execute("UPDATE users SET coins = coins + ? WHERE id = ?", (delta, user_id))
    execute("INSERT INTO transactions (user_id, delta, reason, ref, created_at)"
            " VALUES (?,?,?,?,?)", (user_id, delta, reason, ref, _now_iso()))


def user_mods(user_id):
    rows = q("SELECT item_id, level, equipped FROM user_items WHERE user_id = ?",
             (user_id,))
    mods = {"armor": 0, "hp": 0, "skin": None}
    for r in rows:
        if r["item_id"] == "armor":
            mods["armor"] = r["level"]
        elif r["item_id"] == "reinforced_hp":
            mods["hp"] = r["level"]
        elif r["equipped"]:
            mods["skin"] = r["item_id"]
    return mods


def skin_style(skin_id):
    item = CATALOG.get(skin_id, DEFAULT_SKIN)
    # Keep colors in the payload for older cached clients while richer clients
    # use the style data. This makes rolling deploys safe mid-match.
    return {"colors": item["colors"], **item["style"]}


def emit_events(match_id, version, events):
    now = _now_iso()
    for ev in events:
        execute("INSERT INTO match_events (match_id, version, type, data,"
                " created_at) VALUES (?,?,?,?,?)",
                (match_id, version, ev.get("type", "event"),
                 json.dumps(ev), now))


def load_match(mid):
    m = q("SELECT * FROM matches WHERE id = ?", (mid,), one=True)
    if m:
        m = dict(m)
        m["state"] = json.loads(m["state"] or "{}")
    return m


def save_match(m):
    execute("UPDATE matches SET state = ?, version = ?, status = ?, winner = ?,"
            " updated_at = ? WHERE id = ?",
            (json.dumps(m["state"]), m["version"], m["status"], m.get("winner"),
             _now_iso(), m["id"]))


def finalize_match(m, winner_side):
    """Apply win/loss rewards, hit coins and rating. Server-side only."""
    loser_side = "p2" if winner_side == "p1" else "p1"
    m["status"] = "finished"
    m["winner"] = m[winner_side] if not (winner_side == "p2" and m["p2_ai"]) else None
    m["state"]["winner_side"] = winner_side
    results = {}
    for side, outcome in ((winner_side, "win"), (loser_side, "loss")):
        uid = m[side]
        if uid is None or (side == "p2" and m["p2_ai"]):
            results[side] = {"outcome": outcome, "ai": True}
            continue
        dmg = m["state"]["damage_dealt"][side]
        hit_coins = min(MAX_HIT_COINS_PER_MATCH,
                        int(dmg * COINS_PER_DAMAGE))
        base = COINS_PER_WIN if outcome == "win" else COINS_PER_LOSS
        total = base + hit_coins
        add_coins(uid, total, f"match_{outcome}", m["id"])
        other = m[loser_side if side == winner_side else winner_side]
        u = q("SELECT rating FROM users WHERE id = ?", (uid,), one=True)
        o = q("SELECT rating FROM users WHERE id = ?", (other,), one=True) \
            if other else None
        my_r, their_r = u["rating"], (o["rating"] if o else 1000)
        if outcome == "win":
            delta = elo_delta(my_r, their_r)
            execute("UPDATE users SET rating = rating + ?, wins = wins + 1,"
                    " matches_played = matches_played + 1 WHERE id = ?",
                    (delta, uid))
        else:
            delta = elo_delta(their_r, my_r)
            execute("UPDATE users SET rating = MAX(0, rating - ?),"
                    " losses = losses + 1,"
                    " matches_played = matches_played + 1 WHERE id = ?",
                    (delta, uid))
        results[side] = {"outcome": outcome, "coins": total,
                         "hit_coins": hit_coins,
                         "rating_delta": delta if outcome == "win" else -delta}
    m["state"]["results"] = results


def side_for(m, user_id):
    if m["p1"] == user_id:
        return "p1"
    if m["p2"] == user_id:
        return "p2"
    return None


def match_snapshot(m, user_id, since):
    state = m["state"]
    rows = q("SELECT version, data FROM match_events WHERE match_id = ?"
             " AND version > ? ORDER BY version, id", (m["id"], since))
    events = [json.loads(r["data"]) for r in rows]
    players = {}
    for side in ("p1", "p2"):
        uid = m[side]
        if uid:
            u = q("SELECT id, name, picture, rating FROM users WHERE id = ?",
                  (uid,), one=True)
            players[side] = {"id": u["id"], "name": u["name"],
                             "picture": u["picture"], "rating": u["rating"],
                             "rank": rank_for(u["rating"])}
        elif side == "p2" and m["p2_ai"]:
            players[side] = {"id": None, "name": "OrelAI Bot", "picture": "",
                             "rating": None, "rank": "AI"}
    mods = state.get("mods", {})
    return {
        "id": m["id"], "code": m["code"], "mode": m["mode"],
        "status": m["status"], "version": m["version"],
        "you": side_for(m, user_id),
        "players": players,
        "towers": state.get("towers"),
        # Waiting matches intentionally have no battlefield yet. Returning null
        # instead of calculating against {} keeps the waiting screen healthy.
        "tower_hp": ({side: tower_hp(state, side) for side in ("p1", "p2")}
                     if state.get("towers") else None),
        "wind": state.get("wind"),
        "damage_dealt": state.get("damage_dealt"),
        "skins": {s: skin_style(mods.get(s, {}).get("skin")) for s in ("p1", "p2")},
        "last_shot_at": state.get("last_shot_at"),
        "winner_side": state.get("winner_side"),
        "results": state.get("results"),
        "ready": state.get("ready", {}),
        "ai_difficulty": state.get("ai_difficulty"),
        "server_time": time.time(),
        "events": events,
    }


def claim_waiting_match(match_id, user_id):
    """Atomically claim a waiting match slot; returns True on success."""
    cur = execute("UPDATE matches SET p2 = ?, status = 'active' WHERE id = ?"
                  " AND status = 'waiting' AND p1 != ? AND p2 IS NULL",
                  (user_id, match_id, user_id))
    return cur.rowcount == 1


def sweep_expired_offers():
    """Expire offers. An unanswered invite counts as a pass for that match so
    matchmaking moves on to other present players instead of re-pinging."""
    now = time.time()
    execute("INSERT OR IGNORE INTO match_offer_declines (match_id, user_id, created_at)"
            " SELECT match_id, invited_user_id, ? FROM match_offers"
            " WHERE expires_at <= ?", (_now_iso(), now))
    execute("DELETE FROM match_offers WHERE expires_at <= ?", (now,))
    execute("DELETE FROM match_offer_declines"
            " WHERE created_at < datetime('now', '-1 day')")


_sweep_last_run = 0.0


def sweep_stale_matches():
    """End matches whose players silently walked away. An 'active' match with
    no state change for ACTIVE_MATCH_STALE_SECONDS is abandoned: abort it as a
    void outcome (never a ranked loss, no coin movement) so both players become
    eligible for quick-match invites again. A 'waiting' match whose owner
    stopped polling for WAITING_MATCH_STALE_SECONDS will never find an
    opponent: purge it like a player leaving the lobby. Free tier has no
    always-on task runner, so API traffic carries this sweep, throttled to one
    run per STALE_SWEEP_INTERVAL_SECONDS per worker."""
    global _sweep_last_run
    now = time.time()
    if now - _sweep_last_run < Config.STALE_SWEEP_INTERVAL_SECONDS:
        return
    _sweep_last_run = now
    active_cutoff = datetime.fromtimestamp(
        now - Config.ACTIVE_MATCH_STALE_SECONDS, timezone.utc).isoformat()
    waiting_cutoff = datetime.fromtimestamp(
        now - Config.WAITING_MATCH_STALE_SECONDS, timezone.utc).isoformat()
    aborted = 0
    stale = q("SELECT id FROM matches WHERE status = 'active'"
              " AND updated_at < ?", (active_cutoff,))
    for row in stale:
        # Claim the row first so two workers can never abort it twice.
        cur = execute("UPDATE matches SET status = 'aborted', winner = NULL,"
                      " version = version + 1, updated_at = ? WHERE id = ?"
                      " AND status = 'active'", (_now_iso(), row["id"]))
        if cur.rowcount != 1:
            continue
        m = load_match(row["id"])
        m["state"]["abort_reason"] = "stale_inactivity"
        m["state"]["winner_side"] = None
        m["state"]["results"] = {"p1": {"outcome": "void"},
                                 "p2": {"outcome": "void"}}
        save_match(m)
        emit_events(m["id"], m["version"],
                    [{"type": "match_abort", "reason": "stale_inactivity"}])
        aborted += 1
    execute("DELETE FROM match_offers WHERE match_id IN"
            " (SELECT id FROM matches WHERE status = 'waiting'"
            "  AND updated_at < ?)", (waiting_cutoff,))
    cur = execute("DELETE FROM matches WHERE status = 'waiting'"
                  " AND updated_at < ?", (waiting_cutoff,))
    purged = cur.rowcount
    if aborted or purged:
        audit("stale_match_sweep", "matches", "",
              {"aborted_active": aborted, "purged_waiting": purged})


@app.before_request
def _stale_match_housekeeping():
    if request.path.startswith("/api/"):
        sweep_stale_matches()


def offer_to_present_player(match_id, owner_id):
    """Offer a waiting quick match to a random player who is present anywhere
    in the app (heartbeat-active), even if they never clicked quick match.
    The accept/decline prompt remains the consent mechanism: this function
    only reserves the match; joining happens solely via /accept.
    Returns True when an invite was created."""
    now = time.time()
    sweep_expired_offers()
    live = q("SELECT 1 FROM match_offers WHERE match_id = ? AND expires_at > ?",
             (match_id, now), one=True)
    if live:
        return False
    now_iso = _now_iso()
    presence_cutoff = datetime.fromtimestamp(
        now - Config.PRESENCE_WINDOW_SECONDS, timezone.utc).isoformat()
    cooldown_cutoff = datetime.fromtimestamp(
        now - Config.INVITE_COOLDOWN_SECONDS, timezone.utc).isoformat()
    live_waiting_cutoff = datetime.fromtimestamp(now - 10, timezone.utc).isoformat()
    row = q("SELECT u.id FROM users u WHERE u.id != ?"
            " AND u.last_seen IS NOT NULL AND u.last_seen >= ?"
            " AND u.suspended = 0"
            " AND (u.banned_until IS NULL OR u.banned_until <= ?)"
            # not already holding a live invite
            " AND NOT EXISTS (SELECT 1 FROM match_offers o"
            "  WHERE o.invited_user_id = u.id AND o.expires_at > ?)"
            # not declined/timed-out for this match, and no recent decline anywhere
            " AND NOT EXISTS (SELECT 1 FROM match_offer_declines d"
            "  WHERE d.user_id = u.id AND (d.match_id = ? OR d.created_at >= ?))"
            # not busy inside an active match
            " AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.status = 'active'"
            "  AND (m.p1 = u.id OR m.p2 = u.id))"
            # not actively waiting for an opponent in their own match
            " AND NOT EXISTS (SELECT 1 FROM matches m2 WHERE m2.status = 'waiting'"
            "  AND m2.p1 = u.id AND m2.updated_at >= ?)"
            " ORDER BY RANDOM() LIMIT 1",
            (owner_id, presence_cutoff, now_iso, now, match_id,
             cooldown_cutoff, live_waiting_cutoff), one=True)
    if not row:
        return False
    try:
        execute("INSERT INTO match_offers (match_id, invited_user_id,"
                " expires_at, created_at) VALUES (?,?,?,?)",
                (match_id, row["id"], now + Config.OFFER_TTL_SECONDS, now_iso))
        return True
    except Exception:
        # Another request reserved the match first.
        return False


# --------------------------------------------------------------- auth
@app.post("/api/auth/google")
def auth_google():
    err = limited("auth")
    if err:
        return err
    cred = (request.get_json(silent=True) or {}).get("credential", "")
    if not cred:
        return jsonify({"error": "missing_credential"}), 400
    try:
        info = verify_google_credential(cred)
    except ValueError as exc:
        audit("auth.google_failed", details={"reason": str(exc)[:80]})
        return jsonify({"error": "invalid_credential"}), 401
    user = get_or_create_user(info["email"], info["name"], info["picture"])
    blocked = user_blocked_reason(user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    token = create_session(user["id"])
    audit("auth.login", "user", user["id"], actor_id=user["id"])
    return jsonify({"token": token, "user": public_user(user)})


@app.post("/api/auth/dev")
def auth_dev():
    """Local development login only. Disabled unless DEV_AUTH=1."""
    if not Config.DEV_AUTH:
        return jsonify({"error": "disabled"}), 404
    err = limited("auth")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"error": "bad_email"}), 400
    user = get_or_create_user(email, body.get("name", email.split("@")[0]), "")
    token = create_session(user["id"])
    return jsonify({"token": token, "user": public_user(user)})


@app.post("/api/auth/logout")
@require_auth
def auth_logout():
    auth = request.headers.get("Authorization", "")
    audit("auth.logout", "user", g.user["id"])
    destroy_session(auth[7:].strip())
    return jsonify({"ok": True})


@app.get("/api/me")
@require_auth
def me():
    u = g.user
    inv = {r["item_id"]: {"qty": r["qty"], "level": r["level"],
                          "equipped": bool(r["equipped"])}
           for r in q("SELECT item_id, qty, level, equipped FROM user_items"
                      " WHERE user_id = ?", (u["id"],))}
    today = _today()
    return jsonify({"user": public_user(u), "server_version": Config.SERVER_VERSION,
                    "maintenance": get_maintenance(), "inventory": inv,
                    "daily_available": u["last_daily"] != today,
                    "streak": u["streak"], "server_date": today})


# --------------------------------------------------------------- store
@app.get("/api/store")
@require_auth
def store_get():
    err = limited("store")
    if err:
        return err
    inv = {r["item_id"]: {"qty": r["qty"], "level": r["level"],
                          "equipped": bool(r["equipped"])}
           for r in q("SELECT item_id, qty, level, equipped FROM user_items"
                      " WHERE user_id = ?", (g.user["id"],))}
    return jsonify({"catalog": CATALOG, "inventory": inv,
                    "coins": g.user["coins"]})


@app.post("/api/store/buy")
@require_auth
def store_buy():
    err = limited("store")
    if err:
        return err
    blocked = user_blocked_reason(g.user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    item_id = (request.get_json(silent=True) or {}).get("item_id", "")
    item = CATALOG.get(item_id)
    if not item:
        return jsonify({"error": "unknown_item"}), 400
    uid = g.user["id"]
    owned = q("SELECT * FROM user_items WHERE user_id = ? AND item_id = ?",
              (uid, item_id), one=True)
    if item["kind"] == "skin" and owned:
        return jsonify({"error": "already_owned",
                        "error_he": "כבר בבעלותך."}), 400
    if item["kind"] == "upgrade":
        level = owned["level"] if owned else 0
        if level >= item["max_level"]:
            return jsonify({"error": "max_level",
                            "error_he": "רמה מקסימלית."}), 400
        price = item["prices"][level]
    else:
        price = item["price"]
    # atomic balance check: debit only if funds suffice
    cur = execute("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?",
                  (price, uid, price))
    if cur.rowcount != 1:
        return jsonify({"error": "insufficient_funds",
                        "error_he": "אין מספיק מטבעות."}), 400
    execute("INSERT INTO transactions (user_id, delta, reason, ref, created_at)"
            " VALUES (?,?,?,?,?)", (uid, -price, "purchase", item_id, _now_iso()))
    if item["kind"] == "consumable":
        execute("INSERT INTO user_items (user_id, item_id, qty) VALUES (?,?,?)"
                " ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?",
                (uid, item_id, item["pack_shots"], item["pack_shots"]))
    elif item["kind"] == "upgrade":
        execute("INSERT INTO user_items (user_id, item_id, level) VALUES (?,?,1)"
                " ON CONFLICT(user_id, item_id) DO UPDATE SET level = level + 1",
                (uid, item_id))
    else:  # skin
        execute("INSERT INTO user_items (user_id, item_id, qty) VALUES (?,?,1)",
                (uid, item_id))
        # A purchased skin applies immediately: equip it on the spot so the
        # buyer sees it in the very next match without hunting for an equip
        # button (the "bought a skin and nothing changed" report).
        execute("UPDATE user_items SET equipped = 0 WHERE user_id = ? AND"
                " item_id LIKE 'skin_%'", (uid,))
        execute("UPDATE user_items SET equipped = 1 WHERE user_id = ? AND item_id = ?",
                (uid, item_id))
    u = q("SELECT coins FROM users WHERE id = ?", (uid,), one=True)
    audit("user.purchase", "item", item_id, {"price": price})
    return jsonify({"ok": True, "coins": u["coins"], "spent": price})


@app.post("/api/store/equip")
@require_auth
def store_equip():
    err = limited("mutation")
    if err:
        return err
    item_id = (request.get_json(silent=True) or {}).get("item_id", "")
    item = CATALOG.get(item_id)
    if not item or item["kind"] != "skin":
        return jsonify({"error": "unknown_item"}), 400
    uid = g.user["id"]
    owned = q("SELECT 1 FROM user_items WHERE user_id = ? AND item_id = ?",
              (uid, item_id), one=True)
    if not owned:
        return jsonify({"error": "not_owned"}), 400
    execute("UPDATE user_items SET equipped = 0 WHERE user_id = ? AND"
            " item_id LIKE 'skin_%'", (uid,))
    execute("UPDATE user_items SET equipped = 1 WHERE user_id = ? AND item_id = ?",
            (uid, item_id))
    return jsonify({"ok": True})


@app.post("/api/daily/claim")
@require_auth
def daily_claim():
    err = limited("mutation")
    if err:
        return err
    uid = g.user["id"]
    today = _today()
    u = q("SELECT last_daily, streak FROM users WHERE id = ?", (uid,), one=True)
    if u["last_daily"] == today:
        return jsonify({"error": "already_claimed",
                        "error_he": "כבר אספת היום. חזור מחר!"}), 400
    from datetime import timedelta
    yesterday = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
    streak = u["streak"] + 1 if u["last_daily"] == yesterday else 1
    amount = min(DAILY_BASE + (streak - 1) * DAILY_STREAK_STEP, DAILY_CAP)
    execute("UPDATE users SET last_daily = ?, streak = ? WHERE id = ?",
            (today, streak, uid))
    add_coins(uid, amount, "daily_bonus")
    audit("user.daily_claim", "user", uid, {"amount": amount, "streak": streak})
    return jsonify({"ok": True, "amount": amount, "streak": streak})


# --------------------------------------------------------------- coupons
@app.post("/api/coupons/redeem")
@require_auth
def coupon_redeem():
    err = limited("mutation")
    if err:
        return err
    code = ((request.get_json(silent=True) or {}).get("code") or "").strip().upper()
    if not code:
        return jsonify({"error": "missing_code"}), 400
    uid = g.user["id"]
    c = q("SELECT * FROM coupons WHERE code = ?", (code,), one=True)
    if not c:
        return jsonify({"error": "invalid_code", "error_he": "קופון לא תקין."}), 400
    if c["expires_at"] and c["expires_at"] < _now_iso():
        return jsonify({"error": "expired", "error_he": "הקופון פג תוקף."}), 400
    already = q("SELECT 1 FROM coupon_redemptions WHERE code = ? AND user_id = ?",
                (code, uid), one=True)
    if already:
        return jsonify({"error": "already_redeemed",
                        "error_he": "כבר מימשת את הקופון."}), 400
    cur = execute("UPDATE coupons SET uses = uses + 1 WHERE code = ?"
                  " AND uses < max_uses", (code,))
    if cur.rowcount != 1:
        return jsonify({"error": "exhausted",
                        "error_he": "הקופון מוצה."}), 400
    execute("INSERT INTO coupon_redemptions (code, user_id, redeemed_at)"
            " VALUES (?,?,?)", (code, uid, _now_iso()))
    if c["kind"] == "coins":
        add_coins(uid, c["amount"], "coupon", code)
        reward = f"{c['amount']} מטבעות"
    else:
        item = CATALOG.get(c["item_id"])
        if not item:
            return jsonify({"error": "invalid_code"}), 400
        qty = item.get("pack_shots", 1)
        execute("INSERT INTO user_items (user_id, item_id, qty) VALUES (?,?,?)"
                " ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + ?",
                (uid, c["item_id"], qty, qty))
        reward = item["name_he"]
    u = q("SELECT coins FROM users WHERE id = ?", (uid,), one=True)
    audit("user.coupon_redeem", "coupon", code)
    return jsonify({"ok": True, "reward": reward, "coins": u["coins"]})


# --------------------------------------------------------------- messages
@app.get("/api/messages")
@require_auth
def messages_get():
    rows = q("SELECT m.*, r.read_at FROM messages m LEFT JOIN message_reads r"
             " ON r.message_id = m.id AND r.user_id = ?"
             " WHERE m.user_id IS NULL OR m.user_id = ?"
             " ORDER BY m.id DESC LIMIT 50", (g.user["id"], g.user["id"]))
    out = []
    ids = []
    for r in rows:
        out.append({"id": r["id"], "title": r["title"], "body": r["body"],
                    "created_at": r["created_at"], "read": bool(r["read_at"])})
        if not r["read_at"]:
            ids.append(r["id"])
    for mid in ids:
        execute("INSERT OR IGNORE INTO message_reads (message_id, user_id,"
                " read_at) VALUES (?,?,?)", (mid, g.user["id"], _now_iso()))
    return jsonify({"messages": out})


def get_maintenance():
    """Site-wide maintenance banner state (D1). Stored as one settings row so
    it survives restarts and is editable from the admin area."""
    row = q("SELECT value FROM settings WHERE key = 'maintenance'", one=True)
    if not row:
        return {"on": False, "message": ""}
    try:
        d = json.loads(row["value"])
        return {"on": bool(d.get("on")),
                "message": str(d.get("message", ""))[:300]}
    except (ValueError, TypeError):
        return {"on": False, "message": ""}


# --------------------------------------------------------------- presence
@app.post("/api/presence/ping")
@require_auth
def presence_ping():
    """App-wide presence pulse. Marks the player as present (so quick matches
    can invite them from any screen) and returns any pending match offer."""
    err = limited("state")
    if err:
        return err
    uid = g.user["id"]
    execute("UPDATE users SET last_seen = ? WHERE id = ?", (_now_iso(), uid))
    now = time.time()
    offer = q("SELECT match_id, expires_at FROM match_offers"
              " WHERE invited_user_id = ? AND expires_at > ?"
              " ORDER BY expires_at DESC LIMIT 1", (uid, now), one=True)
    unread = q("SELECT COUNT(*) c FROM messages m LEFT JOIN message_reads r"
               " ON r.message_id = m.id AND r.user_id = ?"
               " WHERE (m.user_id IS NULL OR m.user_id = ?)"
               " AND r.read_at IS NULL", (uid, uid), one=True)["c"]
    out = {"ok": True, "offer": None, "unread_messages": unread,
           "server_version": Config.SERVER_VERSION,
           "maintenance": get_maintenance()}
    if offer:
        out["offer"] = {"match_id": offer["match_id"],
                        "expires_in": max(1, int(offer["expires_at"] - now))}
    return jsonify(out)


# --------------------------------------------------------------- matchmaking
@app.post("/api/matches/quick")
@require_auth
def match_quick():
    err = limited("mutation")
    if err:
        return err
    blocked = user_blocked_reason(g.user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    uid = g.user["id"]
    now = time.time()
    # Offers are reservations, not joins. The invited player is not attached
    # to the match until they explicitly accept.
    sweep_expired_offers()
    existing = q("SELECT match_id, expires_at FROM match_offers"
                 " WHERE invited_user_id = ? AND expires_at > ?"
                 " ORDER BY expires_at DESC LIMIT 1", (uid, now), one=True)
    if existing:
        return jsonify({"match_id": existing["match_id"], "status": "offered",
                        "expires_in": max(1, int(existing["expires_at"] - now))})

    # A waiting match is eligible only while its owner is actively polling its
    # waiting screen. This prevents abandoned matches from producing a dead or
    # black game for a later player.
    live_after = datetime.fromtimestamp(now - 10, timezone.utc).isoformat()
    waiting = q("SELECT m.id FROM matches m WHERE m.mode = 'quick'"
                " AND m.status = 'waiting' AND m.p1 != ? AND m.updated_at >= ?"
                " AND NOT EXISTS (SELECT 1 FROM match_offers o"
                " WHERE o.match_id = m.id AND o.expires_at > ?)"
                " ORDER BY m.created_at LIMIT 1", (uid, live_after, now), one=True)
    if waiting:
        expires = now + 20
        try:
            execute("INSERT INTO match_offers (match_id, invited_user_id, expires_at, created_at)"
                    " VALUES (?,?,?,?)", (waiting["id"], uid, expires, _now_iso()))
            return jsonify({"match_id": waiting["id"], "status": "offered",
                            "expires_in": 20})
        except Exception:
            # Another request reserved it first. Fall through and create a new
            # waiting match instead of ever auto-joining the player.
            pass

    mid = secrets.token_hex(6)
    now_iso = _now_iso()
    execute("INSERT INTO matches (id, code, mode, status, p1, state, version,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
            (mid, None, "quick", "waiting", uid, "{}", now_iso, now_iso))
    # Also offer the new match to a player who is simply present in the app,
    # even if they never clicked quick match. Consent stays with the invited
    # player via the accept/decline prompt.
    offer_to_present_player(mid, uid)
    return jsonify({"match_id": mid, "status": "waiting"})


@app.post("/api/matches/<mid>/accept")
@require_auth
def match_accept(mid):
    err = limited("mutation")
    if err:
        return err
    uid = g.user["id"]
    now = time.time()
    offer = q("SELECT * FROM match_offers WHERE match_id = ?"
              " AND invited_user_id = ? AND expires_at > ?", (mid, uid, now), one=True)
    if not offer:
        execute("DELETE FROM match_offers WHERE match_id = ? AND invited_user_id = ?",
                (mid, uid))
        return jsonify({"error": "offer_expired",
                        "error_he": "ההזמנה פגה. אפשר לחפש משחק חדש."}), 410
    m = load_match(mid)
    if not m or m["status"] != "waiting" or m["p2"] is not None:
        execute("DELETE FROM match_offers WHERE match_id = ?", (mid,))
        return jsonify({"error": "unavailable",
                        "error_he": "המשחק כבר לא זמין."}), 409
    state = new_state(user_mods(m["p1"]), user_mods(uid))
    # Publish the player, active status and complete initial game state in one
    # database update. No client can observe an active match with empty state.
    cur = execute("UPDATE matches SET p2 = ?, status = 'active', state = ?,"
                  " version = version + 1, updated_at = ? WHERE id = ?"
                  " AND status = 'waiting' AND p2 IS NULL",
                  (uid, json.dumps(state), _now_iso(), mid))
    execute("DELETE FROM match_offers WHERE match_id = ?", (mid,))
    if cur.rowcount != 1:
        return jsonify({"error": "unavailable",
                        "error_he": "המשחק כבר לא זמין."}), 409
    active = load_match(mid)
    emit_events(mid, active["version"], [{"type": "match_start"}])
    return jsonify({"match_id": mid, "status": "active"})


@app.post("/api/matches/<mid>/decline")
@require_auth
def match_decline(mid):
    err = limited("mutation")
    if err:
        return err
    cur = execute("DELETE FROM match_offers WHERE match_id = ?"
                  " AND invited_user_id = ?", (mid, g.user["id"]))
    if cur.rowcount == 1:
        execute("INSERT OR IGNORE INTO match_offer_declines"
                " (match_id, user_id, created_at) VALUES (?,?,?)",
                (mid, g.user["id"], _now_iso()))
    return jsonify({"ok": True, "declined": cur.rowcount == 1})


@app.post("/api/matches/ai")
@require_auth
def match_ai():
    err = limited("mutation")
    if err:
        return err
    blocked = user_blocked_reason(g.user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    uid = g.user["id"]
    difficulty = (request.get_json(silent=True) or {}).get("difficulty", "normal")
    if difficulty not in ("easy", "normal", "hard"):
        return jsonify({"error": "bad_difficulty",
                        "error_he": "רמת הקושי אינה תקינה."}), 400
    mid = secrets.token_hex(6)
    now = _now_iso()
    state = new_state(user_mods(uid), {"armor": 0, "hp": 0, "skin": None})
    state["ai_difficulty"] = difficulty
    state["ready"] = {"p1": False, "p2": True}
    # grace period: the bot's cooldown counts from match start, giving the
    # player a few seconds to take in the field before the first incoming shell
    state["last_shot_at"]["p2"] = time.time()
    execute("INSERT INTO matches (id, code, mode, status, p1, p2_ai, state,"
            " version, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (mid, None, "ai", "active", uid, 1, json.dumps(state), 1, now, now))
    emit_events(mid, 1, [{"type": "match_start"}])
    return jsonify({"match_id": mid, "status": "active"})


@app.post("/api/matches/friend")
@require_auth
def match_friend():
    err = limited("mutation")
    if err:
        return err
    blocked = user_blocked_reason(g.user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    uid = g.user["id"]
    mid = secrets.token_hex(6)
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    now = _now_iso()
    execute("INSERT INTO matches (id, code, mode, status, p1, state, version,"
            " created_at, updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
            (mid, code, "friend", "waiting", uid, "{}", now, now))
    return jsonify({"match_id": mid, "code": code, "status": "waiting"})


@app.post("/api/matches/join")
@require_auth
def match_join():
    err = limited("mutation")
    if err:
        return err
    blocked = user_blocked_reason(g.user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    code = ((request.get_json(silent=True) or {}).get("code") or "").strip().upper()
    m = q("SELECT id, p1 FROM matches WHERE code = ?", (code,), one=True)
    if not m:
        return jsonify({"error": "not_found", "error_he": "קוד לא נמצא."}), 404
    uid = g.user["id"]
    if m["p1"] == uid:
        return jsonify({"error": "own_match",
                        "error_he": "זה המשחק שלך - שתף את הקוד עם חבר."}), 400
    if not claim_waiting_match(m["id"], uid):
        return jsonify({"error": "unavailable",
                        "error_he": "המשחק כבר מלא או הסתיים."}), 400
    mm = load_match(m["id"])
    mm["state"] = new_state(user_mods(mm["p1"]), user_mods(uid))
    mm["version"] += 1
    save_match(mm)
    emit_events(mm["id"], mm["version"], [{"type": "match_start"}])
    return jsonify({"match_id": mm["id"], "status": "active"})


@app.get("/api/matches/<mid>/state")
@require_auth
def match_state(mid):
    err = limited("state")
    if err:
        return err
    m = load_match(mid)
    if not m or side_for(m, g.user["id"]) is None:
        return jsonify({"error": "not_found"}), 404
    if m["status"] == "waiting":
        execute("UPDATE matches SET updated_at = ? WHERE id = ?", (_now_iso(), mid))
        m["updated_at"] = _now_iso()
        # Quick-match owners keep inviting present players while they wait:
        # after a decline or timeout, fall back to another present player.
        if m["mode"] == "quick":
            offer_to_present_player(mid, g.user["id"])
    try:
        since = max(0, int(request.args.get("since", 0)))
    except (TypeError, ValueError):
        return jsonify({"error": "bad_since"}), 400
    # AI opponent acts on poll when its cooldown has elapsed (+ reaction delay)
    if m["p2_ai"] and m["status"] == "active":
        last = m["state"]["last_shot_at"]["p2"]
        difficulty = m["state"].get("ai_difficulty", "normal")
        reaction = {"easy": 4.2, "normal": 2.2, "hard": 0.8}.get(difficulty, 2.2)
        if time.time() - last > cooldown_for("standard") + reaction:
            angle, power, weapon = ai_choose_shot(m["state"], "p2", difficulty)
            events, won = fire_weapon(m["state"], "p2", angle, power, weapon)
            m["version"] += 1
            if won:
                finalize_match(m, "p2")
                events.append({"type": "match_end", "winner_side": "p2"})
            save_match(m)
            emit_events(mid, m["version"], events)
    return jsonify(match_snapshot(m, g.user["id"], since))


@app.post("/api/matches/<mid>/ready")
@require_auth
def match_ready(mid):
    err = limited("mutation")
    if err:
        return err
    m = load_match(mid)
    side = side_for(m, g.user["id"]) if m else None
    if not m or side is None or m["status"] != "active":
        return jsonify({"error": "not_found"}), 404
    m["state"].setdefault("ready", {})[side] = True
    save_match(m)
    return jsonify({"ok": True, "side": side})


@app.post("/api/matches/<mid>/fire")
@require_auth
def match_fire(mid):
    err = limited("fire")
    if err:
        return err
    blocked = user_blocked_reason(g.user)
    if blocked:
        return jsonify({"error": "blocked", "error_he": blocked}), 403
    m = load_match(mid)
    side = side_for(m, g.user["id"]) if m else None
    if not m or side is None:
        return jsonify({"error": "not_found"}), 404
    if m["status"] != "active":
        return jsonify({"error": "not_active",
                        "error_he": "המשחק לא פעיל."}), 400
    body = request.get_json(silent=True) or {}
    try:
        angle = float(body.get("angle"))
        power = float(body.get("power"))
    except (TypeError, ValueError):
        return jsonify({"error": "bad_params"}), 400
    weapon = body.get("weapon", "standard")
    if weapon not in ("standard", "double_bomb", "homing_missile", "cluster_shell"):
        return jsonify({"error": "bad_weapon"}), 400
    # cooldown enforcement (server clock)
    last = m["state"]["last_shot_at"][side]
    cd = cooldown_for(weapon)
    remaining = cd - (time.time() - last)
    if remaining > 0.05:
        return jsonify({"error": "reloading", "remaining": round(remaining, 2),
                        "error_he": "התותח בטעינה."}), 429
    # consumable ownership check + atomic decrement
    if weapon != "standard":
        cur = execute("UPDATE user_items SET qty = qty - 1 WHERE user_id = ?"
                      " AND item_id = ? AND qty > 0", (g.user["id"], weapon))
        if cur.rowcount != 1:
            return jsonify({"error": "no_ammo",
                            "error_he": "אין לך תחמושת מהסוג הזה."}), 400
    events, won = fire_weapon(m["state"], side, angle, power, weapon)
    m["version"] += 1
    if won:
        finalize_match(m, side)
        events.append({"type": "match_end", "winner_side": side})
    save_match(m)
    emit_events(mid, m["version"], events)
    snap = match_snapshot(m, g.user["id"], m["version"] - 1)
    return jsonify(snap)


@app.post("/api/matches/<mid>/leave")
@require_auth
def match_leave(mid):
    err = limited("mutation")
    if err:
        return err
    m = load_match(mid)
    side = side_for(m, g.user["id"]) if m else None
    if not m or side is None:
        return jsonify({"error": "not_found"}), 404
    if m["status"] == "active":
        other = "p2" if side == "p1" else "p1"
        ready = m["state"].get("ready", {})
        shots = m["state"].get("last_shot_at", {})
        # A client that never completed loading, or a match where neither side
        # could make a move, is a technical abort - never a ranked loss.
        technical_abort = not ready.get(side, False) or not ready.get(other, False)             or not any((shots.get(s) or 0) > m["state"].get("started_at", 0)
                       for s in ("p1", "p2"))
        if technical_abort:
            m["status"] = "aborted"
            m["winner"] = None
            m["state"]["abort_reason"] = "technical_failure"
            m["state"]["winner_side"] = None
            m["state"]["results"] = {"p1": {"outcome": "void"},
                                       "p2": {"outcome": "void"}}
            m["version"] += 1
            save_match(m)
            emit_events(mid, m["version"],
                        [{"type": "match_abort", "reason": "technical_failure"}])
        else:
            finalize_match(m, other)
            m["version"] += 1
            save_match(m)
            emit_events(mid, m["version"],
                        [{"type": "match_end", "winner_side": other,
                          "reason": "opponent_left"}])
    elif m["status"] == "waiting":
        execute("DELETE FROM match_offers WHERE match_id = ?", (mid,))
        execute("DELETE FROM matches WHERE id = ?", (mid,))
    return jsonify({"ok": True})


# --------------------------------------------------------------- leaderboard
@app.get("/api/leaderboard")
@require_auth
def leaderboard():
    rows = q("SELECT id, name, picture, rating, wins, losses FROM users"
             " WHERE matches_played > 0 ORDER BY rating DESC LIMIT 100")
    return jsonify({"leaderboard": [
        {"id": r["id"], "name": r["name"], "picture": r["picture"],
         "rating": r["rating"], "rank": rank_for(r["rating"]),
         "wins": r["wins"], "losses": r["losses"]} for r in rows],
        "me": g.user["id"]})


# --------------------------------------------------------------- admin
@app.get("/api/admin/overview")
@require_admin
def admin_overview():
    err = limited("admin")
    if err:
        return err
    today = _today()
    stats = {
        "users_total": q("SELECT COUNT(*) c FROM users", one=True)["c"],
        "users_today": q("SELECT COUNT(*) c FROM users WHERE last_login >= ?",
                         (today,), one=True)["c"],
        "matches_total": q("SELECT COUNT(*) c FROM matches", one=True)["c"],
        "matches_active": q("SELECT COUNT(*) c FROM matches WHERE status IN"
                            " ('active','waiting')", one=True)["c"],
        "coins_issued": q("SELECT COALESCE(SUM(delta),0) c FROM transactions"
                          " WHERE delta > 0", one=True)["c"],
        "coins_spent": q("SELECT COALESCE(-SUM(delta),0) c FROM transactions"
                         " WHERE delta < 0", one=True)["c"],
        "purchases": q("SELECT COUNT(*) c FROM transactions WHERE reason ="
                       " 'purchase'", one=True)["c"],
        "banned": q("SELECT COUNT(*) c FROM users WHERE suspended = 1 OR"
                    " (banned_until IS NOT NULL AND banned_until > ?)",
                    (_now_iso(),), one=True)["c"],
    }
    recent = q("SELECT t.created_at, u.email, t.delta, t.reason, t.ref"
               " FROM transactions t JOIN users u ON u.id = t.user_id"
               " ORDER BY t.id DESC LIMIT 30")
    return jsonify({"stats": stats, "recent_transactions": [dict(r) for r in recent]})


@app.get("/api/admin/users")
@require_admin
def admin_users():
    err = limited("admin")
    if err:
        return err
    term = f"%{request.args.get('q', '').strip()}%"
    rows = q("SELECT * FROM users WHERE email LIKE ? OR name LIKE ?"
             " ORDER BY id DESC LIMIT 100", (term, term))
    return jsonify({"users": [
        {"id": r["id"], "email": r["email"], "name": r["name"],
         "coins": r["coins"], "rating": r["rating"], "wins": r["wins"],
         "losses": r["losses"], "suspended": bool(r["suspended"]),
         "banned_until": r["banned_until"], "created_at": r["created_at"],
         "last_login": r["last_login"]} for r in rows]})


@app.post("/api/admin/users/<int:uid>/moderate")
@require_admin
def admin_moderate(uid):
    err = limited("admin")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    action = body.get("action")
    target = q("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    if not target:
        return jsonify({"error": "not_found"}), 404
    if target["email"].lower() == Config.ADMIN_EMAIL.lower():
        return jsonify({"error": "cannot_moderate_admin"}), 400
    if action == "ban":
        try:
            hours = max(1, min(24 * 365, int(body.get("hours", 24))))
        except (TypeError, ValueError):
            return jsonify({"error": "bad_hours"}), 400
        until = datetime.fromtimestamp(
            time.time() + hours * 3600, tz=timezone.utc).isoformat()
        execute("UPDATE users SET banned_until = ? WHERE id = ?", (until, uid))
        msg = f"banned until {until}"
    elif action == "suspend":
        execute("UPDATE users SET suspended = 1 WHERE id = ?", (uid,))
        msg = "suspended"
    elif action == "lift":
        execute("UPDATE users SET suspended = 0, banned_until = NULL WHERE id = ?",
                (uid,))
        msg = "restrictions lifted"
    else:
        return jsonify({"error": "bad_action"}), 400
    execute("INSERT INTO messages (user_id, title, body, created_at)"
            " VALUES (?,?,?,?)",
            (uid, "עדכון מהנהלת Brigagame",
             f"סטטוס החשבון שלך עודכן: {msg}.", _now_iso()))
    audit("admin.moderate", "user", uid, {"action": action, "result": msg})
    return jsonify({"ok": True, "result": msg})


@app.post("/api/admin/users/<int:uid>/coins")
@require_admin
def admin_coins(uid):
    err = limited("admin")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    try:
        delta = int(body.get("delta", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "bad_delta"}), 400
    reason = (body.get("reason") or "admin_adjustment")[:120]
    if delta == 0 or abs(delta) > 100000:
        return jsonify({"error": "bad_delta"}), 400
    if not q("SELECT 1 FROM users WHERE id = ?", (uid,), one=True):
        return jsonify({"error": "not_found"}), 404
    add_coins(uid, delta, reason)
    u = q("SELECT coins FROM users WHERE id = ?", (uid,), one=True)
    audit("admin.coins", "user", uid, {"delta": delta, "reason": reason})
    return jsonify({"ok": True, "coins": u["coins"]})


@app.post("/api/admin/broadcast")
@require_admin
def admin_broadcast():
    err = limited("admin")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()[:120]
    text = (body.get("body") or "").strip()[:2000]
    if not title or not text:
        return jsonify({"error": "missing_fields"}), 400
    execute("INSERT INTO messages (user_id, title, body, created_at)"
            " VALUES (NULL,?,?,?)", (title, text, _now_iso()))
    audit("admin.broadcast", details={"title": title})
    return jsonify({"ok": True})


@app.get("/api/admin/maintenance")
@require_admin
def admin_maintenance_get():
    err = limited("admin")
    if err:
        return err
    return jsonify(get_maintenance())


@app.post("/api/admin/maintenance")
@require_admin
def admin_maintenance_set():
    err = limited("admin")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    on = bool(body.get("on"))
    message = str(body.get("message") or "").strip()[:300]
    execute("INSERT INTO settings (key, value) VALUES ('maintenance', ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps({"on": on, "message": message}),))
    audit("admin.maintenance", details={"on": on, "message": message})
    return jsonify({"ok": True, "maintenance": get_maintenance()})


@app.get("/api/admin/coupons")
@require_admin
def admin_coupons_list():
    err = limited("admin")
    if err:
        return err
    rows = q("SELECT * FROM coupons ORDER BY created_at DESC LIMIT 100")
    return jsonify({"coupons": [dict(r) for r in rows]})


@app.post("/api/admin/coupons")
@require_admin
def admin_coupons_create():
    err = limited("admin")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    kind = body.get("kind", "coins")
    code = (body.get("code") or secrets.token_urlsafe(4)[:6].upper()).strip().upper()
    if kind == "coins":
        try:
            amount = max(1, min(100000, int(body.get("amount", 100))))
        except (TypeError, ValueError):
            return jsonify({"error": "bad_amount"}), 400
        item_id = None
    elif kind == "item" and body.get("item_id") in CATALOG:
        amount, item_id = 0, body["item_id"]
    else:
        return jsonify({"error": "bad_kind"}), 400
    try:
        max_uses = max(1, min(100000, int(body.get("max_uses", 1))))
    except (TypeError, ValueError):
        return jsonify({"error": "bad_max_uses"}), 400
    if not code or len(code) > 32 or not all(ch.isalnum() or ch in "-_" for ch in code):
        return jsonify({"error": "bad_code"}), 400
    expires_at = body.get("expires_at") or None
    if expires_at:
        try:
            datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return jsonify({"error": "bad_expiry"}), 400
    try:
        execute("INSERT INTO coupons (code, kind, amount, item_id, max_uses,"
                " expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
                (code, kind, amount, item_id, max_uses, expires_at,
                 g.user["id"], _now_iso()))
    except Exception:
        return jsonify({"error": "code_exists"}), 400
    audit("admin.coupon_create", "coupon", code, {"kind": kind, "max_uses": max_uses})
    return jsonify({"ok": True, "code": code})


@app.delete("/api/admin/coupons/<code>")
@require_admin
def admin_coupons_delete(code):
    err = limited("admin")
    if err:
        return err
    execute("DELETE FROM coupons WHERE code = ?", (code.upper(),))
    audit("admin.coupon_delete", "coupon", code.upper())
    return jsonify({"ok": True})


@app.get("/api/admin/audit")
@require_admin
def admin_audit():
    err = limited("admin")
    if err:
        return err
    rows = q("SELECT a.id, a.created_at, a.action, a.target_type, a.target_id,"
             " a.details, a.ip_hash, a.user_agent, u.email actor_email"
             " FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id"
             " ORDER BY a.id DESC LIMIT 200")
    return jsonify({"audit": [dict(r) for r in rows],
                    "notice": "רישום תפעולי ואבטחתי ממוזער; כתובות IP אינן נשמרות גלויות."})


@app.get("/api/admin/matches")
@require_admin
def admin_matches():
    err = limited("admin")
    if err:
        return err
    rows = q("SELECT id, mode, status, version, created_at, updated_at FROM matches"
             " ORDER BY updated_at DESC LIMIT 50")
    return jsonify({"matches": [dict(r) for r in rows]})


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "Brigagame 2.0 by OrelAI"})


with app.app_context():
    init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
