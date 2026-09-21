"""Brigagame 2.0 by OrelAI - economy rules and item catalog.

Single source of truth for coins, prices, rewards, rating and ranks.
The client NEVER sends coin amounts; every coin movement happens here,
server-side, and is written to the transactions ledger.

Design reasoning: see ECONOMY_RESEARCH.md (survey of ShellShock Live,
Tank Stars and Worms-style economies).
"""

# ---------------------------------------------------------------- currency
STARTING_COINS = 200          # welcome grant so a new player can try the store
# A win scales with how much of the opposing tower was actually destroyed.
# Difficulty/rank set the ceiling; 50 is always a cap, never a fixed award.
COINS_PER_WIN = 42             # full-destruction ceiling vs a baseline opponent
MAX_COINS_PER_WIN = 50
BOT_TIER_WIN_BONUS = {"medium": 0, "hard": 3, "ultra": 6}
MAX_WIN_RANK_BONUS = 2
COINS_PER_LOSS = 20           # consolation so playing never feels punished
COINS_PER_DAMAGE = 0.1        # 1 coin per 10 damage dealt...
MAX_HIT_COINS_PER_MATCH = 40  # ...capped to stop farming/stalling abuse

# Daily login: 50 on day one, +10 per consecutive day, capped at 150.
DAILY_BASE = 50
DAILY_STREAK_STEP = 10
DAILY_CAP = 150


def win_reward_coins(damage_dealt, tower_max_hp, opponent_rank_level=1, bot_tier=None):
    """Reward a win by destruction completeness, difficulty and opponent rank.

    A 75%-destroyed tower can end the match, but it earns only about 75% of the
    available reward. Destroying every HP earns the difficulty/rank ceiling.
    """
    try:
        level = max(1, min(18, int(opponent_rank_level or 1)))
    except (TypeError, ValueError):
        level = 1
    try:
        destroyed = max(0.0, min(1.0, float(damage_dealt) / float(tower_max_hp)))
    except (TypeError, ValueError, ZeroDivisionError):
        destroyed = 0.0
    rank_bonus = min(MAX_WIN_RANK_BONUS, (level - 1) // 6)
    ceiling = min(MAX_COINS_PER_WIN, COINS_PER_WIN
                  + BOT_TIER_WIN_BONUS.get(str(bot_tier or "medium"), 0)
                  + rank_bonus)
    return min(MAX_COINS_PER_WIN, max(0, int(round(ceiling * destroyed))))


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

# Large cosmetics collection. Every entry is visual-only; rarity drives price,
# while style data is sent by the server so clients cannot forge ownership.
_COSMETIC_SKINS = [
    ("ocean", "גל אוקיינוס", "rare", 350, "#22d3ee", "#164e63", "≈", "wave"),
    ("forest", "יער עתיק", "common", 180, "#4ade80", "#14532d", "♣", "brick"),
    ("desert", "חול מדברי", "common", 180, "#fbbf24", "#92400e", "☀", "sand"),
    ("arctic", "קרח ארקטי", "rare", 350, "#e0f2fe", "#0369a1", "❄", "ice"),
    ("volcano", "לבה געשית", "epic", 700, "#fb7185", "#7f1d1d", "♨", "lava"),
    ("toxic", "ניאון רעיל", "epic", 700, "#a3e635", "#365314", "☣", "neon"),
    ("cyber", "סייבר 2099", "epic", 800, "#e879f9", "#312e81", "⌁", "circuit"),
    ("stealth", "צל חמקני", "rare", 420, "#64748b", "#020617", "◈", "carbon"),
    ("pearl", "פנינה לבנה", "rare", 420, "#f8fafc", "#94a3b8", "◉", "pearl"),
    ("rose", "רוז גולד", "epic", 750, "#fda4af", "#9f1239", "✿", "metal"),
    ("galaxy", "גלקסיה", "legendary", 1400, "#818cf8", "#1e1b4b", "✺", "stars"),
    ("dragon", "דרקון אש", "legendary", 1600, "#f97316", "#450a0a", "龍", "scales"),
    ("samurai", "סמוראי", "epic", 850, "#ef4444", "#111827", "侍", "lacquer"),
    ("pharaoh", "פרעה", "legendary", 1500, "#facc15", "#0f766e", "𓂀", "stone"),
    ("viking", "ויקינג", "epic", 850, "#d1d5db", "#374151", "ᚱ", "steel"),
    ("pirate", "פיראט", "rare", 450, "#f59e0b", "#292524", "☠", "wood"),
    ("candy", "ממלכת ממתקים", "rare", 380, "#f9a8d4", "#7c3aed", "♥", "candy"),
    ("pixel", "פיקסל רטרו", "common", 220, "#2dd4bf", "#134e4a", "▣", "pixel"),
    ("camo", "הסוואה", "common", 220, "#84cc16", "#3f6212", "✥", "camo"),
    ("chrome", "כרום", "epic", 800, "#e2e8f0", "#475569", "◇", "chrome"),
    ("plasma", "פלזמה", "legendary", 1350, "#c084fc", "#4c1d95", "ϟ", "plasma"),
    ("solar", "שמש מלכותית", "legendary", 1450, "#fde047", "#c2410c", "☀", "solar"),
    ("lunar", "ירח כסוף", "epic", 780, "#cbd5e1", "#312e81", "☾", "lunar"),
    ("aurora", "זוהר צפוני", "legendary", 1550, "#5eead4", "#6d28d9", "✧", "aurora"),
    ("obsidian", "אובסידיאן", "legendary", 1700, "#a78bfa", "#09090b", "◆", "obsidian"),
    ("hologram", "הולוגרמה", "legendary", 1800, "#67e8f9", "#7e22ce", "⌬", "hologram"),
]

_COMING_SOON_SKINS = [
    ("nebula", "ערפילית", "legendary", 1900, "#f0abfc", "#312e81", "✦", "nebula"),
    ("kraken", "קראקן", "legendary", 1850, "#2dd4bf", "#0f172a", "♆", "scales"),
    ("phoenix", "פניקס", "legendary", 2000, "#fb923c", "#7f1d1d", "♛", "flame"),
    ("diamond", "יהלום", "legendary", 2100, "#cffafe", "#0284c7", "♦", "crystal"),
    ("quantum", "קוונטום", "legendary", 2200, "#a5b4fc", "#581c87", "∞", "quantum"),
    ("royal_void", "ריק מלכותי", "legendary", 1950, "#d8b4fe", "#020617", "♕", "void"),
    ("thunder", "אל הרעם", "legendary", 2050, "#fef08a", "#1e3a8a", "ϟ", "storm"),
    ("atlantis", "אטלנטיס", "legendary", 1900, "#5eead4", "#164e63", "♜", "water"),
    ("inferno", "אינפרנו", "epic", 980, "#f87171", "#450a0a", "♨", "inferno"),
    ("matrix", "מטריקס", "epic", 950, "#4ade80", "#052e16", "⌗", "matrix"),
    ("synthwave", "סינת'ווייב", "epic", 920, "#f472b6", "#312e81", "◭", "grid"),
    ("magma", "מאגמה", "epic", 900, "#f97316", "#431407", "●", "magma"),
    ("deep_sea", "מעמקי הים", "epic", 880, "#38bdf8", "#082f49", "≋", "water"),
    ("jungle", "ג'ונגל פראי", "epic", 870, "#22c55e", "#052e16", "♣", "leaf"),
    ("temple", "מקדש עתיק", "epic", 930, "#facc15", "#713f12", "⌂", "rune"),
    ("mecha", "מֶכָה", "epic", 990, "#94a3b8", "#1e293b", "⚙", "metal"),
    ("coral", "שונית אלמוגים", "rare", 520, "#fb7185", "#0e7490", "❈", "coral"),
    ("opal", "אופל", "rare", 560, "#f0abfc", "#0f766e", "◈", "opal"),
    ("origami", "אוריגמי", "rare", 480, "#fda4af", "#4338ca", "◇", "paper"),
    ("comic", "קומיקס", "rare", 460, "#fde047", "#dc2626", "!", "comic"),
    ("graffiti", "גרפיטי", "rare", 500, "#a3e635", "#7e22ce", "✎", "paint"),
    ("marble", "שיש", "rare", 540, "#e2e8f0", "#475569", "◌", "marble"),
    ("amber", "ענבר", "rare", 510, "#fbbf24", "#78350f", "◆", "crystal"),
    ("sakura", "סאקורה", "rare", 530, "#f9a8d4", "#881337", "✿", "petal"),
    ("denim", "דנים", "common", 280, "#60a5fa", "#1e3a8a", "▦", "fabric"),
    ("clay", "חימר", "common", 260, "#fdba74", "#9a3412", "●", "clay"),
    ("mint", "מנטה", "common", 270, "#6ee7b7", "#065f46", "+", "soft"),
    ("paper", "נייר", "common", 240, "#fef3c7", "#78716c", "✎", "paper"),
    ("navy", "כחול צי", "common", 290, "#60a5fa", "#172554", "⚓", "stripe"),
    ("copper", "נחושת", "common", 300, "#fb923c", "#7c2d12", "◉", "metal"),
]
for _key, _name, _tier, _price, _light, _dark, _emblem, _texture in _COSMETIC_SKINS:
    CATALOG["skin_" + _key] = {
        "kind": "skin", "name": _key.title(), "name_he": _name,
        "tier": _tier, "price": _price, "colors": [_light, _dark],
        "style": {"fill": [_light, _dark], "frame": _light,
                  "glow": _light + "88", "texture": _texture,
                  "emblem": _emblem, "debris": [_light, _dark, "#f8fafc"]},
        "desc_he": "מראה קוסמטי איכותי בדרגת " + {"common":"רגיל","rare":"נדיר","epic":"אפי","legendary":"אגדי"}[_tier] + ".",
        "desc_en": "Premium " + _tier + " cosmetic.",
    }

for _key, _name, _tier, _price, _light, _dark, _emblem, _texture in _COMING_SOON_SKINS:
    CATALOG["skin_" + _key] = {
        "kind": "skin", "name": _key.replace("_", " ").title(), "name_he": _name,
        "tier": _tier, "price": _price, "colors": [_light, _dark],
        "available": False, "coming_soon": True,
        "style": {"fill": [_light, _dark], "frame": _light,
                  "glow": _light + "88", "texture": _texture,
                  "emblem": _emblem, "debris": [_light, _dark, "#f8fafc"]},
        "desc_he": "מראה קוסמטי חדש בדרגת " + {"common":"רגיל","rare":"נדיר","epic":"אפי","legendary":"אגדי"}[_tier] + ".",
        "desc_en": "Upcoming premium " + _tier + " cosmetic.",
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
