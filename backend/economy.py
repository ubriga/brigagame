"""Brigagame 2.0 by OrelAI - economy rules and item catalog.

Single source of truth for coins, prices, rewards, rating and ranks.
The client NEVER sends coin amounts; every coin movement happens here,
server-side, and is written to the transactions ledger.

Design reasoning: see ECONOMY_RESEARCH.md (survey of ShellShock Live,
Tank Stars and Worms-style economies).
"""

# ---------------------------------------------------------------- currency
STARTING_COINS = 200          # welcome grant so a new player can try the store
COINS_PER_WIN = 50
MAX_COINS_PER_WIN = 50
COINS_PER_LOSS = 20           # consolation so playing never feels punished
COINS_PER_DAMAGE = 0.1        # 1 coin per 10 damage dealt...
MAX_HIT_COINS_PER_MATCH = 40  # ...capped to stop farming/stalling abuse

# Daily login: 50 on day one, +10 per consecutive day, capped at 150.
DAILY_BASE = 50
DAILY_STREAK_STEP = 10
DAILY_CAP = 150

# ---------------------------------------------------------------- ranking
ELO_K = 32
START_RATING = 1000

RANKS = [
    (0,    "Bronze III"), (1030, "Bronze II"), (1060, "Bronze I"),
    (1100, "Silver III"), (1160, "Silver II"), (1220, "Silver I"),
    (1300, "Gold III"),   (1380, "Gold II"),   (1460, "Gold I"),
    (1550, "Platinum III"), (1640, "Platinum II"), (1730, "Platinum I"),
    (1850, "Diamond"), (2000, "Master"), (2200, "Grandmaster"), (2400, "Legend"),
]


def rank_for(rating: int) -> str:
    name = RANKS[0][1]
    for threshold, rname in RANKS:
        if rating >= threshold:
            name = rname
        else:
            break
    return name


def elo_delta(winner_rating: int, loser_rating: int) -> int:
    expected = 1.0 / (1.0 + 10 ** ((loser_rating - winner_rating) / 400.0))
    return max(1, round(ELO_K * (1.0 - expected)))


# ---------------------------------------------------------------- catalog
# kinds: consumable (pack of shots), upgrade (permanent levels), skin (cosmetic)
CATALOG = {
    # --- special weapons: consumable packs (3 shots per pack) ---
    "double_bomb": {
        "kind": "consumable", "name": "Double Bomb", "name_he": "פצצה כפולה",
        "pack_shots": 3, "price": 90,
        "desc_he": "משגרת שני פגזים ברצף בכל ירייה. חבילה של 3 שימושים.",
    },
    "homing_missile": {
        "kind": "consumable", "name": "Homing Missile", "name_he": "טיל מסתובב",
        "pack_shots": 3, "price": 150,
        "desc_he": "מתקן את מסלולו לעבר מגדל האויב באוויר. חבילה של 3 שימושים.",
    },
    "cluster_shell": {
        "kind": "consumable", "name": "Cluster Shell", "name_he": "פגז מרושת",
        "pack_shots": 3, "price": 180,
        "desc_he": "מתפצל לארבעה פצצונים בשיא המסלול. חבילה של 3 שימושים.",
    },
    # --- tower upgrades: permanent, 5 levels each ---
    "armor": {
        "kind": "upgrade", "name": "Armor Plating", "name_he": "שריון",
        "max_level": 5, "prices": [200, 400, 800, 1400, 2200],
        "desc_he": "מפחית נזק נכנס ב-4% לרמה.",
    },
    "reinforced_hp": {
        "kind": "upgrade", "name": "Reinforced Tower", "name_he": "חיזוק מגדל",
        "max_level": 5, "prices": [200, 400, 800, 1400, 2200],
        "desc_he": "מגדיל את חיי המגדל ב-10% לרמה.",
    },
    # --- skins: pure cosmetics ---
    "skin_emerald": {
        "kind": "skin", "name": "Emerald", "name_he": "מרקט ירוק", "price": 250,
        "colors": ["#10b981", "#065f46"],
        "style": {"fill": ["#34d399", "#047857"], "frame": "#a7f3d0",
                  "glow": "rgba(16,185,129,.42)", "texture": "brick",
                  "emblem": "◆", "debris": ["#6ee7b7", "#10b981", "#064e3b"]},
        "desc_he": "מראה לבנים ירוק עם זוהר וסמל יהלום.",
    },
    "skin_crimson": {
        "kind": "skin", "name": "Crimson", "name_he": "ארגמן", "price": 250,
        "colors": ["#ef4444", "#7f1d1d"],
        "style": {"fill": ["#f87171", "#991b1b"], "frame": "#fecaca",
                  "glow": "rgba(239,68,68,.45)", "texture": "brick",
                  "emblem": "✦", "debris": ["#fca5a5", "#ef4444", "#7f1d1d"]},
        "desc_he": "מראה לבנים ארגמן עם זוהר וסמל כוכב.",
    },
    "skin_royal": {
        "kind": "skin", "name": "Royal", "name_he": "מלכותי", "price": 250,
        "colors": ["#8b5cf6", "#4c1d95"],
        "style": {"fill": ["#a78bfa", "#5b21b6"], "frame": "#ddd6fe",
                  "glow": "rgba(139,92,246,.5)", "texture": "neon",
                  "emblem": "♛", "debris": ["#c4b5fd", "#8b5cf6", "#4c1d95"]},
        "desc_he": "מראה ניאון מלכותי עם זוהר וסמל כתר.",
    },
    "skin_gold": {
        "kind": "skin", "name": "Gold", "name_he": "זהב", "price": 600,
        "colors": ["#f59e0b", "#92400e"],
        "style": {"fill": ["#fde68a", "#b45309"], "frame": "#fff7cc",
                  "glow": "rgba(245,158,11,.58)", "texture": "steel",
                  "emblem": "★", "debris": ["#fef3c7", "#f59e0b", "#92400e"]},
        "desc_he": "מראה פלדה מוזהבת עם זוהר וסמל כוכב.",
    },
}

DEFAULT_SKIN = {
    "colors": ["#3b82f6", "#1e3a8a"],
    "style": {"fill": ["#60a5fa", "#1d4ed8"], "frame": "#bfdbfe",
              "glow": "rgba(59,130,246,.38)", "texture": "steel",
              "emblem": "●", "debris": ["#93c5fd", "#3b82f6", "#1e3a8a"]},
}

# Weapon combat stats (server-side only).
WEAPONS = {
    "standard":       {"damage": 34, "radius": 64, "cooldown": 4.0},
    "double_bomb":    {"damage": 34, "radius": 50, "cooldown": 5.0},
    "homing_missile": {"damage": 55, "radius": 60, "cooldown": 5.0},
    "cluster_shell":  {"damage": 18, "radius": 40, "cooldown": 6.0},
}


def armor_reduction(level: int) -> float:
    """Incoming-damage multiplier for a tower with `level` armor."""
    return max(0.7, 1.0 - 0.04 * max(0, min(5, level)))


def hp_multiplier(level: int) -> float:
    return 1.0 + 0.10 * max(0, min(5, level))
