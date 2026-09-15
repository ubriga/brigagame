"""Brigagame 2.0 by OrelAI - IDF-style player rank ladder (wins-only).

Single source of truth for the 19-level rank system. Progression is derived
purely from users.wins (server-side counter, incremented only in
finalize_match) - the client NEVER sends a level, so ranks cannot be forged.

Design decisions (relayed by the main agent from Orel's 2026-09-15 pick):
- Progression by WINS ONLY. No XP, no damage points.
- Level is computed from the wins counter, not stored, so admin coin grants,
  imports or any other DB edits cannot fake a rank without real wins.
- Curve: fast early promotions (hook), then a widening gap; top rank (רא"ל)
  at 350 wins ~= 1.5-2 months of active play (~7 wins/day).

Insignia assets: frontend/assets/ranks/rank-<NN>-<key>.svg (original artwork,
drawn to match the real IDF insignia system; see asset generator notes).
טור״ר was dropped at Orel's request (discontinued rank) - 18 levels total.
"""

# (level, key, name_he, abbr_he, group, cumulative wins required)
RANK_LEVELS = [
    (1,  "turai", "טוראי",       "טור׳",  "hogrim",  0),
    (2,  "rabat", "רב טוראי",    "רב״ט",  "hogrim",  3),
    (3,  "samal", "סמל",         "סמל",   "hogrim",  6),
    (4,  "samar", "סמל ראשון",   "סמ״ר",  "hogrim",  10),
    (5,  "rasal", "רב סמל",      "רס״ל",  "nagadim", 15),
    (6,  "rasar", "רב סמל ראשון","רס״ר",  "nagadim", 21),
    (7,  "rasam", "רב סמל מתקדם","רס״ם",  "nagadim", 28),
    (8,  "rasab", "רב סמל בכיר", "רס״ב",  "nagadim", 36),
    (9,  "ranag", "רב נגד",      "רנ״ג",  "nagadim", 45),
    (10, "sagam", "סגן משנה",    "סג״מ",  "ktzinim", 55),
    (11, "segen", "סגן",         "סגן",   "ktzinim", 70),
    (12, "seren", "סרן",         "סרן",   "ktzinim", 90),
    (13, "rasan", "רב סרן",      "רס״ן",  "ktzinim", 115),
    (14, "saal",  "סגן אלוף",    "סא״ל",  "ktzinim", 145),
    (15, "alam",  "אלוף משנה",   "אל״ם",  "ktzinim", 180),
    (16, "taal",  "תת אלוף",     "תא״ל",  "ktzinim", 225),
    (17, "aluf",  "אלוף",        "אלוף",  "ktzinim", 280),
    (18, "raal",  "רב אלוף",     "רא״ל",  "ktzinim", 350),
]

MAX_LEVEL = RANK_LEVELS[-1][0]


def level_for_wins(wins: int) -> int:
    """Highest level whose cumulative-wins threshold is met."""
    lvl = 1
    for level, _key, _n, _a, _g, req in RANK_LEVELS:
        if wins >= req:
            lvl = level
        else:
            break
    return lvl


def _entry(level: int) -> dict:
    lvl, key, name_he, abbr_he, group, req = RANK_LEVELS[level - 1]
    return {"level": lvl, "key": key, "name_he": name_he,
            "abbr_he": abbr_he, "group": group, "wins_required": req,
            "insignia": f"assets/ranks/rank-{lvl:02d}-{key}.svg"}


def rank_payload(wins: int) -> dict:
    """Full rank state for API payloads (me, players, leaderboard)."""
    level = level_for_wins(wins)
    cur = _entry(level)
    out = dict(cur)
    out["wins"] = wins
    if level < MAX_LEVEL:
        nxt = _entry(level + 1)
        span = nxt["wins_required"] - cur["wins_required"]
        done = wins - cur["wins_required"]
        out["next"] = {"level": nxt["level"], "name_he": nxt["name_he"],
                       "abbr_he": nxt["abbr_he"],
                       "wins_required": nxt["wins_required"],
                       "wins_to_go": nxt["wins_required"] - wins}
        out["progress_pct"] = round(100 * done / span) if span else 100
    else:
        out["next"] = None
        out["progress_pct"] = 100
    return out


def rank_up_info(wins_before: int, wins_after: int):
    """Promotion descriptor when a win crosses a threshold, else None."""
    lo, hi = level_for_wins(wins_before), level_for_wins(wins_after)
    if hi <= lo:
        return None
    e = _entry(hi)
    return {"from_level": lo, "to_level": hi, "name_he": e["name_he"],
            "abbr_he": e["abbr_he"], "group": e["group"],
            "insignia": e["insignia"]}
