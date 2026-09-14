"""End-to-end API test: 2-client scripted match + store, coupons, admin."""
import os, sys, time, json, subprocess, urllib.request

BASE = "http://127.0.0.1:5000"

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

# --- AI match
s, r = call("POST", "/api/matches/ai", token=tb)
aid = r["match_id"]
check("ai match active", s == 200 and r["status"] == "active")
check("ai difficulty selected", call("GET", f"/api/matches/{aid}/state?since=0", token=tb)[1]["ai_difficulty"] == "normal")
s, st = call("GET", f"/api/matches/{aid}/state?since=0", token=tb)
check("ai opponent named", st["players"]["p2"]["name"] == "OrelAI Bot")
time.sleep(9)
s, st2 = call("GET", f"/api/matches/{aid}/state?since=0", token=tb)
ai_shot = any(e["type"] == "shot" and e.get("side") == "p2" for e in st2["events"])
check("AI fires back on poll", ai_shot)

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

print("\n%d failures" % len(fails))
sys.exit(1 if fails else 0)
