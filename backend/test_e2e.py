"""End-to-end API test: 2-client scripted match + store, coupons, admin."""
import os, sys, time, json, math, sqlite3, subprocess, urllib.request
from datetime import datetime, timezone, timedelta

from ranks import rank_payload
from game_logic import (_simulate, ai_choose_shot, new_state, TOWER_COLS,
                        TOWER_ROWS)
from unittest.mock import patch
BASE = "http://127.0.0.1:5000"

def zero_tower(match_id, side):
    """Rubble one side's tower via direct DB edit so the next shot wins."""
    db = sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "brigagame.db"), timeout=15)
    row = db.execute("SELECT state FROM matches WHERE id = ?", (match_id,)).fetchone()
    st = json.loads(row[0])
    st["towers"][side] = [[0] * len(st["towers"][side][0])
                          for _ in st["towers"][side]]
    st["last_shot_at"] = {"p1": 0, "p2": 0}   # skip cooldowns for the kill shot
    db.execute("UPDATE matches SET state = ? WHERE id = ?",
               (json.dumps(st), match_id))
    db.commit()
    db.close()

def call(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

def auth_dev(email, name):
    """Dev login, patient with the server's 10/minute auth rate limit."""
    for _ in range(5):
        _, r = call("POST", "/api/auth/dev", body={"email": email, "name": name})
        if "token" in r:
            return r
        time.sleep(15)
    raise SystemExit("dev login failed: " + json.dumps(r))

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name, extra)
    if not cond: fails.append(name)

def ballistic_state(wind):
    """Deterministic empty battlefield for trajectory regression checks."""
    state = new_state({}, {})
    state["tower_x"] = {"p1": 140, "p2": 760}
    state["wind"] = wind
    state["towers"] = {
        side: [[0] * TOWER_COLS for _ in range(TOWER_ROWS)]
        for side in ("p1", "p2")
    }
    return state


# Wind must be a gameplay force, not only a changing HUD number. Identical
# shots under opposite maximum winds should separate by several blocks and in
# the indicated direction. These checks are deterministic and run before HTTP.
_wind_impacts = {}
for _wind in (-40.0, 0.0, 40.0):
    _x, _y, _points, _off = _simulate(
        ballistic_state(_wind), "p1", 45, 66, "standard", [])
    _wind_impacts[_wind] = _x
check("wind bends shots in displayed direction",
      _wind_impacts[-40.0] < _wind_impacts[0.0] < _wind_impacts[40.0],
      json.dumps(_wind_impacts))
check("maximum opposite winds separate trajectory perceptibly",
      _wind_impacts[40.0] - _wind_impacts[-40.0] >= 70.0,
      json.dumps(_wind_impacts))

# At high bot level, opposite wind changes the solved power in the compensating
# direction. Pin random noise to its midpoint so this remains deterministic.
_ai_powers = {}
with patch("game_logic.random.uniform", side_effect=lambda lo, hi: (lo + hi) / 2):
    for _wind in (-40.0, 0.0, 40.0):
        _state = new_state({}, {})
        _state["tower_x"] = {"p1": 140, "p2": 760}
        _state["wind"] = _wind
        _state["ai_tier"] = "ultra"
        _ai_powers[_wind] = ai_choose_shot(
            _state, "p2", "ranked", 18)[1]
check("high-level bot compensates for wind",
      _ai_powers[-40.0] < _ai_powers[0.0] < _ai_powers[40.0],
      json.dumps(_ai_powers))



# --- auth: two players + admin
a = auth_dev("alice@example.com", "Alice")
b = auth_dev("bob@example.com", "Bob")
adm = auth_dev("ubriga@gmail.com", "Orel")
ta, tb, tadm = a["token"], b["token"], adm["token"]
check("dev auth x3", all([ta, tb, tadm]))
check("admin flag", adm["user"]["is_admin"] is True)
check("alice not admin", a["user"]["is_admin"] is False)
check("welcome coins", a["user"]["coins"] == 200, str(a["user"]["coins"]))

# --- admin guard
s, r = call("GET", "/api/admin/overview", token=ta)
check("non-admin blocked from admin", s == 403)
s, r = call("GET", "/api/admin/overview", token=tadm)
check("admin overview", s == 200 and r["stats"]["users_total"] >= 3)

# --- unauth guard
s, _ = call("GET", "/api/me")
check("no-token 401", s == 401)

CATALOG_SKIN_CRIMSON = ["#ef4444", "#7f1d1d"]

# --- store: buy consumable, upgrade, skin
s, r = call("POST", "/api/store/buy", token=ta, body={"item_id": "double_bomb"})
check("buy double_bomb (90)", s == 200 and r["coins"] == 110, str(r))
s, r = call("POST", "/api/store/buy", token=ta, body={"item_id": "armor"})
check("buy armor L1 (200) insufficient", s == 400 and r["error"] == "insufficient_funds")
call("POST", "/api/admin/users/1/coins", token=tadm, body={"delta": 1000, "reason": "test"})
s, r = call("POST", "/api/store/buy", token=ta, body={"item_id": "armor"})
check("buy armor L1 after grant", s == 200 and r["spent"] == 200)
s, r = call("POST", "/api/store/buy", token=ta, body={"item_id": "skin_gold"})
check("buy gold skin", s == 200)
s, r = call("POST", "/api/store/equip", token=ta, body={"item_id": "skin_gold"})
check("equip skin", s == 200)

# A purchased skin must apply by itself: buying auto-equips, buying a second
# skin switches the active one, and the next match shows those colors.
_, inv_r = call("GET", "/api/store", token=ta)
check("first skin purchase auto-equipped",
      inv_r["inventory"]["skin_gold"]["equipped"] is True,
      json.dumps(inv_r["inventory"].get("skin_gold")))
s, r = call("POST", "/api/store/buy", token=ta, body={"item_id": "skin_crimson"})
check("buy second skin", s == 200, str(r))
_, inv_r = call("GET", "/api/store", token=ta)
check("second skin purchase switches active skin",
      inv_r["inventory"]["skin_crimson"]["equipped"] is True
      and inv_r["inventory"]["skin_gold"]["equipped"] is False,
      json.dumps({k: v for k, v in inv_r["inventory"].items() if k.startswith("skin_")}))
s, skin_match = call("POST", "/api/matches/ai", token=ta, body={"difficulty": "easy"})
s, skin_state = call("GET", f"/api/matches/{skin_match['match_id']}/state?since=0", token=ta)
check("equipped skin colors reach the match",
      s == 200 and skin_state["skins"]["p1"]["colors"] == CATALOG_SKIN_CRIMSON
      and skin_state["skins"]["p1"]["texture"] == "brick"
      and skin_state["skins"]["p1"]["emblem"] == "✦"
      and len(skin_state["skins"]["p1"]["debris"]) >= 3,
      json.dumps(skin_state.get("skins")))
s, r = call("POST", "/api/store/equip", token=ta, body={"item_id": "skin_gold"})
check("re-equip switches back", s == 200)
_, inv_r = call("GET", "/api/store", token=ta)
check("owned skins stay selectable",
      inv_r["inventory"]["skin_gold"]["equipped"] is True
      and inv_r["inventory"]["skin_crimson"]["equipped"] is False)
s, r = call("POST", "/api/store/equip", token=ta, body={"item_id": "skin_default"})
check("equip default skin ok", s == 200, str(r))
s, inv_r = call("GET", "/api/me", token=ta)
check("default skin means nothing equipped",
      all(not v["equipped"] for k, v in inv_r["inventory"].items() if k.startswith("skin_")),
      json.dumps({k: v for k, v in inv_r["inventory"].items() if k.startswith("skin_")}))
s, r = call("POST", "/api/store/equip", token=ta, body={"item_id": "skin_gold"})
check("re-equip after default works", s == 200)

# --- coupon flow
s, r = call("POST", "/api/admin/coupons", token=tadm,
            body={"kind": "coins", "amount": 150, "code": "TEST150", "max_uses": 1})
check("admin create coupon", s == 200 and r["code"] == "TEST150")
s, r = call("POST", "/api/coupons/redeem", token=tb, body={"code": "test150"})
check("bob redeems coupon", s == 200 and "150" in r["reward"])
s, r = call("POST", "/api/coupons/redeem", token=tb, body={"code": "TEST150"})
check("double redeem rejected", s == 400)
s, r = call("POST", "/api/coupons/redeem", token=ta, body={"code": "TEST150"})
check("exhausted coupon rejected", s == 400)

# --- broadcast + messages
s, r = call("POST", "/api/admin/broadcast", token=tadm,
            body={"title": "שלום", "body": "ברוכים הבאים ל-Brigagame 2.0"})
check("admin broadcast", s == 200)
s, r = call("GET", "/api/messages", token=ta)
check("alice sees broadcast", s == 200 and any("Brigagame" in m["body"] for m in r["messages"]))

# --- daily bonus
s, r = call("POST", "/api/daily/claim", token=ta)
check("daily claim", s == 200 and r["amount"] == 50, str(r))
s, r = call("POST", "/api/daily/claim", token=ta)
check("daily double-claim rejected", s == 400)

# --- friend match: create, join, fire until end
s, r = call("POST", "/api/matches/friend", token=ta)
mid, code = r["match_id"], r["code"]
check("friend match created", s == 200 and len(code) == 6)
s, r = call("POST", "/api/matches/join", token=ta, body={"code": code})
check("self-join rejected", s == 400)
s, r = call("POST", "/api/matches/join", token=tb, body={"code": code})
check("bob joins", s == 200 and r["status"] == "active")

s, st = call("GET", f"/api/matches/{mid}/state?since=0", token=ta)
check("state snapshot", s == 200 and st["you"] == "p1" and st["status"] == "active")
check("towers present", len(st["towers"]["p1"]) == 6 and len(st["towers"]["p2"]) == 6)
check("wind present", isinstance(st["wind"], float))
check("random layout present and legal",
      isinstance(st.get("tower_x"), dict)
      and 60 <= st["tower_x"]["p1"] <= 260
      and 640 <= st["tower_x"]["p2"] <= 840
      and st["tower_x"]["p2"] - (st["tower_x"]["p1"] + 104) >= 276,
      json.dumps(st.get("tower_x")))

# cooldown enforcement: fire twice rapidly
s, r = call("POST", f"/api/matches/{mid}/fire", token=ta,
            body={"angle": 45, "power": 60, "weapon": "standard"})
check("alice fires", s == 200 and any(e["type"] == "shot" for e in r["events"]), str(s))
# Dynamic wind: every shot re-rolls the wind and reports it as an event.
_wind_evs = [e for e in r["events"] if e.get("type") == "wind"]
check("shot returns a wind re-roll event", len(_wind_evs) == 1, str(r["events"])[:200])
check("wind event carries the pre-shot wind as previous",
      _wind_evs and _wind_evs[0].get("previous") == st["wind"],
      json.dumps(_wind_evs))
_, _st_after = call("GET", f"/api/matches/{mid}/state?since=0", token=ta)
check("snapshot wind matches the re-rolled wind",
      _wind_evs and _st_after["wind"] == _wind_evs[0]["wind"],
      f'event={_wind_evs[0]["wind"] if _wind_evs else None} snap={_st_after["wind"]}')
s, r = call("POST", f"/api/matches/{mid}/fire", token=ta,
            body={"angle": 45, "power": 60, "weapon": "standard"})
check("cooldown enforced (429)", s == 429 and r["error"] == "reloading")

# consumable in match
time.sleep(5.2)
s, r = call("POST", f"/api/matches/{mid}/fire", token=ta,
            body={"angle": 50, "power": 65, "weapon": "double_bomb"})
check("fire double_bomb (owned)", s == 200)
time.sleep(5.2)
s, r = call("POST", f"/api/matches/{mid}/fire", token=tb,
            body={"angle": 45, "power": 60, "weapon": "homing_missile"})
check("unowned weapon rejected", s == 400 and r["error"] == "no_ammo")

# fire until someone wins (alternating, respecting cooldown). Each shot is
# re-aimed from the live snapshot: the 45-degree ballistic solution at the
# enemy tower's remaining center of mass, elevation-aware. Wind re-rolls
# after every shot but its drift over a ~2s flight stays well inside the
# tower's 104-unit width plus blast radius, so aimed shots keep landing.
def aim_power(snap, side):
    foe = "p2" if side == "p1" else "p1"
    sx = snap["tower_x"][side] + 52
    sy = 520 - 6 * 26 - 8
    blocks = [(snap["tower_x"][foe] + c * 26 + 13, 520 - (6 - r) * 26 + 13)
              for r in range(6) for c in range(4)
              if snap["towers"][foe][r][c] > 0]
    if blocks:
        tx = sum(b[0] for b in blocks) / len(blocks)
        ty = sum(b[1] for b in blocks) / len(blocks)
    else:
        tx, ty = snap["tower_x"][foe] + 52, sy
    dx, dy = abs(tx - sx), ty - sy
    v = math.sqrt(700.0 * dx * dx / max(60.0, dy + dx))
    return max(5, min(100, round(v / 10.0)))

winds_seen = set()
winner = None
halt = False
for i in range(60):
    for tok, side in ((ta, "p1"), (tb, "p2")):
        time.sleep(4.1)
        _, cur = call("GET", f"/api/matches/{mid}/state?since=0", token=tok)
        if cur.get("status") != "active":
            winner = cur.get("winner_side")
            halt = True
            break
        s, r = call("POST", f"/api/matches/{mid}/fire", token=tok,
                    body={"angle": 45, "power": aim_power(cur, side), "weapon": "standard"})
        if s == 200:
            winds_seen.update(e["wind"] for e in r.get("events", [])
                              if e.get("type") == "wind")
        if s == 200 and r.get("winner_side"):
            winner = r["winner_side"]; break
    if winner or halt: break
check("match finishes with winner", winner in ("p1", "p2"), str(winner))
check("wind actually changes between shots",
      len(winds_seen) >= 2, json.dumps(sorted(winds_seen)))
s, st = call("GET", f"/api/matches/{mid}/state?since=0", token=ta)
check("final status finished", st["status"] == "finished")
check("results recorded", st["results"] is not None, json.dumps(st.get("results")))

# rewards applied
_, ma = call("GET", "/api/me", token=ta)
_, mb = call("GET", "/api/me", token=tb)
check("matches_played incremented",
      ma["user"]["matches_played"] >= 1 and mb["user"]["matches_played"] >= 1)
check("rating moved", ma["user"]["rating"] != 1000 or mb["user"]["rating"] != 1000,
      f'a={ma["user"]["rating"]} b={mb["user"]["rating"]}')

# --- IDF rank ladder (wins-only, 18 levels, no turar)
# Source/deploy encoding regression: every label must survive as the exact
# Hebrew rank text, especially geresh/gershayim punctuation.
_expected_rank_labels = [
    ("טוראי", "טור׳"), ("רב טוראי", "רב״ט"), ("סמל", "סמל"),
    ("סמל ראשון", "סמ״ר"), ("רב סמל", "רס״ל"),
    ("רב סמל ראשון", "רס״ר"), ("רב סמל מתקדם", "רס״ם"),
    ("רב סמל בכיר", "רס״ב"), ("רב נגד", "רנ״ג"),
    ("סגן משנה", "סג״מ"), ("סגן", "סגן"), ("סרן", "סרן"),
    ("רב סרן", "רס״ן"), ("סגן אלוף", "סא״ל"),
    ("אלוף משנה", "אל״ם"), ("תת אלוף", "תא״ל"),
    ("אלוף", "אלוף"), ("רב אלוף", "רא״ל"),
]
_actual_rank_labels = [(rank_payload(p)["name_he"], rank_payload(p)["abbr_he"])
                       for p in (0, 6, 12, 20, 30, 42, 56, 72, 90, 110,
                                 140, 180, 230, 290, 360, 450, 560, 700)]
check("all Hebrew rank names and abbreviations are exact",
      _actual_rank_labels == _expected_rank_labels,
      json.dumps(_actual_rank_labels, ensure_ascii=False))
check("rank API JSON round-trip preserves geresh and gershayim",
      json.loads(json.dumps(rank_payload(6)))["abbr_he"] == "רב״ט"
      and json.loads(json.dumps(rank_payload(0)))["abbr_he"] == "טור׳")

winner_side = st["winner_side"]
wres = st["results"][winner_side]
lres = st["results"]["p2" if winner_side == "p1" else "p1"]
check("me exposes idf_rank (level 1 turai at start)",
      "idf_rank" in ma["user"] and "idf_rank" in mb["user"])
check("rank thresholds are doubled: rabat requires 6 and top rank 700",
      ma["user"]["idf_rank"]["next"]["wins_required"] == 6
      and rank_payload(700)["level"] == 18)
check("1 win does not promote (rabat needs 6)",
      wres["idf_rank"]["level"] == 1 and wres["idf_rank"]["abbr_he"] == "טור׳"
      and "rank_up" not in wres, json.dumps(wres.get("idf_rank")))
check("loser stays turai with progress",
      lres["idf_rank"]["level"] == 1 and lres["idf_rank"]["next"]["wins_to_go"] >= 2)

# force both players to 5 points; a quick second match (alice fires, bob leaves)
# makes alice's 3rd win -> promotion to rabat. Leave-win avoids a full match.
aid_, bid_ = ma["user"]["id"], mb["user"]["id"]
_db = sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "brigagame.db"), timeout=15)
_db.execute("UPDATE users SET rank_points = 5, wins = 5 WHERE id IN (?, ?)", (aid_, bid_))
_db.commit(); _db.close()
s, r = call("POST", "/api/matches/friend", token=ta)
code2 = r["code"]; mid2 = r["match_id"]
call("POST", "/api/matches/join", token=tb, body={"code": code2})
call("POST", f"/api/matches/{mid2}/ready", token=ta)
call("POST", f"/api/matches/{mid2}/ready", token=tb)
s, r = call("POST", f"/api/matches/{mid2}/fire", token=ta,
            body={"angle": 45, "power": 64, "weapon": "standard"})
check("alice fires in promotion match", s == 200)
s, r = call("POST", f"/api/matches/{mid2}/leave", token=tb)
check("bob concedes promotion match", s == 200)
s, st2x = call("GET", f"/api/matches/{mid2}/state?since=0", token=ta)
check("promotion match finished for alice",
      st2x["status"] == "finished" and st2x["winner_side"] == "p1", str(st2x.get("status")))
w2res = st2x["results"]["p1"]
check("6th point promotes to rabat (level 2)",
      w2res["idf_rank"]["level"] == 2 and w2res["idf_rank"]["abbr_he"] == "רב״ט",
      json.dumps(w2res.get("idf_rank")))
check("rank_up event on promotion",
      w2res.get("rank_up", {}).get("from_level") == 1
      and w2res.get("rank_up", {}).get("to_level") == 2
      and w2res.get("rank_up", {}).get("abbr_he") == "רב״ט", json.dumps(w2res.get("rank_up")))
_, mw = call("GET", "/api/me", token=ta)
check("winner me shows level 2 with next threshold",
      mw["user"]["idf_rank"]["level"] == 2
      and mw["user"]["idf_rank"]["next"]["wins_required"] == 12,
      json.dumps(mw["user"]["idf_rank"]))
s, lb = call("GET", "/api/leaderboard", token=ta)
check("leaderboard exposes idf_rank",
      s == 200 and all("idf_rank" in r for r in lb["leaderboard"]))
s, st3 = call("GET", f"/api/matches/{mid2}/state?since=0", token=ta)
check("match players expose idf_rank with insignia path",
      st3["players"]["p1"]["idf_rank"]["level"] == 2
      and st3["players"]["p1"]["idf_rank"]["insignia"].startswith("assets/ranks/rank-"))

# --- AI match
s, r = call("POST", "/api/matches/ai", token=tb)
aid = r["match_id"]
check("ai match active", s == 200 and r["status"] == "active")
check("ai defaults to ranked floor", call("GET", f"/api/matches/{aid}/state?since=0", token=tb)[1]["ai_difficulty"] == "ranked")
s, st = call("GET", f"/api/matches/{aid}/state?since=0", token=tb)
check("ai opponent named", st["players"]["p2"]["name"] == "OrelAI Bot")
check("ranked bot floor and displayed insignia match player",
      st["ai_rank_level"] == st["players"]["p1"]["idf_rank"]["level"]
      and st["players"]["p2"]["idf_rank"]["level"] == st["players"]["p1"]["idf_rank"]["level"])
tier_levels = {}
for tier in ("medium", "hard", "ultra"):
    s, tier_match = call("POST", "/api/matches/ai", token=tb,
                         body={"difficulty": tier, "bot_rank_level": 18})
    _, tier_st = call("GET", f"/api/matches/{tier_match['match_id']}/state?since=0", token=tb)
    tier_levels[tier] = tier_st["ai_rank_level"]
    check(f"{tier} bot tier starts ranked match",
          s == 200 and tier_st["ai_difficulty"] == "ranked"
          and tier_st["ai_rank_level"] >= tier_st["players"]["p1"]["idf_rank"]["level"])
check("server maps tiers automatically and ignores client bot rank",
      tier_levels["medium"] < tier_levels["hard"] <= tier_levels["ultra"]
      and tier_levels["medium"] != 18, json.dumps(tier_levels))
# Backdate each bot cooldown, then poll once: every public tier must react.
for tier in ("easy", "medium", "hard", "ultra"):
    _, active = call("POST", "/api/matches/ai", token=tb, body={"difficulty": tier})
    active_id = active["match_id"]
    with sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "brigagame.db")) as ai_db:
        row = ai_db.execute("SELECT state FROM matches WHERE id = ?",
                            (active_id,)).fetchone()
        ai_state = json.loads(row[0])
        ai_state["last_shot_at"]["p2"] = 0
        ai_db.execute("UPDATE matches SET state = ? WHERE id = ?",
                      (json.dumps(ai_state), active_id))
    _, active_state = call("GET", f"/api/matches/{active_id}/state?since=0", token=tb)
    check(f"{tier} bot fires and reacts on poll",
          any(e["type"] == "shot" and e.get("side") == "p2"
              for e in active_state["events"]))

# --- a broken bot-match state must never 500 the state endpoint.
# Regression for the 2026-09-15 production incident: a bot match whose state
# cannot be simulated (here: towers missing) permanently 500'd every poll,
# wedging the client on "reconnecting". The endpoint must keep serving 200,
# defer the bot's retry, and leave the stored match consistent.
_, broken = call("POST", "/api/matches/ai", token=tb, body={"difficulty": "medium"})
broken_id = broken["match_id"]
with sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "brigagame.db")) as bdb:
    row = bdb.execute("SELECT state, version FROM matches WHERE id = ?",
                      (broken_id,)).fetchone()
    bst = json.loads(row[0])
    bver = row[1]
    del bst["towers"]                 # corrupt: the bot cannot aim or fire
    bst["last_shot_at"]["p2"] = 0     # ...and its turn is already due
    bdb.execute("UPDATE matches SET state = ? WHERE id = ?",
                (json.dumps(bst), broken_id))
s, r = call("GET", f"/api/matches/{broken_id}/state?since=0", token=tb)
check("broken bot-match state still returns 200", s == 200, str(s)[:120])
check("broken match snapshot stays consistent",
      r.get("id") == broken_id and r.get("status") == "active"
      and r.get("towers") is None, json.dumps(r)[:120])
# No half-written bot turn: the failed attempt only defers the next one.
check("failed bot turn does not bump match version",
      r.get("version") == bver, f'{r.get("version")} vs {bver}')
s, r = call("GET", f"/api/matches/{broken_id}/state?since=0", token=tb)
check("broken match keeps serving 200 on repeat polls", s == 200, str(s)[:120])
# The player is not trapped: leaving the broken match is a clean void abort.
s, r = call("POST", f"/api/matches/{broken_id}/leave", token=tb)
check("broken match can be left cleanly", s == 200, str(s)[:120])
s, r = call("GET", f"/api/matches/{broken_id}/state?since=0", token=tb)
check("abandoned broken match state returns 200 after leave",
      s == 200 and r.get("status") == "aborted", str(s)[:120])

# --- bot-win rank weighting: easy = practice (0 pts), normal/hard = 0.5
_, practice_before = call("GET", "/api/me", token=tb)
s, r = call("POST", "/api/matches/ai", token=tb, body={"difficulty": "easy"})
easy_id = r["match_id"]
s, st = call("GET", f"/api/matches/{easy_id}/state?since=0", token=tb)
check("easy bot match flagged as practice", st.get("practice") is True)
zero_tower(easy_id, "p2")
s, r = call("POST", f"/api/matches/{easy_id}/fire", token=tb,
            body={"angle": 45, "power": 60, "weapon": "standard"})
check("kill shot ends practice match", s == 200, str(r))
s, st = call("GET", f"/api/matches/{easy_id}/state?since=0", token=tb)
check("practice match won by player",
      st["status"] == "finished" and st["winner_side"] == "p1", str(st.get("status")))
check("practice win awards exactly zero coins",
      st["results"]["p1"]["coins"] == 0 and st["results"]["p1"]["hit_coins"] == 0,
      json.dumps(st["results"]["p1"]))
check("practice results marked",
      st["results"]["p1"].get("practice") is True)
check("practice win awards 0 rank points",
      st["results"]["p1"].get("rank_points_awarded") == 0,
      json.dumps(st["results"]["p1"]))
_, mb2 = call("GET", "/api/me", token=tb)
check("practice win leaves coins, rating, record and rank untouched",
      mb2["user"]["coins"] == practice_before["user"]["coins"]
      and mb2["user"]["rating"] == practice_before["user"]["rating"]
      and mb2["user"]["wins"] == practice_before["user"]["wins"]
      and mb2["user"]["losses"] == practice_before["user"]["losses"]
      and mb2["user"]["idf_rank"]["wins"] == practice_before["user"]["idf_rank"]["wins"],
      json.dumps({"before": practice_before["user"], "after": mb2["user"]}))

tc = auth_dev(f"carol-{int(time.time())}@example.com", "Carol")["token"]
s, r = call("POST", "/api/matches/ai", token=tc, body={"difficulty": "normal"})
nid = r["match_id"]
s, st = call("GET", f"/api/matches/{nid}/state?since=0", token=tc)
check("normal bot match is not practice", st.get("practice") is False)
with sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "brigagame.db")) as cap_db:
    cap_row = cap_db.execute("SELECT state FROM matches WHERE id = ?", (nid,)).fetchone()
    cap_state = json.loads(cap_row[0])
    cap_state["damage_dealt"]["p1"] = 5000
    cap_db.execute("UPDATE matches SET state = ? WHERE id = ?", (json.dumps(cap_state), nid))
_, cap_before = call("GET", "/api/me", token=tc)
zero_tower(nid, "p2")
s, r = call("POST", f"/api/matches/{nid}/fire", token=tc,
            body={"angle": 45, "power": 60, "weapon": "standard"})
s, st = call("GET", f"/api/matches/{nid}/state?since=0", token=tc)
check("normal bot match won by player",
      st["status"] == "finished" and st["winner_side"] == "p1", str(st.get("status")))
_, cap_after = call("GET", "/api/me", token=tc)
check("ranked win reward varies by destruction and stays below hard cap",
      0 < st["results"]["p1"]["coins"] <= 50
      and cap_after["user"]["coins"] - cap_before["user"]["coins"]
          == st["results"]["p1"]["coins"],
      json.dumps(st["results"]["p1"]))

# Reward completeness regression: a minimum winning destruction pays less than
# full destruction; stronger tiers/ranks can raise the full-destruction ceiling.
from economy import win_reward_coins
base_hp = 18 * 4 * 6
minimum_win = win_reward_coins(base_hp * .75, base_hp, 1, "medium")
full_medium = win_reward_coins(base_hp, base_hp, 1, "medium")
full_ultra = win_reward_coins(base_hp, base_hp, 18, "ultra")
check("win reward varies by destruction completeness and bot strength",
      0 < minimum_win < full_medium < full_ultra <= 50,
      json.dumps({"minimum_win": minimum_win, "full_medium": full_medium,
                  "full_ultra": full_ultra}))
check("normal bot win awards half a rank point",
      st["results"]["p1"].get("rank_points_awarded") == 0.5,
      json.dumps(st["results"]["p1"]))
_, mc = call("GET", "/api/me", token=tc)
check("half point reflected in rank progress",
      mc["user"]["idf_rank"]["wins"] == 0.5
      and mc["user"]["idf_rank"]["level"] == 1
      and mc["user"]["idf_rank"]["next"]["wins_to_go"] == 5.5,
      json.dumps(mc["user"]["idf_rank"]))

# --- rank-point deductions: practice exempt; ranked bots and humans scale
with sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "brigagame.db")) as loss_db:
    loss_db.execute("UPDATE users SET rank_points = 55 WHERE id = ?", (bid_,))
s, r = call("POST", "/api/matches/ai", token=tb,
            body={"difficulty": "hard"})
loss_id = r["match_id"]
zero_tower(loss_id, "p1")
# Let the bot finish the already-rubbled player tower on state polling.
with sqlite3.connect(os.path.join(os.path.dirname(os.path.abspath(__file__)), "brigagame.db")) as loss_db:
    row = loss_db.execute("SELECT state FROM matches WHERE id = ?", (loss_id,)).fetchone()
    loss_state = json.loads(row[0]); loss_state["last_shot_at"]["p2"] = 0
    loss_db.execute("UPDATE matches SET state = ? WHERE id = ?", (json.dumps(loss_state), loss_id))
_, loss_st = call("GET", f"/api/matches/{loss_id}/state?since=0", token=tb)
check("ranked same-rank bot loss deducts scaled points",
      loss_st["status"] == "finished"
      and loss_st["results"]["p1"].get("rank_points_lost") == 0.4,
      json.dumps(loss_st.get("results")))
_, after_loss = call("GET", "/api/me", token=tb)
check("rank points reduced server-side", after_loss["user"]["idf_rank"]["wins"] == 54.6,
      json.dumps(after_loss["user"]["idf_rank"]))

# --- quick match consent + two-way real-time sync
s, r1 = call("POST", "/api/matches/quick", token=ta)
qmid = r1["match_id"]
# Owner's waiting-screen poll is the heartbeat that makes this match eligible.
s, waiting_state = call("GET", f"/api/matches/{qmid}/state?since=0", token=ta)
check("quick match owner waits safely", s == 200 and waiting_state["status"] == "waiting")
s, offer = call("POST", "/api/matches/quick", token=tb)
check("quick match asks second player",
      s == 200 and offer["match_id"] == qmid and offer["status"] == "offered", str(offer))
s, hidden = call("GET", f"/api/matches/{qmid}/state?since=0", token=tb)
check("offer does not auto-join player", s == 404, str(hidden))
s, accepted = call("POST", f"/api/matches/{qmid}/accept", token=tb)
check("player explicitly accepts", s == 200 and accepted["status"] == "active", str(accepted))
s, qa = call("GET", f"/api/matches/{qmid}/state?since=0", token=ta)
s2, qb = call("GET", f"/api/matches/{qmid}/state?since=0", token=tb)
check("both clients receive complete initial state",
      s == s2 == 200 and qa["you"] == "p1" and qb["you"] == "p2"
      and len(qa["towers"]["p1"]) == 6 and len(qb["towers"]["p2"]) == 6)
call("POST", f"/api/matches/{qmid}/ready", token=ta)
call("POST", f"/api/matches/{qmid}/ready", token=tb)
# Standard weapons are ready immediately. A p1 shot must become visible to p2.
s, shot_a = call("POST", f"/api/matches/{qmid}/fire", token=ta,
                 body={"angle": 45, "power": 45, "weapon": "standard"})
s2, seen_b = call("GET", f"/api/matches/{qmid}/state?since={qb['version']}", token=tb)
check("p1 state update reaches p2",
      s == s2 == 200 and any(e.get("type") == "shot" and e.get("side") == "p1"
                            for e in seen_b.get("events", [])))
s, shot_b = call("POST", f"/api/matches/{qmid}/fire", token=tb,
                 body={"angle": 45, "power": 45, "weapon": "standard"})
s2, seen_a = call("GET", f"/api/matches/{qmid}/state?since={shot_a['version']}", token=ta)
check("p2 state update reaches p1",
      s == s2 == 200 and any(e.get("type") == "shot" and e.get("side") == "p2"
                            for e in seen_a.get("events", [])))

# Leaving before either client has marked the game loaded is a technical abort,
# not a win/loss or rating event.
s, abort_wait = call("POST", "/api/matches/quick", token=ta)
abmid = abort_wait["match_id"]
call("GET", f"/api/matches/{abmid}/state?since=0", token=ta)
s, abort_offer = call("POST", "/api/matches/quick", token=tb)
call("POST", f"/api/matches/{abmid}/accept", token=tb)
_, before_a = call("GET", "/api/me", token=ta)
_, before_b = call("GET", "/api/me", token=tb)
call("POST", f"/api/matches/{abmid}/leave", token=tb)
_, after_a = call("GET", "/api/me", token=ta)
_, after_b = call("GET", "/api/me", token=tb)
_, aborted = call("GET", f"/api/matches/{abmid}/state?since=0", token=ta)
check("technical load failure is void, not a loss",
      aborted["status"] == "aborted" and before_a["user"]["wins"] == after_a["user"]["wins"]
      and before_b["user"]["losses"] == after_b["user"]["losses"])

# Decline releases the reservation without joining or harming the waiting owner.
s, d1 = call("POST", "/api/matches/quick", token=ta)
dmid = d1["match_id"]
call("GET", f"/api/matches/{dmid}/state?since=0", token=ta)
s, d2 = call("POST", "/api/matches/quick", token=tb)
s, declined = call("POST", f"/api/matches/{dmid}/decline", token=tb)
s2, still_waiting = call("GET", f"/api/matches/{dmid}/state?since=0", token=ta)
check("quick match decline path", s == 200 and declined["declined"] and
      s2 == 200 and still_waiting["status"] == "waiting")
call("POST", f"/api/matches/{dmid}/leave", token=ta)  # clean up the waiting match

# --- presence invites: present-anywhere players get quick-match offers
run_tag = str(int(time.time()))
def devlogin(name):
    return auth_dev(f"{name}-{run_tag}@example.com", name.title())["token"]
tc = devlogin("carol"); td = devlogin("dave"); te = devlogin("erin"); tf = devlogin("frank")

# carol is simply present in the app - she never clicks quick match.
s, hb = call("POST", "/api/presence/ping", token=tc)
check("presence ping ok", s == 200 and hb.get("ok") and hb.get("offer") is None, str(hb))
# Server and client versions must move together (lobby reload handshake).
_cfg = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                         "..", "frontend", "js", "config.js"),
            encoding="utf-8").read()
import re as _re
_client_ver = _re.search(r'CLIENT_VERSION:\s*"([^"]+)"', _cfg).group(1)
check("presence ping carries server_version matching client",
      hb.get("server_version") == _client_ver,
      f'server={hb.get("server_version")} client={_client_ver}')

# --- maintenance flag (D1): admin toggle carried in the presence pulse
s, r = call("GET", "/api/admin/maintenance", token=ta)
check("non-admin blocked from maintenance", s == 403)
s, r = call("POST", "/api/admin/maintenance", token=tadm, body={"on": True, "message": "תחזוקה מתוכננת"})
check("admin sets maintenance on", s == 200 and r["maintenance"]["on"] is True, str(r))
s, hb = call("POST", "/api/presence/ping", token=ta)
check("pulse carries maintenance", s == 200 and hb["maintenance"]["on"] is True
      and hb["maintenance"]["message"] == "תחזוקה מתוכננת", str(hb.get("maintenance")))
s, r = call("GET", "/api/me", token=ta)
check("/api/me carries maintenance", s == 200 and r["maintenance"]["on"] is True, str(r.get("maintenance")))
s, r = call("POST", "/api/admin/maintenance", token=tadm, body={"on": False, "message": ""})
s, hb = call("POST", "/api/presence/ping", token=ta)
check("maintenance off clears pulse", s == 200 and r["maintenance"]["on"] is False
      and hb["maintenance"]["on"] is False)

# dave clicks quick; with no waiting match he waits, and the system should
# immediately offer his match to carol.
s, dq = call("POST", "/api/matches/quick", token=td)
lmid = dq["match_id"]
check("dave waits for an opponent", s == 200 and dq["status"] == "waiting", str(dq))
s, hb = call("POST", "/api/presence/ping", token=tc)
check("idle present player receives invite",
      s == 200 and hb.get("offer") and hb["offer"]["match_id"] == lmid, str(hb))
s, hidden2 = call("GET", f"/api/matches/{lmid}/state?since=0", token=tc)
check("presence invite does not auto-join", s == 404, str(hidden2))

# decline falls back to another present player on the owner's next poll.
s, dec = call("POST", f"/api/matches/{lmid}/decline", token=tc)
check("carol declines", s == 200 and dec["declined"])
call("POST", "/api/presence/ping", token=te)            # erin is present too
call("GET", f"/api/matches/{lmid}/state?since=0", token=td)  # owner poll drives fallback
s, hb = call("POST", "/api/presence/ping", token=te)
check("decline falls back to another present player",
      s == 200 and hb.get("offer") and hb["offer"]["match_id"] == lmid, str(hb))
s, hb_c = call("POST", "/api/presence/ping", token=tc)
check("declining player is not re-invited",
      s == 200 and hb_c.get("offer") is None, str(hb_c))

# timeout also falls back: erin ignores the invite until it expires.
wait_s = int(hb["offer"].get("expires_in", 20)) + 2
print(f"waiting {wait_s}s for offer expiry...")
time.sleep(wait_s)
call("POST", "/api/presence/ping", token=tf)            # frank becomes present
call("GET", f"/api/matches/{lmid}/state?since=0", token=td)
s, hb = call("POST", "/api/presence/ping", token=tf)
check("timeout falls back to a new present player",
      s == 200 and hb.get("offer") and hb["offer"]["match_id"] == lmid, str(hb))
s, hb_e = call("POST", "/api/presence/ping", token=te)
check("timed-out player is not re-invited", s == 200 and hb_e.get("offer") is None, str(hb_e))

# frank accepts from the prompt: both clients see the active game.
s, acc = call("POST", f"/api/matches/{lmid}/accept", token=tf)
check("invited player accepts", s == 200 and acc["status"] == "active", str(acc))
s, sd = call("GET", f"/api/matches/{lmid}/state?since=0", token=td)
s2, sf = call("GET", f"/api/matches/{lmid}/state?since=0", token=tf)
check("both clients enter the game",
      s == s2 == 200 and sd["status"] == sf["status"] == "active"
      and sd["you"] == "p1" and sf["you"] == "p2"
      and len(sd["towers"]["p1"]) == 6 and len(sf["towers"]["p2"]) == 6)
# frank is now busy in an active match: not eligible for more invites.
s, dq2 = call("POST", "/api/matches/quick", token=tc)
check("carol can still quick-click", s == 200 and dq2["status"] in ("waiting", "offered"), str(dq2))
call("POST", f"/api/matches/{dq2['match_id']}/leave", token=tc)
call("POST", f"/api/matches/{lmid}/leave", token=tf)
call("POST", f"/api/matches/{lmid}/leave", token=td)

# --- unread-messages indicator data
call("POST", "/api/admin/broadcast", token=tadm,
     body={"title": "בדיקה", "body": "הודעת בדיקה לכל השחקנים"})
s, hb = call("POST", "/api/presence/ping", token=tc)
check("ping reports unread messages", s == 200 and hb.get("unread_messages", 0) >= 1, str(hb))
call("GET", "/api/messages", token=tc)  # viewing marks read
s, hb = call("POST", "/api/presence/ping", token=tc)
check("unread clears after reading", s == 200 and hb.get("unread_messages") == 0, str(hb))

# --- moderation
s, r = call("GET", "/api/admin/users", token=tadm)
bob_id = [u for u in r["users"] if u["email"] == "bob@example.com"][0]["id"]
s, r = call("POST", f"/api/admin/users/{bob_id}/moderate", token=tadm,
            body={"action": "ban", "hours": 1})
check("admin ban", s == 200)
s, r = call("POST", "/api/matches/ai", token=tb)
check("banned user cannot play", s == 403)
s, r = call("POST", f"/api/admin/users/{bob_id}/moderate", token=tadm, body={"action": "lift"})
check("admin lift", s == 200)
s, r = call("POST", "/api/matches/ai", token=tb)
check("unbanned user can play", s == 200)

# --- leaderboard
s, r = call("GET", "/api/leaderboard", token=ta)
check("leaderboard", s == 200 and len(r["leaderboard"]) >= 1)

# --- leaderboard ordering regression (the leaders' order, guaranteed)
# Craft three players whose Elo rating order CONTRADICTS their IDF rank
# order. The table must follow rank points (the wins-based ladder), with
# deterministic tie-breaks, identically on every call.
_LB_DB = os.environ.get(
    "DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "brigagame.db"))

def _craft_user(email, name, rating, rank_points, wins):
    db = sqlite3.connect(_LB_DB, timeout=15)
    db.execute("INSERT INTO users (email, name, picture, coins, rating, wins,"
               " rank_points, losses, matches_played, created_at)"
               " VALUES (?,?, '', 0, ?, ?, ?, 0, 1, ?)",
               (email, name, rating, wins, rank_points,
                datetime.now(timezone.utc).isoformat()))
    db.commit()
    uid = db.execute("SELECT id FROM users WHERE email = ?",
                     (email,)).fetchone()[0]
    db.close()
    return uid

_lb_tag = str(int(time.time()))
u_hirank = _craft_user(f"sortb-{_lb_tag}@example.com", "SortB", 1100, 9.0, 9)
u_tie    = _craft_user(f"sortc-{_lb_tag}@example.com", "SortC", 1200, 9.0, 5)
u_hielo  = _craft_user(f"sorta-{_lb_tag}@example.com", "SortA", 1400, 2.0, 2)

s, lb1 = call("GET", "/api/leaderboard", token=ta)
order1 = [row["id"] for row in lb1["leaderboard"]]
def _pos(uid):
    return order1.index(uid) if uid in order1 else 10 ** 9
check("leaderboard sorted by rank points, not rating",
      s == 200 and _pos(u_hirank) < _pos(u_tie) < _pos(u_hielo),
      str(order1))
pts_seq = [row["rank_points"] for row in lb1["leaderboard"]]
check("leaderboard rank points monotonic non-increasing",
      all(a >= b for a, b in zip(pts_seq, pts_seq[1:])), str(pts_seq))
s, lb2 = call("GET", "/api/leaderboard", token=ta)
check("leaderboard order deterministic across calls",
      s == 200 and [row["id"] for row in lb2["leaderboard"]] == order1)

# --- remember-me wiring (client): token storage honors the checkbox
_fe = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "js")
_api_js = open(os.path.join(_fe, "api.js"), encoding="utf-8").read()
_app_js = open(os.path.join(_fe, "app.js"), encoding="utf-8").read()
check("remember-me checkbox on login screen",
      'id="remember-me"' in _app_js and "זכור אותי" in _app_js)
check("session-only storage when remember-me is off",
      "sessionStorage" in _api_js and "remember" in _api_js)

# --- stale-match sweep: abandoned matches end as void, never ranked losses
DB_FILE = os.environ.get(
    "DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "brigagame.db"))

def set_wins(user_id, wins):
    db = sqlite3.connect(DB_FILE, timeout=15)
    db.execute("UPDATE users SET wins = ? WHERE id = ?", (wins, user_id))
    db.commit()
    db.close()

def backdate(match_id, seconds):
    db = sqlite3.connect(DB_FILE, timeout=15)
    old = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
    db.execute("UPDATE matches SET updated_at = ? WHERE id = ?", (old, match_id))
    db.commit()
    db.close()

def trigger_sweep():
    # An unauthenticated request carries the sweep without touching anyone's
    # presence heartbeat.
    call("GET", "/api/me")

def set_match_age(match_id, seconds, updated_too=False):
    db = sqlite3.connect(DB_FILE, timeout=15)
    row = db.execute("SELECT state FROM matches WHERE id = ?", (match_id,)).fetchone()
    st = json.loads(row[0])
    st["started_at"] = time.time() - seconds
    if updated_too:
        old = (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()
        db.execute("UPDATE matches SET state = ?, updated_at = ? WHERE id = ?",
                   (json.dumps(st), old, match_id))
    else:
        db.execute("UPDATE matches SET state = ? WHERE id = ?",
                   (json.dumps(st), match_id))
    db.commit(); db.close()

def set_tower_fraction(match_id, side, fraction):
    db = sqlite3.connect(DB_FILE, timeout=15)
    row = db.execute("SELECT state FROM matches WHERE id = ?", (match_id,)).fetchone()
    st = json.loads(row[0])
    for r, vals in enumerate(st["towers"][side]):
        for c, hp in enumerate(vals):
            st["towers"][side][r][c] = round(hp * fraction, 3)
    db.execute("UPDATE matches SET state = ? WHERE id = ?", (json.dumps(st), match_id))
    db.commit(); db.close()

tg = auth_dev(f"stale-{run_tag}@example.com", "Stale")["token"]
_, me0 = call("GET", "/api/me", token=tg)

# --- three-minute server clock: integrity winner, exact tie, and bot coverage
tta = auth_dev(f"timer-a-{run_tag}@example.com", "Timer A")["token"]
ttb = auth_dev(f"timer-b-{run_tag}@example.com", "Timer B")["token"]
_, before_ta = call("GET", "/api/me", token=tta)
_, before_tb = call("GET", "/api/me", token=ttb)
s, r = call("POST", "/api/matches/friend", token=tta)
tmid, tcode = r["match_id"], r["code"]
call("POST", "/api/matches/join", token=ttb, body={"code": tcode})
s, active_clock = call("GET", f"/api/matches/{tmid}/state?since=0", token=tta)
check("active snapshot exposes three-minute deadline",
      s == 200 and 178 <= active_clock["match_ends_at"] - active_clock["server_time"] <= 181,
      str(active_clock.get("match_ends_at")))
set_tower_fraction(tmid, "p2", .75)
set_match_age(tmid, 180)
s, timed = call("GET", f"/api/matches/{tmid}/state?since=0", token=tta)
check("three-minute integrity lead decides human match",
      s == 200 and timed["status"] == "finished" and timed["winner_side"] == "p1"
      and timed["finish_reason"] == "time_limit"
      and timed["time_limit_integrity"]["p1"] > timed["time_limit_integrity"]["p2"],
      json.dumps(timed))
check("timed winner uses normal economy",
      timed["results"]["p1"]["outcome"] == "win"
      and timed["results"]["p2"]["outcome"] == "loss"
      and timed["results"]["p1"]["rank_points_awarded"] == 1.0,
      json.dumps(timed.get("results")))
# Re-polling cannot apply the timed economy twice.
call("GET", f"/api/matches/{tmid}/state?since=0", token=ttb)
_, after_ta = call("GET", "/api/me", token=tta)
_, after_tb = call("GET", "/api/me", token=ttb)
check("timed economy applies exactly once",
      after_ta["user"]["matches_played"] == before_ta["user"]["matches_played"] + 1
      and after_tb["user"]["matches_played"] == before_tb["user"]["matches_played"] + 1)

# Equal integrity is a neutral draw: no coins, rating, rank or match stats.
_, draw0 = call("GET", "/api/me", token=tta)
s, r = call("POST", "/api/matches/friend", token=tta)
dmid, dcode = r["match_id"], r["code"]
call("POST", "/api/matches/join", token=ttb, body={"code": dcode})
set_match_age(dmid, 180)
s, draw = call("GET", f"/api/matches/{dmid}/state?since=0", token=tta)
_, draw1 = call("GET", "/api/me", token=tta)
check("equal tower integrity ends as draw",
      s == 200 and draw["status"] == "finished" and draw["winner_side"] is None
      and draw["finish_reason"] == "time_limit"
      and draw["results"]["p1"]["outcome"] == draw["results"]["p2"]["outcome"] == "draw")
check("draw is economy-neutral",
      draw0["user"]["coins"] == draw1["user"]["coins"]
      and draw0["user"]["rating"] == draw1["user"]["rating"]
      and draw0["user"]["matches_played"] == draw1["user"]["matches_played"]
      and draw0["user"]["idf_rank"]["wins"] == draw1["user"]["idf_rank"]["wins"])

# The same clock applies to bot matches and resolves before the bot can fire.
s, r = call("POST", "/api/matches/ai", token=tta, body={"difficulty": "easy"})
btmid = r["match_id"]
set_tower_fraction(btmid, "p1", .7)
set_match_age(btmid, 180)
s, bot_timed = call("GET", f"/api/matches/{btmid}/state?since=0", token=tta)
check("three-minute integrity rule covers bot matches",
      s == 200 and bot_timed["status"] == "finished"
      and bot_timed["winner_side"] == "p2" and bot_timed["finish_reason"] == "time_limit",
      json.dumps(bot_timed))

# An AI match abandoned for >5m (the universal open-match stale window).
s, r = call("POST", "/api/matches/ai", token=tg)
smid = r["match_id"]
check("ai match created for stale test", s == 200 and r["status"] == "active")
backdate(smid, 6 * 60)
trigger_sweep()   # dev mode bypasses the sweep throttle, so this runs now
s, st = call("GET", f"/api/matches/{smid}/state?since=0", token=tg)
check("stale active match auto-aborted",
      s == 200 and st["status"] == "aborted", str(st.get("status")))
check("stale abort is void (no winner)",
      st.get("winner_side") is None
      and st["results"]["p1"]["outcome"] == "void"
      and st["results"]["p2"]["outcome"] == "void", json.dumps(st.get("results")))
_, me1 = call("GET", "/api/me", token=tg)
check("stale abort moves no rating/coins/stats",
      me0["user"]["rating"] == me1["user"]["rating"]
      and me0["user"]["coins"] == me1["user"]["coins"]
      and me0["user"]["matches_played"] == me1["user"]["matches_played"],
      f'before={me0["user"]} after={me1["user"]}')

# A waiting quick match whose owner vanished for >5m.
s, r = call("POST", "/api/matches/quick", token=tg)
wmid = r["match_id"]
check("waiting match created for stale test", s == 200 and r["status"] == "waiting")
backdate(wmid, 6 * 60)
time.sleep(1.2)
trigger_sweep()
s, st = call("GET", f"/api/matches/{wmid}/state?since=0", token=tg)
check("stale waiting match purged", s == 404, str(s))

# The original lockout: while a player sits in an abandoned active match, no
# presence invite can reach them. After the sweep frees them, it can.
# Let every earlier heartbeat fall outside the 25s presence window so the
# only eligible players in this section are the ones we ping here.
time.sleep(26)
tiv = auth_dev(f"ivy-{run_tag}@example.com", "Ivy")["token"]
s, r = call("POST", "/api/matches/ai", token=tg)
smid2 = r["match_id"]
call("POST", "/api/presence/ping", token=tg)
s, r = call("POST", "/api/matches/quick", token=tiv)
imid = r["match_id"]
s, hb = call("POST", "/api/presence/ping", token=tg)
check("no invite while stuck in an active match",
      s == 200 and hb.get("offer") is None, str(hb))
backdate(smid2, 6 * 60)
time.sleep(1.2)
trigger_sweep()                    # frees tg
s, hb = call("POST", "/api/presence/ping", token=tg)
call("GET", f"/api/matches/{imid}/state?since=0", token=tiv)  # owner poll drives fallback
s, hb = call("POST", "/api/presence/ping", token=tg)
check("freed player receives invite again",
      s == 200 and hb.get("offer") and hb["offer"]["match_id"] == imid, str(hb))
call("POST", f"/api/matches/{imid}/decline", token=tg)
call("POST", f"/api/matches/{imid}/leave", token=tiv)

# The sweep leaves an operator-visible audit trail.
s, r = call("GET", "/api/admin/audit", token=tadm)
check("stale sweeps are audited",
      s == 200 and any(a["action"] == "stale_match_sweep" for a in r["audit"]))

# --- random tower layouts: a run of matches must produce fresh, legal layouts
tl = auth_dev(f"layout-{run_tag}@example.com", "Layout")["token"]
layouts = []
for _ in range(10):
    s, r = call("POST", "/api/matches/ai", token=tl, body={"difficulty": "easy"})
    if s != 200:
        break
    _, lst = call("GET", f"/api/matches/{r['match_id']}/state?since=0", token=tl)
    if isinstance(lst.get("tower_x"), dict):
        layouts.append((lst["tower_x"]["p1"], lst["tower_x"]["p2"]))
check("ten matches all have legal random layouts",
      len(layouts) == 10
      and all(60 <= a <= 260 and 640 <= b <= 840 and b - (a + 104) >= 276
              for a, b in layouts),
      json.dumps(layouts))
check("layouts are not repeated across matches",
      len(set(layouts)) >= 2, json.dumps(layouts))

print("\n%d failures" % len(fails))
sys.exit(1 if fails else 0)
