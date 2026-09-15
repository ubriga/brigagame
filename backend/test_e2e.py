"""End-to-end API test: 2-client scripted match + store, coupons, admin."""
import os, sys, time, json, sqlite3, subprocess, urllib.request
from datetime import datetime, timezone, timedelta

from ranks import rank_payload
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

fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name, extra)
    if not cond: fails.append(name)

# --- auth: two players + admin
_, a = call("POST", "/api/auth/dev", body={"email": "alice@example.com", "name": "Alice"})
_, b = call("POST", "/api/auth/dev", body={"email": "bob@example.com", "name": "Bob"})
_, adm = call("POST", "/api/auth/dev", body={"email": "ubriga@gmail.com", "name": "Orel"})
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

# cooldown enforcement: fire twice rapidly
s, r = call("POST", f"/api/matches/{mid}/fire", token=ta,
            body={"angle": 45, "power": 60, "weapon": "standard"})
check("alice fires", s == 200 and any(e["type"] == "shot" for e in r["events"]), str(s))
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

# fire until someone wins (alternating, respecting cooldown)
winner = None
for i in range(60):
    for tok, w in ((ta, "standard"), (tb, "standard")):
        time.sleep(4.1)
        s, r = call("POST", f"/api/matches/{mid}/fire", token=tok,
                    body={"angle": 45 + ((i * 3) % 7) - 3, "power": 64 + ((i * 5) % 9) - 4, "weapon": w})
        if s == 200 and r.get("winner_side"):
            winner = r["winner_side"]; break
    if winner: break
check("match finishes with winner", winner in ("p1", "p2"), str(winner))
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
s, harder = call("POST", "/api/matches/ai", token=tb,
                 body={"difficulty": "ranked", "bot_rank_level": 18})
_, harder_st = call("GET", f"/api/matches/{harder['match_id']}/state?since=0", token=tb)
check("player can choose a harder rank-18 bot",
      s == 200 and harder_st["ai_rank_level"] == 18
      and harder_st["players"]["p2"]["idf_rank"]["level"] == 18)
s, floored = call("POST", "/api/matches/ai", token=tb,
                  body={"difficulty": "ranked", "bot_rank_level": 1})
_, floored_st = call("GET", f"/api/matches/{floored['match_id']}/state?since=0", token=tb)
check("server rejects downgrade by flooring at player rank",
      s == 200 and floored_st["ai_rank_level"] == floored_st["players"]["p1"]["idf_rank"]["level"])
time.sleep(9)
s, st2 = call("GET", f"/api/matches/{aid}/state?since=0", token=tb)
ai_shot = any(e["type"] == "shot" and e.get("side") == "p2" for e in st2["events"])
check("AI fires back on poll", ai_shot)

# --- bot-win rank weighting: easy = practice (0 pts), normal/hard = 0.5
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
check("practice win reward capped at 50", st["results"]["p1"]["coins"] <= 50)
check("practice results marked",
      st["results"]["p1"].get("practice") is True)
check("practice win awards 0 rank points",
      st["results"]["p1"].get("rank_points_awarded") == 0,
      json.dumps(st["results"]["p1"]))
_, mb2 = call("GET", "/api/me", token=tb)
check("practice win left rank untouched",
      mb2["user"]["idf_rank"]["level"] == 1
      and mb2["user"]["idf_rank"]["wins"] == 4.5,
      json.dumps(mb2["user"]["idf_rank"]))

_, gc = call("POST", "/api/auth/dev",
             body={"email": f"carol-{int(time.time())}@example.com", "name": "Carol"})
tc = gc["token"]
s, r = call("POST", "/api/matches/ai", token=tc, body={"difficulty": "normal"})
nid = r["match_id"]
s, st = call("GET", f"/api/matches/{nid}/state?since=0", token=tc)
check("normal bot match is not practice", st.get("practice") is False)
zero_tower(nid, "p2")
s, r = call("POST", f"/api/matches/{nid}/fire", token=tc,
            body={"angle": 45, "power": 60, "weapon": "standard"})
s, st = call("GET", f"/api/matches/{nid}/state?since=0", token=tc)
check("normal bot match won by player",
      st["status"] == "finished" and st["winner_side"] == "p1", str(st.get("status")))
check("ranked bot win reward capped at 50", st["results"]["p1"]["coins"] <= 50)
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
            body={"difficulty": "ranked", "bot_rank_level": 10})
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
    _, r = call("POST", "/api/auth/dev",
                body={"email": f"{name}-{run_tag}@example.com", "name": name.title()})
    return r["token"]
tc = devlogin("carol"); td = devlogin("dave"); te = devlogin("erin"); tf = devlogin("frank")

# carol is simply present in the app - she never clicks quick match.
s, hb = call("POST", "/api/presence/ping", token=tc)
check("presence ping ok", s == 200 and hb.get("ok") and hb.get("offer") is None, str(hb))
check("presence ping carries server_version", hb.get("server_version") == "7", str(hb.get("server_version")))

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

_, g = call("POST", "/api/auth/dev",
            body={"email": f"stale-{run_tag}@example.com", "name": "Stale"})
tg = g["token"]
_, me0 = call("GET", "/api/me", token=tg)

# An AI match abandoned for 3h (past the 2h active-match stale window).
s, r = call("POST", "/api/matches/ai", token=tg)
smid = r["match_id"]
check("ai match created for stale test", s == 200 and r["status"] == "active")
backdate(smid, 3 * 3600)
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

# A waiting quick match whose owner vanished 25h ago (past the 24h window).
s, r = call("POST", "/api/matches/quick", token=tg)
wmid = r["match_id"]
check("waiting match created for stale test", s == 200 and r["status"] == "waiting")
backdate(wmid, 25 * 3600)
time.sleep(1.2)
trigger_sweep()
s, st = call("GET", f"/api/matches/{wmid}/state?since=0", token=tg)
check("stale waiting match purged", s == 404, str(s))

# The original lockout: while a player sits in an abandoned active match, no
# presence invite can reach them. After the sweep frees them, it can.
# Let every earlier heartbeat fall outside the 25s presence window so the
# only eligible players in this section are the ones we ping here.
time.sleep(26)
_, iv = call("POST", "/api/auth/dev",
             body={"email": f"ivy-{run_tag}@example.com", "name": "Ivy"})
tiv = iv["token"]
s, r = call("POST", "/api/matches/ai", token=tg)
smid2 = r["match_id"]
call("POST", "/api/presence/ping", token=tg)
s, r = call("POST", "/api/matches/quick", token=tiv)
imid = r["match_id"]
s, hb = call("POST", "/api/presence/ping", token=tg)
check("no invite while stuck in an active match",
      s == 200 and hb.get("offer") is None, str(hb))
backdate(smid2, 3 * 3600)
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

print("\n%d failures" % len(fails))
sys.exit(1 if fails else 0)
