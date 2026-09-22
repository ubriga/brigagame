"""Brigagame 2.0 by OrelAI - Flask backend.

Server-authoritative multiplayer artillery game. The client renders only;
every game rule, coin movement and validation happens here.
"""
import json
import math
import random
import secrets
import time
from datetime import datetime, timezone

from flask import Flask, g, jsonify, request

from auth import (create_session, current_user, destroy_session,
                  get_or_create_user, require_admin, require_auth,
                  user_blocked_reason, verify_google_credential)
from config import Config
from db import execute, get_db, init_db, q
from economy import (CATALOG, COINS_PER_DAMAGE, COINS_PER_LOSS,
                     DAILY_BASE, DAILY_CAP, DAILY_STREAK_STEP, DEFAULT_SKIN,
                     MAX_COINS_PER_WIN, MAX_HIT_COINS_PER_MATCH, elo_delta, rank_for,
                     win_reward_coins)
from game_logic import (TOWER_X_RANGE, ai_choose_shot, cooldown_for, fire_weapon, new_state,
                        obstacle_at, tower_hp)
from ranks import MAX_LEVEL, rank_for_level, rank_payload, rank_up_info
from security import init_security, limited, request_ip_hash

app = Flask(__name__)
app.config.from_object(Config)
# Preserve semantic catalog order (coatings progress wood -> tin -> iron).
app.json.sort_keys = False
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
        "idf_rank": rank_payload(u["rank_points"]),
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
    """Single place where coins move. Writes the ledger row too.

    Match-win rewards are clamped here as a final economy invariant, not only
    in ``finalize_match``. That keeps every current or future win component
    (base, damage, streak, bonus, consolation) inside the owner's 50-coin cap.
    """
    if reason == "match_win":
        delta = max(0, min(MAX_COINS_PER_WIN, int(delta)))
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
    coating = q("SELECT material, hp, max_hp FROM user_coatings WHERE user_id = ?",
                (user_id,), one=True)
    mods["coating"] = dict(coating) if coating else None
    refresh_expansions(user_id)
    expansion = q("SELECT extra_cubes FROM user_expansions WHERE user_id = ?", (user_id,), one=True)
    mods["extra_cubes"] = int(expansion["extra_cubes"]) if expansion else 0
    controls = get_gameplay_controls()
    mods["expansion_cube_hp"] = float(controls["tower_expansion"]["cube_hp"])
    mods["dynamic_obstacle"] = dict(controls["dynamic_obstacle"])
    return mods


def effective_catalog():
    """Merge validated operator controls without allowing arbitrary style data."""
    catalog = {key: dict(value) for key, value in CATALOG.items()}
    for row in q("SELECT item_id, price, available FROM cosmetic_overrides"):
        if row["item_id"] in catalog and catalog[row["item_id"]].get("kind") == "skin":
            catalog[row["item_id"]]["price"] = row["price"]
            catalog[row["item_id"]]["available"] = bool(row["available"])
    return catalog


def skin_style(skin_id):
    item = effective_catalog().get(skin_id, DEFAULT_SKIN)
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


# Win vs a normal/hard bot counts at reduced weight toward the IDF rank
# ladder; easy-bot games are practice (0 points). Human wins count full.
RANK_POINTS_BOT_WIN = 1.0
RANK_POINTS_HUMAN_WIN = 2.0
RANK_XP_PER_DAMAGE = 0.01

# Every planned gameplay system starts behind a server-owned admin control.
# The feature entries are deliberately present before their implementation so
# later stages cannot ship without an operator kill switch and safe limits.
DEFAULT_GAMEPLAY_CONTROLS = {
    "xp": {
        "human_win": RANK_POINTS_HUMAN_WIN,
        "bot_win": RANK_POINTS_BOT_WIN,
        "per_damage": RANK_XP_PER_DAMAGE,
    },
    "premium_skins": {
        "enabled": False,
        "asset_budget_kb": 80,
    },
    "coatings": {
        "enabled": True,
        "max_level": 3,
        "build_minutes": 5,
        "wood_price": 80, "wood_minutes": 5, "wood_hp": 24,
        "tin_price": 240, "tin_minutes": 15, "tin_hp": 65,
        "iron_price": 600, "iron_minutes": 30, "iron_hp": 130,
    },
    "tower_expansion": {
        "enabled": True,
        "max_extra_cubes": 12,
        "build_minutes": 10,
        "cube_price": 180,
        "cube_hp": 18,
    },
    "dynamic_obstacle": {
        "enabled": True,
        "speed": 20,
        "warning_seconds": 1.5,
    },
    # Every bot tier is server-owned and fully tunable by the admin. Accuracy
    # values are intentionally much stronger than the old hard-coded profiles.
    "bot_difficulty": {
        "easy_angle_noise": 10.0, "easy_power_spread": 0.12, "easy_wind_skill": 0.35,
        "easy_reaction": 1.8, "easy_rank_offset": 0, "easy_shield_chance": 0.10, "easy_mega_chance": 0.10,
        "medium_angle_noise": 5.0, "medium_power_spread": 0.06, "medium_wind_skill": 0.70,
        "medium_reaction": 1.0, "medium_rank_offset": 2, "medium_shield_chance": 0.25, "medium_mega_chance": 0.25,
        "hard_angle_noise": 2.5, "hard_power_spread": 0.025, "hard_wind_skill": 0.90,
        "hard_reaction": 0.65, "hard_rank_offset": 5, "hard_shield_chance": 0.45, "hard_mega_chance": 0.45,
        "ultra_angle_noise": 1.2, "ultra_power_spread": 0.012, "ultra_wind_skill": 1.0,
        "ultra_reaction": 0.35, "ultra_rank_offset": 9, "ultra_shield_chance": 0.70, "ultra_mega_chance": 0.70,
        "expert_angle_noise": 0.35, "expert_power_spread": 0.004, "expert_wind_skill": 1.0,
        "expert_reaction": 0.15, "expert_rank_offset": 12, "expert_shield_chance": 0.90, "expert_mega_chance": 0.90,
    },
}


def get_gameplay_controls():
    """Return validated controls, filling old/missing rows with safe defaults."""
    controls = json.loads(json.dumps(DEFAULT_GAMEPLAY_CONTROLS))
    row = q("SELECT value FROM settings WHERE key = 'gameplay_controls'", one=True)
    if not row:
        return controls
    try:
        saved = json.loads(row["value"])
    except (TypeError, ValueError):
        return controls
    if not isinstance(saved, dict):
        return controls
    for section, defaults in controls.items():
        incoming = saved.get(section)
        if isinstance(incoming, dict):
            for key in defaults:
                if key in incoming:
                    controls[section][key] = incoming[key]
    return controls


def rank_xp_config():
    controls = get_gameplay_controls()["xp"]
    out = {}
    limits = {"human_win": 100.0, "bot_win": 100.0, "per_damage": 1.0}
    for key, ceiling in limits.items():
        try:
            value = float(controls[key])
        except (TypeError, ValueError):
            value = DEFAULT_GAMEPLAY_CONTROLS["xp"][key]
        if not math.isfinite(value):
            value = DEFAULT_GAMEPLAY_CONTROLS["xp"][key]
        out[key] = max(0.0, min(ceiling, value))
    return out


def refresh_expansions(user_id):
    now = time.time()
    due = q("SELECT * FROM expansion_jobs WHERE user_id=? AND status IN ('queued','building')"
            " AND completes_at<=? ORDER BY completes_at,id", (user_id, now))
    for job in due:
        execute("INSERT INTO user_expansions(user_id,extra_cubes,updated_at) VALUES(?,?,?)"
                " ON CONFLICT(user_id) DO UPDATE SET extra_cubes=MAX(extra_cubes,excluded.extra_cubes),"
                " updated_at=excluded.updated_at", (user_id, job["cube_number"], _now_iso()))
        execute("UPDATE expansion_jobs SET status='complete' WHERE id=?", (job["id"],))
    execute("UPDATE expansion_jobs SET status='building' WHERE user_id=? AND status='queued' AND starts_at<=?",
            (user_id, now))


def expansion_payload(user_id):
    refresh_expansions(user_id)
    c = get_gameplay_controls()["tower_expansion"]
    row = q("SELECT extra_cubes FROM user_expansions WHERE user_id=?", (user_id,), one=True)
    jobs = q("SELECT id,cube_number,status,starts_at,completes_at FROM expansion_jobs"
             " WHERE user_id=? AND status IN ('queued','building') ORDER BY starts_at,id", (user_id,))
    return {"enabled": bool(c["enabled"]), "extra_cubes": int(row["extra_cubes"]) if row else 0,
            "max_extra_cubes": int(c["max_extra_cubes"]), "build_minutes": float(c["build_minutes"]),
            "cube_price": int(c["cube_price"]), "cube_hp": float(c["cube_hp"]),
            "jobs": [dict(j) for j in jobs], "server_time": time.time()}


COATING_ORDER = ("wood", "tin", "iron")
COATING_NAMES = {"wood": "עץ", "tin": "פח", "iron": "ברזל"}


def coating_catalog():
    c = get_gameplay_controls()["coatings"]
    return {m: {"material": m, "name_he": COATING_NAMES[m],
                "level": i + 1, "price": int(c[f"{m}_price"]),
                "minutes": float(c[f"{m}_minutes"]),
                "hp": float(c[f"{m}_hp"])}
            for i, m in enumerate(COATING_ORDER)}


def refresh_coatings(user_id):
    """Finish due jobs and start the next queued job, in one server-owned queue."""
    now = time.time()
    due = q("SELECT * FROM coating_jobs WHERE user_id = ? AND status IN ('queued','building')"
            " AND completes_at <= ? ORDER BY completes_at, id", (user_id, now))
    catalog = coating_catalog()
    for job in due:
        spec = catalog.get(job["material"])
        if not spec:
            continue
        execute("INSERT INTO user_coatings (user_id, material, hp, max_hp, updated_at)"
                " VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET"
                " material=excluded.material, hp=excluded.hp, max_hp=excluded.max_hp,"
                " updated_at=excluded.updated_at",
                (user_id, job["material"], spec["hp"], spec["hp"], _now_iso()))
        execute("UPDATE coating_jobs SET status='complete' WHERE id = ?", (job["id"],))
    execute("UPDATE coating_jobs SET status='building' WHERE user_id = ? AND status='queued'"
            " AND starts_at <= ?", (user_id, now))


def coating_payload(user_id):
    refresh_coatings(user_id)
    current = q("SELECT material, hp, max_hp, updated_at FROM user_coatings WHERE user_id = ?",
                (user_id,), one=True)
    jobs = q("SELECT id, material, status, starts_at, completes_at FROM coating_jobs"
             " WHERE user_id = ? AND status IN ('queued','building') ORDER BY starts_at, id",
             (user_id,))
    return {"enabled": bool(get_gameplay_controls()["coatings"]["enabled"]),
            "catalog": coating_catalog(), "current": dict(current) if current else None,
            "jobs": [dict(j) for j in jobs], "server_time": time.time()}


def rank_loss_points(current_points, versus_ai=False, ai_rank_level=None):
    """Server-side rank loss: higher ranks stake more, but never below zero.

    Human losses scale 0.5 -> 2.2 points across the 18 ranks. Ranked-bot
    losses are gentler and also account for opponent strength: losing to the
    minimum same-rank bot costs 0.25 -> 1.1; choosing a stronger bot reduces
    that deduction by 5% per rank above the player, to a 50% floor.
    """
    player_level = rank_payload(current_points)["level"]
    human_loss = round(0.5 + 1.7 * ((player_level - 1) / (MAX_LEVEL - 1)), 1)
    if not versus_ai:
        return min(float(current_points), human_loss)
    bot_level = max(player_level, min(MAX_LEVEL, int(ai_rank_level or player_level)))
    stronger_discount = max(0.5, 1.0 - 0.05 * (bot_level - player_level))
    return min(float(current_points), round(human_loss * 0.5 * stronger_discount, 1))


def finalize_match(m, winner_side):
    """Apply server-authoritative match results and economy rules."""
    loser_side = "p2" if winner_side == "p1" else "p1"
    m["status"] = "finished"
    m["winner"] = m[winner_side] if not (winner_side == "p2" and m["p2_ai"]) else None
    m["state"]["winner_side"] = winner_side
    practice = bool(m["p2_ai"] and m["state"].get("ai_difficulty") == "easy")
    results = {}
    for side, outcome in ((winner_side, "win"), (loser_side, "loss")):
        uid = m[side]
        if uid is None or (side == "p2" and m["p2_ai"]):
            results[side] = {"outcome": outcome, "ai": True}
            continue
        dmg = m["state"]["damage_dealt"][side]
        # Practice is fully outside the economy: no base reward, damage coins,
        # consolation coins, rating movement, or IDF rank movement.
        hit_coins = 0 if practice else min(MAX_HIT_COINS_PER_MATCH,
                                            int(dmg * COINS_PER_DAMAGE))
        if practice:
            base = 0
            total = 0
        elif outcome == "win":
            opponent_uid = m[loser_side if side == winner_side else winner_side]
            opponent = (q("SELECT rank_points FROM users WHERE id = ?",
                          (opponent_uid,), one=True) if opponent_uid else None)
            opponent_level = (m["state"].get("ai_rank_level") if m["p2_ai"]
                              else rank_payload(opponent["rank_points"])["level"])
            enemy_side = loser_side if side == winner_side else winner_side
            total = win_reward_coins(
                dmg, tower_hp(m["state"], enemy_side)["max"], opponent_level,
                m["state"].get("ai_tier"))
            # Preserve the result field used by the client/tests: for wins it
            # is the performance-derived portion rather than an extra payout.
            hit_coins = total
        else:
            base = COINS_PER_LOSS
            total = base + hit_coins
        if outcome == "win":
            total = min(MAX_COINS_PER_WIN, total)
        add_coins(uid, total, f"match_{outcome}", m["id"])
        other = m[loser_side if side == winner_side else winner_side]
        u = q("SELECT rating, wins, rank_points FROM users WHERE id = ?",
              (uid,), one=True)
        o = q("SELECT rating FROM users WHERE id = ?", (other,), one=True) \
            if other else None
        my_r, their_r = u["rating"], (o["rating"] if o else 1000)
        if outcome == "win":
            delta = 0 if practice else elo_delta(my_r, their_r)
            # XP is derived only from authoritative damage accumulated by
            # fire_weapon plus a completed-match win bonus.
            xp = rank_xp_config()
            pts = (0.0 if practice else round(
                dmg * xp["per_damage"] +
                (xp["bot_win"] if m["p2_ai"] else xp["human_win"]), 1))
            execute("UPDATE users SET rating = rating + ?, wins = wins + ?,"
                    " rank_points = rank_points + ?,"
                    " matches_played = matches_played + 1 WHERE id = ?",
                    (delta, 0 if practice else 1, pts, uid))
            idf_r = rank_payload(u["rank_points"] + pts)
            up = None if practice else rank_up_info(u["rank_points"], u["rank_points"] + pts)
        else:
            delta = 0 if practice else elo_delta(their_r, my_r)
            loss_pts = (0.0 if practice else rank_loss_points(
                u["rank_points"], versus_ai=bool(m["p2_ai"]),
                ai_rank_level=m["state"].get("ai_rank_level")))
            damage_xp = 0.0 if practice else round(
                dmg * rank_xp_config()["per_damage"], 1)
            execute("UPDATE users SET rating = MAX(0, rating - ?),"
                    " rank_points = MAX(0, rank_points + ? - ?),"
                    " losses = losses + ?,"
                    " matches_played = matches_played + 1 WHERE id = ?",
                    (delta, damage_xp, loss_pts, 0 if practice else 1, uid))
            idf_r = rank_payload(max(0, u["rank_points"] + damage_xp - loss_pts))
            up = None
        results[side] = {"outcome": outcome, "coins": total,
                         "hit_coins": hit_coins,
                         "rating_delta": delta if outcome == "win" else -delta,
                         "idf_rank": idf_r}
        if outcome == "win":
            results[side]["rank_points_awarded"] = pts
        else:
            results[side]["rank_points_lost"] = loss_pts
            results[side]["damage_xp_awarded"] = damage_xp
        if practice:
            results[side]["practice"] = True
        if up:
            results[side]["rank_up"] = up
    m["state"]["results"] = results


def finalize_draw(m, reason="time_limit"):
    """Finish a tied match without moving coins, rating, rank or stats."""
    m["status"] = "finished"
    m["winner"] = None
    m["state"]["winner_side"] = None
    m["state"]["finish_reason"] = reason
    m["state"]["results"] = {"p1": {"outcome": "draw", "coins": 0,
                                      "rating_delta": 0},
                               "p2": {"outcome": "draw", "coins": 0,
                                      "rating_delta": 0}}


def resolve_time_limit(m, now=None):
    """Enter sudden death at three minutes, then resolve at four minutes."""
    if not m or m["status"] != "active" or not m["state"].get("towers"):
        return []
    now = time.time() if now is None else now
    started = float(m["state"].get("started_at") or now)
    sudden_at = started + 3 * 60
    if now >= sudden_at and not m["state"].get("sudden_death"):
        m["state"]["sudden_death"] = True
        m["version"] += 1
        save_match(m)
        event = {"type": "sudden_death", "damage_multiplier": 2}
        emit_events(m["id"], m["version"], [event])
        if now < started + Config.MATCH_DURATION_SECONDS:
            return [event]
    if now < started + Config.MATCH_DURATION_SECONDS:
        return []
    # Claim resolution before applying economy changes. PythonAnywhere can
    # serve both players' deadline polls concurrently, but only one may pay.
    cur = execute("UPDATE matches SET status = 'resolving' WHERE id = ?"
                  " AND status = 'active'", (m["id"],))
    if cur.rowcount != 1:
        current = load_match(m["id"])
        if current:
            m.clear(); m.update(current)
        return []
    m["status"] = "resolving"
    hp = {side: tower_hp(m["state"], side) for side in ("p1", "p2")}
    integrity = {side: (hp[side]["hp"] / hp[side]["max"] if hp[side]["max"] else 0.0)
                 for side in ("p1", "p2")}
    if abs(integrity["p1"] - integrity["p2"]) <= 1e-9:
        finalize_draw(m)
        event = {"type": "match_end", "winner_side": None,
                 "reason": "time_limit", "draw": True}
    else:
        winner = "p1" if integrity["p1"] > integrity["p2"] else "p2"
        finalize_match(m, winner)
        m["state"]["finish_reason"] = "time_limit"
        event = {"type": "match_end", "winner_side": winner,
                 "reason": "time_limit"}
    m["state"]["time_limit_integrity"] = {k: round(v, 6) for k, v in integrity.items()}
    m["version"] += 1
    save_match(m)
    emit_events(m["id"], m["version"], [event])
    return [event]


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
            u = q("SELECT id, name, picture, rating, wins, rank_points"
                  " FROM users WHERE id = ?", (uid,), one=True)
            if u:
                players[side] = {"id": u["id"], "name": u["name"],
                                 "picture": u["picture"], "rating": u["rating"],
                                 "rank": rank_for(u["rating"]),
                                 "idf_rank": rank_payload(u["rank_points"])}
            else:
                players[side] = {"id": uid, "name": "שחקן לשעבר",
                                 "picture": "", "rating": None,
                                 "rank": None, "idf_rank": None}
        elif side == "p2" and m["p2_ai"]:
            bot_rank = (rank_for_level(state.get("ai_rank_level", 1))
                        if state.get("ai_difficulty") == "ranked" else None)
            players[side] = {"id": None, "name": "OrelAI Bot", "picture": "",
                             "rating": None,
                             "rank": (bot_rank["abbr_he"] if bot_rank else "AI"),
                             "idf_rank": bot_rank}
    mods = state.get("mods", {})
    return {
        "id": m["id"], "code": m["code"], "mode": m["mode"],
        "status": m["status"], "version": m["version"],
        "you": side_for(m, user_id),
        "players": players,
        "towers": state.get("towers"),
        "tower_x": state.get("tower_x"),
        "tower_dims": {side: {"rows": len((state.get("towers") or {}).get(side) or []),
                               "cols": len(((state.get("towers") or {}).get(side) or [[]])[0])}
                       for side in ("p1","p2") if (state.get("towers") or {}).get(side)},
        # Waiting matches intentionally have no battlefield yet. Returning null
        # instead of calculating against {} keeps the waiting screen healthy.
        "tower_hp": ({side: tower_hp(state, side) for side in ("p1", "p2")}
                     if state.get("towers") else None),
        "wind": state.get("wind"),
        "map": state.get("map", "valley"),
        "obstacle": obstacle_at(state),
        "sudden_death": bool(state.get("sudden_death")),
        "turn_deadline": (state.get("last_turn_at") or {}).get(side_for(m, user_id), 0) + 10,
        "moves_left": (state.get("moves_left") or {}).get(side_for(m, user_id), 0),
        "abilities": (state.get("abilities") or {}).get(side_for(m, user_id), {}),
        "shield": state.get("shield", {}),
        "damage_dealt": state.get("damage_dealt"),
        "coatings": state.get("coatings", {}),
        "skins": {s: skin_style(mods.get(s, {}).get("skin")) for s in ("p1", "p2")},
        "last_shot_at": state.get("last_shot_at"),
        "winner_side": state.get("winner_side"),
        "results": state.get("results"),
        "finish_reason": state.get("finish_reason"),
        "time_limit_integrity": state.get("time_limit_integrity"),
        "match_ends_at": ((state.get("started_at") or 0) + Config.MATCH_DURATION_SECONDS
                          if m["status"] == "active" else None),
        "ready": state.get("ready", {}),
        "ai_difficulty": state.get("ai_difficulty"),
        "ai_tier": state.get("ai_tier"),
        "ai_rank_level": state.get("ai_rank_level"),
        # Easy-bot games are practice matches: they never advance rank.
        "practice": bool(m["p2_ai"] and state.get("ai_difficulty") == "easy"),
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
    opponent: purge it like a player leaving the lobby. Both windows default
    to five minutes. Free tier has no
    always-on task runner, so API traffic carries this sweep, throttled to one
    run per STALE_SWEEP_INTERVAL_SECONDS per worker."""
    global _sweep_last_run
    now = time.time()
    # Dev/test runs bypass the throttle so tests can force a sweep on demand;
    # production keeps the one-run-per-interval limit.
    if not Config.DEV_AUTH and now - _sweep_last_run < Config.STALE_SWEEP_INTERVAL_SECONDS:
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
                    "streak": u["streak"], "server_date": today,
                    "coating": coating_payload(u["id"]),
                    "expansion": expansion_payload(u["id"])})


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
    return jsonify({"catalog": effective_catalog(), "inventory": inv,
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
    item = effective_catalog().get(item_id)
    if not item:
        return jsonify({"error": "unknown_item"}), 400
    if item.get("available") is False:
        return jsonify({"error": "unavailable", "error_he": "הפריט אינו זמין כרגע."}), 400
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
    if item_id == "skin_default":
        # Back to the classic tower: nothing equipped means the default look.
        execute("UPDATE user_items SET equipped = 0 WHERE user_id = ? AND"
                " item_id LIKE 'skin_%'", (g.user["id"],))
        return jsonify({"ok": True})
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


@app.get("/api/expansions")
@require_auth
def expansions_get():
    return jsonify(expansion_payload(g.user["id"]))


@app.post("/api/expansions/build")
@require_auth
def expansions_build():
    err = limited("store")
    if err: return err
    uid=g.user["id"]; payload=expansion_payload(uid)
    if not payload["enabled"]: return jsonify({"error":"disabled","error_he":"ההרחבה אינה זמינה כרגע."}),400
    queued=[j["cube_number"] for j in payload["jobs"]]
    next_cube=max([payload["extra_cubes"]]+queued)+1
    if next_cube>payload["max_extra_cubes"]: return jsonify({"error":"max_level","error_he":"הגעת למגבלת ההרחבה."}),400
    price=payload["cube_price"]
    cur=execute("UPDATE users SET coins=coins-? WHERE id=? AND coins>=?",(price,uid,price))
    if cur.rowcount!=1: return jsonify({"error":"insufficient_funds","error_he":"אין מספיק מטבעות."}),400
    last=q("SELECT MAX(completes_at) end_at FROM expansion_jobs WHERE user_id=? AND status IN ('queued','building')",(uid,),one=True)
    starts=max(time.time(),float(last["end_at"] or 0)); completes=starts+payload["build_minutes"]*60
    execute("INSERT INTO expansion_jobs(user_id,cube_number,status,starts_at,completes_at,created_at) VALUES(?,?,?,?,?,?)",
            (uid,next_cube,"building" if starts<=time.time() else "queued",starts,completes,_now_iso()))
    execute("INSERT INTO transactions(user_id,delta,reason,ref,created_at) VALUES(?,?,?,?,?)",
            (uid,-price,"tower_expansion",str(next_cube),_now_iso()))
    audit("user.tower_expansion","cube",next_cube,{"price":price,"completes_at":completes})
    return jsonify({"ok":True,**expansion_payload(uid)})


@app.get("/api/coatings")
@require_auth
def coatings_get():
    return jsonify(coating_payload(g.user["id"]))


@app.post("/api/coatings/build")
@require_auth
def coatings_build():
    err = limited("store")
    if err:
        return err
    uid = g.user["id"]
    payload = coating_payload(uid)
    if not payload["enabled"]:
        return jsonify({"error": "disabled", "error_he": "הבנייה אינה זמינה כרגע."}), 400
    material = (request.get_json(silent=True) or {}).get("material", "")
    catalog = payload["catalog"]
    if material not in catalog:
        return jsonify({"error": "bad_material"}), 400
    current_level = COATING_ORDER.index(payload["current"]["material"]) + 1 if payload["current"] else 0
    queued = [COATING_ORDER.index(j["material"]) + 1 for j in payload["jobs"]]
    expected = max([current_level] + queued) + 1
    if expected > len(COATING_ORDER) or COATING_ORDER[expected - 1] != material:
        return jsonify({"error": "wrong_order", "error_he": "יש לבנות את החומרים לפי הסדר."}), 400
    spec = catalog[material]
    cur = execute("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?",
                  (spec["price"], uid, spec["price"]))
    if cur.rowcount != 1:
        return jsonify({"error": "insufficient_funds", "error_he": "אין מספיק מטבעות."}), 400
    last = q("SELECT MAX(completes_at) end_at FROM coating_jobs WHERE user_id = ?"
             " AND status IN ('queued','building')", (uid,), one=True)
    starts = max(time.time(), float(last["end_at"] or 0))
    completes = starts + spec["minutes"] * 60
    execute("INSERT INTO coating_jobs (user_id, material, status, starts_at, completes_at, created_at)"
            " VALUES (?,?,?,?,?,?)", (uid, material, "building" if starts <= time.time() else "queued",
                                      starts, completes, _now_iso()))
    execute("INSERT INTO transactions (user_id, delta, reason, ref, created_at) VALUES (?,?,?,?,?)",
            (uid, -spec["price"], "coating_build", material, _now_iso()))
    audit("user.coating_build", "material", material, {"price": spec["price"], "completes_at": completes})
    return jsonify({"ok": True, **coating_payload(uid)})


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
    body = request.get_json(silent=True) or {}
    tier = str(body.get("difficulty", "medium")).lower()
    # The client chooses only a difficulty tier. The server privately maps it
    # to a bot rank at or above the player's rank; client-supplied rank is
    # deliberately ignored so it cannot select or forge the opponent rank.
    user_rank_level = rank_payload(g.user["rank_points"])["level"]
    bot_controls = get_gameplay_controls()["bot_difficulty"]
    tier_offsets = {name: int(bot_controls[f"{name}_rank_offset"])
                    for name in ("medium", "hard", "ultra", "expert")}
    tier_offsets.update({"normal": tier_offsets["medium"],
                         "ranked": tier_offsets["medium"]})
    if tier == "easy":
        difficulty = "easy"
        ai_rank_level = None
        ai_tier = "easy"
    elif tier in tier_offsets:
        difficulty = "ranked"
        ai_rank_level = min(MAX_LEVEL, user_rank_level + tier_offsets[tier])
        ai_tier = "medium" if tier in ("medium", "normal", "ranked") else tier
    else:
        return jsonify({"error": "bad_difficulty",
                        "error_he": "רמת הקושי אינה תקינה."}), 400
    mid = secrets.token_hex(6)
    now = _now_iso()
    state = new_state(user_mods(uid), {"armor": 0, "hp": 0, "skin": None})
    state["ai_difficulty"] = difficulty
    state["ai_tier"] = ai_tier
    state["ai_profile"] = {key[len(ai_tier) + 1:]: value
                           for key, value in bot_controls.items()
                           if key.startswith(ai_tier + "_")}
    if ai_rank_level is not None:
        state["ai_rank_level"] = ai_rank_level
    state["ready"] = {"p1": False, "p2": True}
    # The first shot waits only for the tier's reaction delay, not a full
    # reload as well. This makes it obvious that the bot is alive.
    state["last_shot_at"]["p2"] = time.time() - cooldown_for("standard")
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
    # The match clock is server-authoritative. Resolve it before a bot or
    # player can take another shot after the deadline.
    resolve_time_limit(m)
    # AI opponent acts on poll when its cooldown has elapsed (+ reaction delay)
    if m["p2_ai"] and m["status"] == "active":
        last = (m["state"].get("last_shot_at") or {}).get("p2") or 0.0
        difficulty = m["state"].get("ai_difficulty", "normal")
        tier = m["state"].get("ai_tier", difficulty)
        profile = m["state"].get("ai_profile") or {}
        reaction = float(profile.get("reaction", 1.0))
        if time.time() - last > cooldown_for("standard") + reaction:
            # A failed bot turn must never wedge the match on permanent 500s:
            # log it, defer the retry by one cooldown, and still serve a
            # healthy snapshot so the client stays connected and recovers.
            try:
                # Ranked tiers use the mapped rank for accuracy; easy remains
                # the deliberately forgiving practice profile.
                angle, power, weapon = ai_choose_shot(
                    m["state"], "p2", difficulty, m["state"].get("ai_rank_level"), profile)
                abilities = m["state"].setdefault("abilities", {}).setdefault("p2", {})
                if (abilities.get("shield", 0) > 0 and not m["state"].setdefault("shield", {}).get("p2")
                        and random.random() < float(profile.get("shield_chance", 0))):
                    abilities["shield"] -= 1
                    m["state"]["shield"]["p2"] = True
                mega = abilities.get("mega", 0) > 0 and random.random() < float(profile.get("mega_chance", 0))
                if mega:
                    abilities["mega"] -= 1
                events, won = fire_weapon(m["state"], "p2", angle,
                                          min(100, power * (1.2 if mega else 1)), weapon)
                if mega:
                    events.append({"type": "ability", "side": "p2", "ability": "mega"})
                m["version"] += 1
                if won:
                    finalize_match(m, "p2")
                    m["state"]["finish_reason"] = "tower_destroyed"
                    events.append({"type": "match_end", "winner_side": "p2",
                                   "reason": "tower_destroyed"})
                save_match(m)
                emit_events(mid, m["version"], events)
            except Exception:
                app.logger.exception("bot_turn_failed match=%s", mid)
                # Discard any half-mutated in-memory state; only defer the
                # bot's next attempt, leaving the stored match untouched.
                m = load_match(mid)
                m["state"].setdefault("last_shot_at", {})["p2"] = time.time()
                save_match(m)
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
    resolve_time_limit(m)
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
    # Shot-clock enforcement is server-side too. Clients receive the deadline
    # for display/auto-fire, but cannot bypass it by hiding or changing JS.
    deadline = (m["state"].setdefault("last_turn_at", {}).get(side)
                or m["state"].get("started_at", time.time())) + 10
    if time.time() > deadline + 1.5:
        m["state"]["last_turn_at"][side] = time.time()
        save_match(m)
        return jsonify({"error": "shot_clock", "error_he": "זמן הירייה נגמר. השעון התחיל מחדש."}), 408
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
    mega = bool(body.get("mega"))
    if mega:
        charges = m["state"].setdefault("abilities", {}).setdefault(side, {}).get("mega", 0)
        if charges < 1:
            return jsonify({"error": "no_ability", "error_he": "יכולת המגה כבר נוצלה."}), 400
        m["state"]["abilities"][side]["mega"] = charges - 1
    events, won = fire_weapon(m["state"], side, angle, min(100, power * (1.2 if mega else 1)), weapon)
    if mega:
        events.append({"type": "ability", "side": side, "ability": "mega"})
    m["version"] += 1
    if won:
        finalize_match(m, side)
        m["state"]["finish_reason"] = "tower_destroyed"
        events.append({"type": "match_end", "winner_side": side,
                       "reason": "tower_destroyed"})
    save_match(m)
    emit_events(mid, m["version"], events)
    snap = match_snapshot(m, g.user["id"], m["version"] - 1)
    return jsonify(snap)


@app.post("/api/matches/<mid>/move")
@require_auth
def match_move(mid):
    m = load_match(mid)
    side = side_for(m, g.user["id"]) if m else None
    if not m or side is None or m["status"] != "active":
        return jsonify({"error": "not_active"}), 400
    left = m["state"].setdefault("moves_left", {}).get(side, 0)
    if left < 1:
        return jsonify({"error": "no_move", "error_he": "ההזזה כבר נוצלה."}), 400
    direction = -1 if (request.get_json(silent=True) or {}).get("direction") == "left" else 1
    x = m["state"]["tower_x"][side]
    lo, hi = TOWER_X_RANGE[side]
    m["state"]["tower_x"][side] = max(lo, min(hi, x + direction * 45))
    m["state"]["moves_left"][side] = left - 1
    m["version"] += 1; save_match(m)
    emit_events(mid, m["version"], [{"type": "tower_move", "side": side}])
    return jsonify(match_snapshot(m, g.user["id"], m["version"] - 1))


@app.post("/api/matches/<mid>/shield")
@require_auth
def match_shield(mid):
    m = load_match(mid)
    side = side_for(m, g.user["id"]) if m else None
    if not m or side is None or m["status"] != "active":
        return jsonify({"error": "not_active"}), 400
    charges = m["state"].setdefault("abilities", {}).setdefault(side, {}).get("shield", 0)
    if charges < 1:
        return jsonify({"error": "no_ability", "error_he": "המגן כבר נוצל."}), 400
    m["state"]["abilities"][side]["shield"] = charges - 1
    m["state"].setdefault("shield", {})[side] = True
    m["version"] += 1; save_match(m)
    emit_events(mid, m["version"], [{"type": "shield", "side": side, "active": True}])
    return jsonify(match_snapshot(m, g.user["id"], m["version"] - 1))


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
    # The leaders' order is the IDF rank ladder (rank_points), the game's
    # wins-based progression - NOT the Elo-style rating, which moves on a
    # different curve and can place a lower-ranked player on top. Tie-breaks
    # (wins, rating, id) make the order fully deterministic on every call.
    rows = q("SELECT id, name, picture, rating, wins, losses, rank_points"
             " FROM users"
             " WHERE matches_played > 0"
             " ORDER BY rank_points DESC, wins DESC, rating DESC, id ASC"
             " LIMIT 100")
    return jsonify({"leaderboard": [
        {"id": r["id"], "name": r["name"], "picture": r["picture"],
         "rating": r["rating"], "rank": rank_for(r["rating"]),
         "idf_rank": rank_payload(r["rank_points"]),
         "rank_points": round(float(r["rank_points"]), 1),
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
         "idf_rank": rank_payload(r["rank_points"]),
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


@app.get("/api/admin/gameplay-controls")
@require_admin
def admin_gameplay_controls_get():
    err = limited("admin")
    if err:
        return err
    return jsonify({"controls": get_gameplay_controls()})


@app.post("/api/admin/gameplay-controls")
@require_admin
def admin_gameplay_controls_set():
    err = limited("admin")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    raw = body.get("controls")
    if not isinstance(raw, dict):
        return jsonify({"error": "bad_controls"}), 400

    current = get_gameplay_controls()
    specs = {
        "xp": {
            "human_win": (0.0, 100.0, float),
            "bot_win": (0.0, 100.0, float),
            "per_damage": (0.0, 1.0, float),
        },
        "premium_skins": {
            "enabled": (None, None, bool),
            "asset_budget_kb": (10, 500, int),
        },
        "coatings": {
            "enabled": (None, None, bool),
            "max_level": (1, 3, int),
            "build_minutes": (0.01, 10080, float),
            "wood_price": (0, 100000, int), "wood_minutes": (0.01, 10080, float), "wood_hp": (1, 10000, float),
            "tin_price": (0, 100000, int), "tin_minutes": (0.01, 10080, float), "tin_hp": (1, 10000, float),
            "iron_price": (0, 100000, int), "iron_minutes": (0.01, 10080, float), "iron_hp": (1, 10000, float),
        },
        "tower_expansion": {
            "enabled": (None, None, bool),
            "max_extra_cubes": (0, 24, int),
            "build_minutes": (0.01, 10080, float),
            "cube_price": (0, 100000, int),
            "cube_hp": (1, 10000, float),
        },
        "dynamic_obstacle": {
            "enabled": (None, None, bool),
            "speed": (1, 200, float),
            "warning_seconds": (0, 10, float),
        },
        "bot_difficulty": {
            "easy_angle_noise": (0, 45, float),
            "easy_power_spread": (0, 0.5, float),
            "easy_wind_skill": (0, 1, float),
            "easy_reaction": (0, 10, float),
            "easy_rank_offset": (0, 18, int),
            "easy_shield_chance": (0, 1, float),
            "easy_mega_chance": (0, 1, float),
            "medium_angle_noise": (0, 45, float),
            "medium_power_spread": (0, 0.5, float),
            "medium_wind_skill": (0, 1, float),
            "medium_reaction": (0, 10, float),
            "medium_rank_offset": (0, 18, int),
            "medium_shield_chance": (0, 1, float),
            "medium_mega_chance": (0, 1, float),
            "hard_angle_noise": (0, 45, float),
            "hard_power_spread": (0, 0.5, float),
            "hard_wind_skill": (0, 1, float),
            "hard_reaction": (0, 10, float),
            "hard_rank_offset": (0, 18, int),
            "hard_shield_chance": (0, 1, float),
            "hard_mega_chance": (0, 1, float),
            "ultra_angle_noise": (0, 45, float),
            "ultra_power_spread": (0, 0.5, float),
            "ultra_wind_skill": (0, 1, float),
            "ultra_reaction": (0, 10, float),
            "ultra_rank_offset": (0, 18, int),
            "ultra_shield_chance": (0, 1, float),
            "ultra_mega_chance": (0, 1, float),
            "expert_angle_noise": (0, 45, float),
            "expert_power_spread": (0, 0.5, float),
            "expert_wind_skill": (0, 1, float),
            "expert_reaction": (0, 10, float),
            "expert_rank_offset": (0, 18, int),
            "expert_shield_chance": (0, 1, float),
            "expert_mega_chance": (0, 1, float),
        },
    }
    try:
        for section, fields in specs.items():
            incoming = raw.get(section, {})
            if not isinstance(incoming, dict):
                raise ValueError
            for key, (lo, hi, kind) in fields.items():
                if key not in incoming:
                    continue
                value = incoming[key]
                if kind is bool:
                    if not isinstance(value, bool):
                        raise ValueError
                else:
                    value = kind(value)
                    if not math.isfinite(value) or value < lo or value > hi:
                        raise ValueError
                current[section][key] = value
    except (TypeError, ValueError, OverflowError):
        return jsonify({"error": "bad_controls"}), 400

    execute("INSERT INTO settings (key, value) VALUES ('gameplay_controls', ?)"
            " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(current),))
    audit("admin.gameplay_controls", details=current)
    return jsonify({"ok": True, "controls": current})


@app.get("/api/admin/cosmetics")
@require_admin
def admin_cosmetics_list():
    catalog = effective_catalog()
    return jsonify({"cosmetics": [{"item_id": key, **item} for key, item in catalog.items()
                    if item.get("kind") == "skin"]})


@app.post("/api/admin/cosmetics/<item_id>")
@require_admin
def admin_cosmetics_update(item_id):
    base = CATALOG.get(item_id)
    if not base or base.get("kind") != "skin":
        return jsonify({"error": "unknown_cosmetic"}), 404
    body = request.get_json(silent=True) or {}
    try:
        price = int(body.get("price", base["price"]))
    except (TypeError, ValueError):
        return jsonify({"error": "bad_price"}), 400
    if price < 0 or price > 100000:
        return jsonify({"error": "bad_price"}), 400
    available = bool(body.get("available", True))
    execute("INSERT INTO cosmetic_overrides (item_id, price, available, updated_by, updated_at)"
            " VALUES (?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET price=excluded.price,"
            " available=excluded.available, updated_by=excluded.updated_by, updated_at=excluded.updated_at",
            (item_id, price, int(available), g.user["id"], _now_iso()))
    audit("admin.cosmetic_update", "item", item_id,
          {"price": price, "available": available})
    return jsonify({"ok": True, "item_id": item_id, "price": price,
                    "available": available})


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
