"""Brigagame 2.0 by OrelAI - IDF-style player rank ladder (wins-only).

Single source of truth for the 18-level rank system. Progression is derived
from users.rank_points (server-side counter, incremented only in
finalize_match) - the client NEVER sends a level, so ranks cannot be forged.

Design decisions (relayed by the main agent from Orel's 2026-09-15 picks):
- Progression by WINS ONLY. No XP, no damage points.
- Win weighting (Orel's call): human-vs-human win = 1 rank point;
  win vs normal/hard bot = 0.5; win vs EASY bot = 0 - easy-bot games are
  practice matches ("משחק תרגול") and do not advance rank.
- Level is computed from the points counter, not stored, so admin coin grants,
  imports or any other DB edits cannot fake a rank without real wins.
- Curve: fast early promotions (hook), then a widening gap; top rank (רא"ל)
  at 700 points (twice the original thresholds).

Insignia assets: frontend/assets/ranks/rank-<NN>-<key>.svg (original artwork,
drawn to match the real IDF insignia system; see asset generator notes).
טור״ר was dropped at Orel's request (discontinued rank) - 18 levels total.
"""

# (level, key, name_he, abbr_he, group, cumulative wins required)
# Keep rank labels ASCII-safe in source. Python decodes these escapes to the
# exact Hebrew strings at runtime; this prevents host editors/deploy copy paths
# from corrupting Hebrew punctuation such as geresh (U+05F3) and gershayim
# (U+05F4) before the API serializes it.
RANK_LEVELS = [
    (1 , "turai", "\u05d8\u05d5\u05e8\u05d0\u05d9", "\u05d8\u05d5\u05e8\u05f3", "hogrim", 0),
    (2 , "rabat", "\u05e8\u05d1\u0020\u05d8\u05d5\u05e8\u05d0\u05d9", "\u05e8\u05d1\u05f4\u05d8", "hogrim", 6),
    (3 , "samal", "\u05e1\u05de\u05dc", "\u05e1\u05de\u05dc", "hogrim", 12),
    (4 , "samar", "\u05e1\u05de\u05dc\u0020\u05e8\u05d0\u05e9\u05d5\u05df", "\u05e1\u05de\u05f4\u05e8", "hogrim", 20),
    (5 , "rasal", "\u05e8\u05d1\u0020\u05e1\u05de\u05dc", "\u05e8\u05e1\u05f4\u05dc", "nagadim", 30),
    (6 , "rasar", "\u05e8\u05d1\u0020\u05e1\u05de\u05dc\u0020\u05e8\u05d0\u05e9\u05d5\u05df", "\u05e8\u05e1\u05f4\u05e8", "nagadim", 42),
    (7 , "rasam", "\u05e8\u05d1\u0020\u05e1\u05de\u05dc\u0020\u05de\u05ea\u05e7\u05d3\u05dd", "\u05e8\u05e1\u05f4\u05dd", "nagadim", 56),
    (8 , "rasab", "\u05e8\u05d1\u0020\u05e1\u05de\u05dc\u0020\u05d1\u05db\u05d9\u05e8", "\u05e8\u05e1\u05f4\u05d1", "nagadim", 72),
    (9 , "ranag", "\u05e8\u05d1\u0020\u05e0\u05d2\u05d3", "\u05e8\u05e0\u05f4\u05d2", "nagadim", 90),
    (10, "sagam", "\u05e1\u05d2\u05df\u0020\u05de\u05e9\u05e0\u05d4", "\u05e1\u05d2\u05f4\u05de", "ktzinim", 110),
    (11, "segen", "\u05e1\u05d2\u05df", "\u05e1\u05d2\u05df", "ktzinim", 140),
    (12, "seren", "\u05e1\u05e8\u05df", "\u05e1\u05e8\u05df", "ktzinim", 180),
    (13, "rasan", "\u05e8\u05d1\u0020\u05e1\u05e8\u05df", "\u05e8\u05e1\u05f4\u05df", "ktzinim", 230),
    (14, "saal", "\u05e1\u05d2\u05df\u0020\u05d0\u05dc\u05d5\u05e3", "\u05e1\u05d0\u05f4\u05dc", "ktzinim", 290),
    (15, "alam", "\u05d0\u05dc\u05d5\u05e3\u0020\u05de\u05e9\u05e0\u05d4", "\u05d0\u05dc\u05f4\u05dd", "ktzinim", 360),
    (16, "taal", "\u05ea\u05ea\u0020\u05d0\u05dc\u05d5\u05e3", "\u05ea\u05d0\u05f4\u05dc", "ktzinim", 450),
    (17, "aluf", "\u05d0\u05dc\u05d5\u05e3", "\u05d0\u05dc\u05d5\u05e3", "ktzinim", 560),
    (18, "raal", "\u05e8\u05d1\u0020\u05d0\u05dc\u05d5\u05e3", "\u05e8\u05d0\u05f4\u05dc", "ktzinim", 700),
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


def rank_for_level(level: int) -> dict:
    """Public rank descriptor for a validated/clamped ladder level."""
    try:
        level = int(level)
    except (TypeError, ValueError):
        level = 1
    return _entry(max(1, min(MAX_LEVEL, level)))


def _entry(level: int) -> dict:
    lvl, key, name_he, abbr_he, group, req = RANK_LEVELS[level - 1]
    return {"level": lvl, "key": key, "name_he": name_he,
            "abbr_he": abbr_he, "group": group, "wins_required": req,
            "insignia": f"assets/ranks/rank-{lvl:02d}-{key}.svg"}


def rank_payload(points: float) -> dict:
    """Full rank state for API payloads (me, players, leaderboard).

    `points` is the weighted rank-points counter (human win = 1, harder bots
    = 0.5, easy bot = 0); thresholds are whole numbers so halves just mean
    "one more bot win"."""
    points = round(float(points), 1)
    level = level_for_wins(points)
    cur = _entry(level)
    out = dict(cur)
    out["wins"] = points
    if level < MAX_LEVEL:
        nxt = _entry(level + 1)
        span = nxt["wins_required"] - cur["wins_required"]
        done = points - cur["wins_required"]
        out["next"] = {"level": nxt["level"], "name_he": nxt["name_he"],
                       "abbr_he": nxt["abbr_he"],
                       "wins_required": nxt["wins_required"],
                       "wins_to_go": round(nxt["wins_required"] - points, 1)}
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
