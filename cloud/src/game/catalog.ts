/**
 * Brigagame 2.0 - store catalog + admin gameplay controls.
 * Generated from backend/economy.py and backend/app.py (DEFAULT_GAMEPLAY_CONTROLS).
 * Source of truth stays server-side; regenerate with scripts/dump_economy.py.
 */

export interface CatalogEntry { kind: string; name: string; name_he: string; price?: number; pack_shots?: number; max_level?: number; prices?: number[]; tier?: string; colors?: string[]; style?: Record<string, unknown>; desc_he?: string; desc_en?: string; available?: boolean; coming_soon?: boolean; }

export const CATALOG: Record<string, CatalogEntry> = {
  "double_bomb": {
    "kind": "consumable",
    "name": "Double Bomb",
    "name_he": "פצצה כפולה",
    "pack_shots": 3,
    "price": 90,
    "desc_he": "משגרת שני פגזים ברצף בכל ירייה. חבילה של 3 שימושים."
  },
  "homing_missile": {
    "kind": "consumable",
    "name": "Homing Missile",
    "name_he": "טיל מסתובב",
    "pack_shots": 3,
    "price": 150,
    "desc_he": "מתקן את מסלולו לעבר מגדל האויב באוויר. חבילה של 3 שימושים."
  },
  "cluster_shell": {
    "kind": "consumable",
    "name": "Cluster Shell",
    "name_he": "פגז מרושת",
    "pack_shots": 3,
    "price": 180,
    "desc_he": "מתפצל לארבעה פצצונים בשיא המסלול. חבילה של 3 שימושים."
  },
  "armor": {
    "kind": "upgrade",
    "name": "Armor Plating",
    "name_he": "שריון",
    "max_level": 5,
    "prices": [
      200,
      400,
      800,
      1400,
      2200
    ],
    "desc_he": "מפחית נזק נכנס ב-4% לרמה."
  },
  "reinforced_hp": {
    "kind": "upgrade",
    "name": "Reinforced Tower",
    "name_he": "חיזוק מגדל",
    "max_level": 5,
    "prices": [
      200,
      400,
      800,
      1400,
      2200
    ],
    "desc_he": "מגדיל את חיי המגדל ב-10% לרמה."
  },
  "skin_emerald": {
    "kind": "skin",
    "name": "Emerald",
    "name_he": "מרקט ירוק",
    "price": 250,
    "colors": [
      "#10b981",
      "#065f46"
    ],
    "style": {
      "fill": [
        "#34d399",
        "#047857"
      ],
      "frame": "#a7f3d0",
      "glow": "rgba(16,185,129,.42)",
      "texture": "brick",
      "emblem": "◆",
      "debris": [
        "#6ee7b7",
        "#10b981",
        "#064e3b"
      ]
    },
    "desc_he": "מראה לבנים ירוק עם זוהר וסמל יהלום."
  },
  "skin_crimson": {
    "kind": "skin",
    "name": "Crimson",
    "name_he": "ארגמן",
    "price": 250,
    "colors": [
      "#ef4444",
      "#7f1d1d"
    ],
    "style": {
      "fill": [
        "#f87171",
        "#991b1b"
      ],
      "frame": "#fecaca",
      "glow": "rgba(239,68,68,.45)",
      "texture": "brick",
      "emblem": "✦",
      "debris": [
        "#fca5a5",
        "#ef4444",
        "#7f1d1d"
      ]
    },
    "desc_he": "מראה לבנים ארגמן עם זוהר וסמל כוכב."
  },
  "skin_royal": {
    "kind": "skin",
    "name": "Royal",
    "name_he": "מלכותי",
    "price": 250,
    "colors": [
      "#8b5cf6",
      "#4c1d95"
    ],
    "style": {
      "fill": [
        "#a78bfa",
        "#5b21b6"
      ],
      "frame": "#ddd6fe",
      "glow": "rgba(139,92,246,.5)",
      "texture": "neon",
      "emblem": "♛",
      "debris": [
        "#c4b5fd",
        "#8b5cf6",
        "#4c1d95"
      ]
    },
    "desc_he": "מראה ניאון מלכותי עם זוהר וסמל כתר."
  },
  "skin_gold": {
    "kind": "skin",
    "name": "Gold",
    "name_he": "זהב",
    "price": 600,
    "colors": [
      "#f59e0b",
      "#92400e"
    ],
    "style": {
      "fill": [
        "#fde68a",
        "#b45309"
      ],
      "frame": "#fff7cc",
      "glow": "rgba(245,158,11,.58)",
      "texture": "steel",
      "emblem": "★",
      "debris": [
        "#fef3c7",
        "#f59e0b",
        "#92400e"
      ]
    },
    "desc_he": "מראה פלדה מוזהבת עם זוהר וסמל כוכב."
  },
  "skin_missile_tower": {
    "kind": "skin",
    "name": "Missile Tower",
    "name_he": "מגדל טיל",
    "tier": "legendary",
    "price": 1800,
    "colors": [
      "#e2e8f0",
      "#334155"
    ],
    "style": {
      "fill": [
        "#f8fafc",
        "#475569"
      ],
      "frame": "#fb923c",
      "glow": "rgba(251,146,60,.42)",
      "texture": "steel",
      "emblem": "",
      "geometry": "missile",
      "debris": [
        "#e2e8f0",
        "#fb923c",
        "#334155"
      ]
    },
    "desc_he": "גוף טיל, חרטום, סנפירים, חלון ולהבות מנוע.",
    "desc_en": "Missile body, nose cone, fins, window and engine flames."
  },
  "skin_spaceship": {
    "kind": "skin",
    "name": "Starship",
    "name_he": "חללית",
    "tier": "legendary",
    "price": 1750,
    "colors": [
      "#67e8f9",
      "#312e81"
    ],
    "style": {
      "fill": [
        "#a5f3fc",
        "#4338ca"
      ],
      "frame": "#c4b5fd",
      "glow": "rgba(103,232,249,.5)",
      "texture": "neon",
      "emblem": "",
      "geometry": "spaceship",
      "debris": [
        "#67e8f9",
        "#818cf8",
        "#312e81"
      ]
    },
    "desc_he": "כיפת חללית, כנפיים, חלונות וטבעת אנרגיה.",
    "desc_en": "Starship dome, wings, windows and an energy ring."
  },
  "skin_battle_tank": {
    "kind": "skin",
    "name": "Battle Tank",
    "name_he": "טנק קרב",
    "tier": "legendary",
    "price": 1700,
    "colors": [
      "#84cc16",
      "#1f2937"
    ],
    "style": {
      "fill": [
        "#a3e635",
        "#374151"
      ],
      "frame": "#d9f99d",
      "glow": "rgba(132,204,22,.35)",
      "texture": "steel",
      "emblem": "",
      "geometry": "tank",
      "debris": [
        "#a3e635",
        "#4d7c0f",
        "#1f2937"
      ]
    },
    "desc_he": "זחלים, צריח וקנה ארוך שמעניקים צללית של טנק.",
    "desc_en": "Tracks, turret and a long barrel create a tank silhouette."
  },
  "skin_dragon_keep": {
    "kind": "skin",
    "name": "Dragon Keep",
    "name_he": "מצודת דרקון",
    "tier": "legendary",
    "price": 1900,
    "colors": [
      "#fb923c",
      "#7f1d1d"
    ],
    "style": {
      "fill": [
        "#fdba74",
        "#991b1b"
      ],
      "frame": "#fde68a",
      "glow": "rgba(249,115,22,.48)",
      "texture": "scales",
      "emblem": "",
      "geometry": "dragon",
      "debris": [
        "#fb923c",
        "#ef4444",
        "#450a0a"
      ]
    },
    "desc_he": "כנפי דרקון, קרניים, עיניים זוהרות וזנב.",
    "desc_en": "Dragon wings, horns, glowing eyes and tail."
  },
  "skin_sun_pyramid": {
    "kind": "skin",
    "name": "Sun Pyramid",
    "name_he": "פירמידת שמש",
    "tier": "epic",
    "price": 1200,
    "colors": [
      "#fde047",
      "#92400e"
    ],
    "style": {
      "fill": [
        "#fef08a",
        "#b45309"
      ],
      "frame": "#fff7cc",
      "glow": "rgba(250,204,21,.42)",
      "texture": "stone",
      "emblem": "",
      "geometry": "pyramid",
      "debris": [
        "#fde68a",
        "#d97706",
        "#78350f"
      ]
    },
    "desc_he": "מעטפת פירמידה מדורגת וסמל שמש מואר.",
    "desc_en": "Stepped pyramid shell with a luminous sun mark."
  },
  "skin_ice_fortress": {
    "kind": "skin",
    "name": "Ice Fortress",
    "name_he": "מבצר קרח",
    "tier": "legendary",
    "price": 1650,
    "colors": [
      "#e0f2fe",
      "#0369a1"
    ],
    "style": {
      "fill": [
        "#f0f9ff",
        "#0ea5e9"
      ],
      "frame": "#cffafe",
      "glow": "rgba(125,211,252,.55)",
      "texture": "ice",
      "emblem": "",
      "geometry": "ice_fortress",
      "debris": [
        "#e0f2fe",
        "#7dd3fc",
        "#075985"
      ]
    },
    "desc_he": "צריחי קרח חדים, מעטפת שקופה וסדקים קפואים.",
    "desc_en": "Sharp ice spires, translucent shell and frozen cracks."
  },
  "skin_mecha_core": {
    "kind": "skin",
    "name": "Mecha Core",
    "name_he": "ליבת מכונה",
    "tier": "legendary",
    "price": 1850,
    "colors": [
      "#94a3b8",
      "#0f172a"
    ],
    "style": {
      "fill": [
        "#cbd5e1",
        "#1e293b"
      ],
      "frame": "#67e8f9",
      "glow": "rgba(34,211,238,.5)",
      "texture": "circuit",
      "emblem": "",
      "geometry": "mecha",
      "debris": [
        "#cbd5e1",
        "#22d3ee",
        "#0f172a"
      ]
    },
    "desc_he": "זרועות משוריינות, כתפיים וליבת אנרגיה פועמת.",
    "desc_en": "Armored limbs, shoulders and a pulsing energy core."
  },
  "skin_royal_castle": {
    "kind": "skin",
    "name": "Royal Castle",
    "name_he": "טירת מלוכה",
    "tier": "epic",
    "price": 1350,
    "colors": [
      "#c4b5fd",
      "#4c1d95"
    ],
    "style": {
      "fill": [
        "#ddd6fe",
        "#5b21b6"
      ],
      "frame": "#fde68a",
      "glow": "rgba(167,139,250,.4)",
      "texture": "stone",
      "emblem": "",
      "geometry": "castle",
      "debris": [
        "#c4b5fd",
        "#8b5cf6",
        "#4c1d95"
      ]
    },
    "desc_he": "מגדלי צד, שיניים ודגלי מלוכה מתנופפים.",
    "desc_en": "Side turrets, battlements and waving royal flags."
  },
  "skin_ocean": {
    "kind": "skin",
    "name": "Ocean",
    "name_he": "גל אוקיינוס",
    "tier": "rare",
    "price": 350,
    "colors": [
      "#22d3ee",
      "#164e63"
    ],
    "style": {
      "fill": [
        "#22d3ee",
        "#164e63"
      ],
      "frame": "#22d3ee",
      "glow": "#22d3ee88",
      "texture": "wave",
      "emblem": "≈",
      "debris": [
        "#22d3ee",
        "#164e63",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת נדיר.",
    "desc_en": "Premium rare cosmetic."
  },
  "skin_forest": {
    "kind": "skin",
    "name": "Forest",
    "name_he": "יער עתיק",
    "tier": "common",
    "price": 180,
    "colors": [
      "#4ade80",
      "#14532d"
    ],
    "style": {
      "fill": [
        "#4ade80",
        "#14532d"
      ],
      "frame": "#4ade80",
      "glow": "#4ade8088",
      "texture": "brick",
      "emblem": "♣",
      "debris": [
        "#4ade80",
        "#14532d",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת רגיל.",
    "desc_en": "Premium common cosmetic."
  },
  "skin_desert": {
    "kind": "skin",
    "name": "Desert",
    "name_he": "חול מדברי",
    "tier": "common",
    "price": 180,
    "colors": [
      "#fbbf24",
      "#92400e"
    ],
    "style": {
      "fill": [
        "#fbbf24",
        "#92400e"
      ],
      "frame": "#fbbf24",
      "glow": "#fbbf2488",
      "texture": "sand",
      "emblem": "☀",
      "debris": [
        "#fbbf24",
        "#92400e",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת רגיל.",
    "desc_en": "Premium common cosmetic."
  },
  "skin_arctic": {
    "kind": "skin",
    "name": "Arctic",
    "name_he": "קרח ארקטי",
    "tier": "rare",
    "price": 350,
    "colors": [
      "#e0f2fe",
      "#0369a1"
    ],
    "style": {
      "fill": [
        "#e0f2fe",
        "#0369a1"
      ],
      "frame": "#e0f2fe",
      "glow": "#e0f2fe88",
      "texture": "ice",
      "emblem": "❄",
      "debris": [
        "#e0f2fe",
        "#0369a1",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת נדיר.",
    "desc_en": "Premium rare cosmetic."
  },
  "skin_volcano": {
    "kind": "skin",
    "name": "Volcano",
    "name_he": "לבה געשית",
    "tier": "epic",
    "price": 700,
    "colors": [
      "#fb7185",
      "#7f1d1d"
    ],
    "style": {
      "fill": [
        "#fb7185",
        "#7f1d1d"
      ],
      "frame": "#fb7185",
      "glow": "#fb718588",
      "texture": "lava",
      "emblem": "♨",
      "debris": [
        "#fb7185",
        "#7f1d1d",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_toxic": {
    "kind": "skin",
    "name": "Toxic",
    "name_he": "ניאון רעיל",
    "tier": "epic",
    "price": 700,
    "colors": [
      "#a3e635",
      "#365314"
    ],
    "style": {
      "fill": [
        "#a3e635",
        "#365314"
      ],
      "frame": "#a3e635",
      "glow": "#a3e63588",
      "texture": "neon",
      "emblem": "☣",
      "debris": [
        "#a3e635",
        "#365314",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_cyber": {
    "kind": "skin",
    "name": "Cyber",
    "name_he": "סייבר 2099",
    "tier": "epic",
    "price": 800,
    "colors": [
      "#e879f9",
      "#312e81"
    ],
    "style": {
      "fill": [
        "#e879f9",
        "#312e81"
      ],
      "frame": "#e879f9",
      "glow": "#e879f988",
      "texture": "circuit",
      "emblem": "⌁",
      "debris": [
        "#e879f9",
        "#312e81",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_stealth": {
    "kind": "skin",
    "name": "Stealth",
    "name_he": "צל חמקני",
    "tier": "rare",
    "price": 420,
    "colors": [
      "#64748b",
      "#020617"
    ],
    "style": {
      "fill": [
        "#64748b",
        "#020617"
      ],
      "frame": "#64748b",
      "glow": "#64748b88",
      "texture": "carbon",
      "emblem": "◈",
      "debris": [
        "#64748b",
        "#020617",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת נדיר.",
    "desc_en": "Premium rare cosmetic."
  },
  "skin_pearl": {
    "kind": "skin",
    "name": "Pearl",
    "name_he": "פנינה לבנה",
    "tier": "rare",
    "price": 420,
    "colors": [
      "#f8fafc",
      "#94a3b8"
    ],
    "style": {
      "fill": [
        "#f8fafc",
        "#94a3b8"
      ],
      "frame": "#f8fafc",
      "glow": "#f8fafc88",
      "texture": "pearl",
      "emblem": "◉",
      "debris": [
        "#f8fafc",
        "#94a3b8",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת נדיר.",
    "desc_en": "Premium rare cosmetic."
  },
  "skin_rose": {
    "kind": "skin",
    "name": "Rose",
    "name_he": "רוז גולד",
    "tier": "epic",
    "price": 750,
    "colors": [
      "#fda4af",
      "#9f1239"
    ],
    "style": {
      "fill": [
        "#fda4af",
        "#9f1239"
      ],
      "frame": "#fda4af",
      "glow": "#fda4af88",
      "texture": "metal",
      "emblem": "✿",
      "debris": [
        "#fda4af",
        "#9f1239",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_galaxy": {
    "kind": "skin",
    "name": "Galaxy",
    "name_he": "גלקסיה",
    "tier": "legendary",
    "price": 1400,
    "colors": [
      "#818cf8",
      "#1e1b4b"
    ],
    "style": {
      "fill": [
        "#818cf8",
        "#1e1b4b"
      ],
      "frame": "#818cf8",
      "glow": "#818cf888",
      "texture": "stars",
      "emblem": "✺",
      "debris": [
        "#818cf8",
        "#1e1b4b",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_dragon": {
    "kind": "skin",
    "name": "Dragon",
    "name_he": "דרקון אש",
    "tier": "legendary",
    "price": 1600,
    "colors": [
      "#f97316",
      "#450a0a"
    ],
    "style": {
      "fill": [
        "#f97316",
        "#450a0a"
      ],
      "frame": "#f97316",
      "glow": "#f9731688",
      "texture": "scales",
      "emblem": "龍",
      "debris": [
        "#f97316",
        "#450a0a",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_samurai": {
    "kind": "skin",
    "name": "Samurai",
    "name_he": "סמוראי",
    "tier": "epic",
    "price": 850,
    "colors": [
      "#ef4444",
      "#111827"
    ],
    "style": {
      "fill": [
        "#ef4444",
        "#111827"
      ],
      "frame": "#ef4444",
      "glow": "#ef444488",
      "texture": "lacquer",
      "emblem": "侍",
      "debris": [
        "#ef4444",
        "#111827",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_pharaoh": {
    "kind": "skin",
    "name": "Pharaoh",
    "name_he": "פרעה",
    "tier": "legendary",
    "price": 1500,
    "colors": [
      "#facc15",
      "#0f766e"
    ],
    "style": {
      "fill": [
        "#facc15",
        "#0f766e"
      ],
      "frame": "#facc15",
      "glow": "#facc1588",
      "texture": "stone",
      "emblem": "𓂀",
      "debris": [
        "#facc15",
        "#0f766e",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_viking": {
    "kind": "skin",
    "name": "Viking",
    "name_he": "ויקינג",
    "tier": "epic",
    "price": 850,
    "colors": [
      "#d1d5db",
      "#374151"
    ],
    "style": {
      "fill": [
        "#d1d5db",
        "#374151"
      ],
      "frame": "#d1d5db",
      "glow": "#d1d5db88",
      "texture": "steel",
      "emblem": "ᚱ",
      "debris": [
        "#d1d5db",
        "#374151",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_pirate": {
    "kind": "skin",
    "name": "Pirate",
    "name_he": "פיראט",
    "tier": "rare",
    "price": 450,
    "colors": [
      "#f59e0b",
      "#292524"
    ],
    "style": {
      "fill": [
        "#f59e0b",
        "#292524"
      ],
      "frame": "#f59e0b",
      "glow": "#f59e0b88",
      "texture": "wood",
      "emblem": "☠",
      "debris": [
        "#f59e0b",
        "#292524",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת נדיר.",
    "desc_en": "Premium rare cosmetic."
  },
  "skin_candy": {
    "kind": "skin",
    "name": "Candy",
    "name_he": "ממלכת ממתקים",
    "tier": "rare",
    "price": 380,
    "colors": [
      "#f9a8d4",
      "#7c3aed"
    ],
    "style": {
      "fill": [
        "#f9a8d4",
        "#7c3aed"
      ],
      "frame": "#f9a8d4",
      "glow": "#f9a8d488",
      "texture": "candy",
      "emblem": "♥",
      "debris": [
        "#f9a8d4",
        "#7c3aed",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת נדיר.",
    "desc_en": "Premium rare cosmetic."
  },
  "skin_pixel": {
    "kind": "skin",
    "name": "Pixel",
    "name_he": "פיקסל רטרו",
    "tier": "common",
    "price": 220,
    "colors": [
      "#2dd4bf",
      "#134e4a"
    ],
    "style": {
      "fill": [
        "#2dd4bf",
        "#134e4a"
      ],
      "frame": "#2dd4bf",
      "glow": "#2dd4bf88",
      "texture": "pixel",
      "emblem": "▣",
      "debris": [
        "#2dd4bf",
        "#134e4a",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת רגיל.",
    "desc_en": "Premium common cosmetic."
  },
  "skin_camo": {
    "kind": "skin",
    "name": "Camo",
    "name_he": "הסוואה",
    "tier": "common",
    "price": 220,
    "colors": [
      "#84cc16",
      "#3f6212"
    ],
    "style": {
      "fill": [
        "#84cc16",
        "#3f6212"
      ],
      "frame": "#84cc16",
      "glow": "#84cc1688",
      "texture": "camo",
      "emblem": "✥",
      "debris": [
        "#84cc16",
        "#3f6212",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת רגיל.",
    "desc_en": "Premium common cosmetic."
  },
  "skin_chrome": {
    "kind": "skin",
    "name": "Chrome",
    "name_he": "כרום",
    "tier": "epic",
    "price": 800,
    "colors": [
      "#e2e8f0",
      "#475569"
    ],
    "style": {
      "fill": [
        "#e2e8f0",
        "#475569"
      ],
      "frame": "#e2e8f0",
      "glow": "#e2e8f088",
      "texture": "chrome",
      "emblem": "◇",
      "debris": [
        "#e2e8f0",
        "#475569",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_plasma": {
    "kind": "skin",
    "name": "Plasma",
    "name_he": "פלזמה",
    "tier": "legendary",
    "price": 1350,
    "colors": [
      "#c084fc",
      "#4c1d95"
    ],
    "style": {
      "fill": [
        "#c084fc",
        "#4c1d95"
      ],
      "frame": "#c084fc",
      "glow": "#c084fc88",
      "texture": "plasma",
      "emblem": "ϟ",
      "debris": [
        "#c084fc",
        "#4c1d95",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_solar": {
    "kind": "skin",
    "name": "Solar",
    "name_he": "שמש מלכותית",
    "tier": "legendary",
    "price": 1450,
    "colors": [
      "#fde047",
      "#c2410c"
    ],
    "style": {
      "fill": [
        "#fde047",
        "#c2410c"
      ],
      "frame": "#fde047",
      "glow": "#fde04788",
      "texture": "solar",
      "emblem": "☀",
      "debris": [
        "#fde047",
        "#c2410c",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_lunar": {
    "kind": "skin",
    "name": "Lunar",
    "name_he": "ירח כסוף",
    "tier": "epic",
    "price": 780,
    "colors": [
      "#cbd5e1",
      "#312e81"
    ],
    "style": {
      "fill": [
        "#cbd5e1",
        "#312e81"
      ],
      "frame": "#cbd5e1",
      "glow": "#cbd5e188",
      "texture": "lunar",
      "emblem": "☾",
      "debris": [
        "#cbd5e1",
        "#312e81",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אפי.",
    "desc_en": "Premium epic cosmetic."
  },
  "skin_aurora": {
    "kind": "skin",
    "name": "Aurora",
    "name_he": "זוהר צפוני",
    "tier": "legendary",
    "price": 1550,
    "colors": [
      "#5eead4",
      "#6d28d9"
    ],
    "style": {
      "fill": [
        "#5eead4",
        "#6d28d9"
      ],
      "frame": "#5eead4",
      "glow": "#5eead488",
      "texture": "aurora",
      "emblem": "✧",
      "debris": [
        "#5eead4",
        "#6d28d9",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_obsidian": {
    "kind": "skin",
    "name": "Obsidian",
    "name_he": "אובסידיאן",
    "tier": "legendary",
    "price": 1700,
    "colors": [
      "#a78bfa",
      "#09090b"
    ],
    "style": {
      "fill": [
        "#a78bfa",
        "#09090b"
      ],
      "frame": "#a78bfa",
      "glow": "#a78bfa88",
      "texture": "obsidian",
      "emblem": "◆",
      "debris": [
        "#a78bfa",
        "#09090b",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_hologram": {
    "kind": "skin",
    "name": "Hologram",
    "name_he": "הולוגרמה",
    "tier": "legendary",
    "price": 1800,
    "colors": [
      "#67e8f9",
      "#7e22ce"
    ],
    "style": {
      "fill": [
        "#67e8f9",
        "#7e22ce"
      ],
      "frame": "#67e8f9",
      "glow": "#67e8f988",
      "texture": "hologram",
      "emblem": "⌬",
      "debris": [
        "#67e8f9",
        "#7e22ce",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי איכותי בדרגת אגדי.",
    "desc_en": "Premium legendary cosmetic."
  },
  "skin_nebula": {
    "kind": "skin",
    "name": "Nebula",
    "name_he": "ערפילית",
    "tier": "legendary",
    "price": 1900,
    "colors": [
      "#f0abfc",
      "#312e81"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#f0abfc",
        "#312e81"
      ],
      "frame": "#f0abfc",
      "glow": "#f0abfc88",
      "texture": "nebula",
      "emblem": "✦",
      "debris": [
        "#f0abfc",
        "#312e81",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_kraken": {
    "kind": "skin",
    "name": "Kraken",
    "name_he": "קראקן",
    "tier": "legendary",
    "price": 1850,
    "colors": [
      "#2dd4bf",
      "#0f172a"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#2dd4bf",
        "#0f172a"
      ],
      "frame": "#2dd4bf",
      "glow": "#2dd4bf88",
      "texture": "scales",
      "emblem": "♆",
      "debris": [
        "#2dd4bf",
        "#0f172a",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_phoenix": {
    "kind": "skin",
    "name": "Phoenix",
    "name_he": "פניקס",
    "tier": "legendary",
    "price": 2000,
    "colors": [
      "#fb923c",
      "#7f1d1d"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fb923c",
        "#7f1d1d"
      ],
      "frame": "#fb923c",
      "glow": "#fb923c88",
      "texture": "flame",
      "emblem": "♛",
      "debris": [
        "#fb923c",
        "#7f1d1d",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_diamond": {
    "kind": "skin",
    "name": "Diamond",
    "name_he": "יהלום",
    "tier": "legendary",
    "price": 2100,
    "colors": [
      "#cffafe",
      "#0284c7"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#cffafe",
        "#0284c7"
      ],
      "frame": "#cffafe",
      "glow": "#cffafe88",
      "texture": "crystal",
      "emblem": "♦",
      "debris": [
        "#cffafe",
        "#0284c7",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_quantum": {
    "kind": "skin",
    "name": "Quantum",
    "name_he": "קוונטום",
    "tier": "legendary",
    "price": 2200,
    "colors": [
      "#a5b4fc",
      "#581c87"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#a5b4fc",
        "#581c87"
      ],
      "frame": "#a5b4fc",
      "glow": "#a5b4fc88",
      "texture": "quantum",
      "emblem": "∞",
      "debris": [
        "#a5b4fc",
        "#581c87",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_royal_void": {
    "kind": "skin",
    "name": "Royal Void",
    "name_he": "ריק מלכותי",
    "tier": "legendary",
    "price": 1950,
    "colors": [
      "#d8b4fe",
      "#020617"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#d8b4fe",
        "#020617"
      ],
      "frame": "#d8b4fe",
      "glow": "#d8b4fe88",
      "texture": "void",
      "emblem": "♕",
      "debris": [
        "#d8b4fe",
        "#020617",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_thunder": {
    "kind": "skin",
    "name": "Thunder",
    "name_he": "אל הרעם",
    "tier": "legendary",
    "price": 2050,
    "colors": [
      "#fef08a",
      "#1e3a8a"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fef08a",
        "#1e3a8a"
      ],
      "frame": "#fef08a",
      "glow": "#fef08a88",
      "texture": "storm",
      "emblem": "ϟ",
      "debris": [
        "#fef08a",
        "#1e3a8a",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_atlantis": {
    "kind": "skin",
    "name": "Atlantis",
    "name_he": "אטלנטיס",
    "tier": "legendary",
    "price": 1900,
    "colors": [
      "#5eead4",
      "#164e63"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#5eead4",
        "#164e63"
      ],
      "frame": "#5eead4",
      "glow": "#5eead488",
      "texture": "water",
      "emblem": "♜",
      "debris": [
        "#5eead4",
        "#164e63",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אגדי.",
    "desc_en": "Upcoming premium legendary cosmetic."
  },
  "skin_inferno": {
    "kind": "skin",
    "name": "Inferno",
    "name_he": "אינפרנו",
    "tier": "epic",
    "price": 980,
    "colors": [
      "#f87171",
      "#450a0a"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#f87171",
        "#450a0a"
      ],
      "frame": "#f87171",
      "glow": "#f8717188",
      "texture": "inferno",
      "emblem": "♨",
      "debris": [
        "#f87171",
        "#450a0a",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_matrix": {
    "kind": "skin",
    "name": "Matrix",
    "name_he": "מטריקס",
    "tier": "epic",
    "price": 950,
    "colors": [
      "#4ade80",
      "#052e16"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#4ade80",
        "#052e16"
      ],
      "frame": "#4ade80",
      "glow": "#4ade8088",
      "texture": "matrix",
      "emblem": "⌗",
      "debris": [
        "#4ade80",
        "#052e16",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_synthwave": {
    "kind": "skin",
    "name": "Synthwave",
    "name_he": "סינת'ווייב",
    "tier": "epic",
    "price": 920,
    "colors": [
      "#f472b6",
      "#312e81"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#f472b6",
        "#312e81"
      ],
      "frame": "#f472b6",
      "glow": "#f472b688",
      "texture": "grid",
      "emblem": "◭",
      "debris": [
        "#f472b6",
        "#312e81",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_magma": {
    "kind": "skin",
    "name": "Magma",
    "name_he": "מאגמה",
    "tier": "epic",
    "price": 900,
    "colors": [
      "#f97316",
      "#431407"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#f97316",
        "#431407"
      ],
      "frame": "#f97316",
      "glow": "#f9731688",
      "texture": "magma",
      "emblem": "●",
      "debris": [
        "#f97316",
        "#431407",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_deep_sea": {
    "kind": "skin",
    "name": "Deep Sea",
    "name_he": "מעמקי הים",
    "tier": "epic",
    "price": 880,
    "colors": [
      "#38bdf8",
      "#082f49"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#38bdf8",
        "#082f49"
      ],
      "frame": "#38bdf8",
      "glow": "#38bdf888",
      "texture": "water",
      "emblem": "≋",
      "debris": [
        "#38bdf8",
        "#082f49",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_jungle": {
    "kind": "skin",
    "name": "Jungle",
    "name_he": "ג'ונגל פראי",
    "tier": "epic",
    "price": 870,
    "colors": [
      "#22c55e",
      "#052e16"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#22c55e",
        "#052e16"
      ],
      "frame": "#22c55e",
      "glow": "#22c55e88",
      "texture": "leaf",
      "emblem": "♣",
      "debris": [
        "#22c55e",
        "#052e16",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_temple": {
    "kind": "skin",
    "name": "Temple",
    "name_he": "מקדש עתיק",
    "tier": "epic",
    "price": 930,
    "colors": [
      "#facc15",
      "#713f12"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#facc15",
        "#713f12"
      ],
      "frame": "#facc15",
      "glow": "#facc1588",
      "texture": "rune",
      "emblem": "⌂",
      "debris": [
        "#facc15",
        "#713f12",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_mecha": {
    "kind": "skin",
    "name": "Mecha",
    "name_he": "מֶכָה",
    "tier": "epic",
    "price": 990,
    "colors": [
      "#94a3b8",
      "#1e293b"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#94a3b8",
        "#1e293b"
      ],
      "frame": "#94a3b8",
      "glow": "#94a3b888",
      "texture": "metal",
      "emblem": "⚙",
      "debris": [
        "#94a3b8",
        "#1e293b",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת אפי.",
    "desc_en": "Upcoming premium epic cosmetic."
  },
  "skin_coral": {
    "kind": "skin",
    "name": "Coral",
    "name_he": "שונית אלמוגים",
    "tier": "rare",
    "price": 520,
    "colors": [
      "#fb7185",
      "#0e7490"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fb7185",
        "#0e7490"
      ],
      "frame": "#fb7185",
      "glow": "#fb718588",
      "texture": "coral",
      "emblem": "❈",
      "debris": [
        "#fb7185",
        "#0e7490",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_opal": {
    "kind": "skin",
    "name": "Opal",
    "name_he": "אופל",
    "tier": "rare",
    "price": 560,
    "colors": [
      "#f0abfc",
      "#0f766e"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#f0abfc",
        "#0f766e"
      ],
      "frame": "#f0abfc",
      "glow": "#f0abfc88",
      "texture": "opal",
      "emblem": "◈",
      "debris": [
        "#f0abfc",
        "#0f766e",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_origami": {
    "kind": "skin",
    "name": "Origami",
    "name_he": "אוריגמי",
    "tier": "rare",
    "price": 480,
    "colors": [
      "#fda4af",
      "#4338ca"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fda4af",
        "#4338ca"
      ],
      "frame": "#fda4af",
      "glow": "#fda4af88",
      "texture": "paper",
      "emblem": "◇",
      "debris": [
        "#fda4af",
        "#4338ca",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_comic": {
    "kind": "skin",
    "name": "Comic",
    "name_he": "קומיקס",
    "tier": "rare",
    "price": 460,
    "colors": [
      "#fde047",
      "#dc2626"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fde047",
        "#dc2626"
      ],
      "frame": "#fde047",
      "glow": "#fde04788",
      "texture": "comic",
      "emblem": "!",
      "debris": [
        "#fde047",
        "#dc2626",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_graffiti": {
    "kind": "skin",
    "name": "Graffiti",
    "name_he": "גרפיטי",
    "tier": "rare",
    "price": 500,
    "colors": [
      "#a3e635",
      "#7e22ce"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#a3e635",
        "#7e22ce"
      ],
      "frame": "#a3e635",
      "glow": "#a3e63588",
      "texture": "paint",
      "emblem": "✎",
      "debris": [
        "#a3e635",
        "#7e22ce",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_marble": {
    "kind": "skin",
    "name": "Marble",
    "name_he": "שיש",
    "tier": "rare",
    "price": 540,
    "colors": [
      "#e2e8f0",
      "#475569"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#e2e8f0",
        "#475569"
      ],
      "frame": "#e2e8f0",
      "glow": "#e2e8f088",
      "texture": "marble",
      "emblem": "◌",
      "debris": [
        "#e2e8f0",
        "#475569",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_amber": {
    "kind": "skin",
    "name": "Amber",
    "name_he": "ענבר",
    "tier": "rare",
    "price": 510,
    "colors": [
      "#fbbf24",
      "#78350f"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fbbf24",
        "#78350f"
      ],
      "frame": "#fbbf24",
      "glow": "#fbbf2488",
      "texture": "crystal",
      "emblem": "◆",
      "debris": [
        "#fbbf24",
        "#78350f",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_sakura": {
    "kind": "skin",
    "name": "Sakura",
    "name_he": "סאקורה",
    "tier": "rare",
    "price": 530,
    "colors": [
      "#f9a8d4",
      "#881337"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#f9a8d4",
        "#881337"
      ],
      "frame": "#f9a8d4",
      "glow": "#f9a8d488",
      "texture": "petal",
      "emblem": "✿",
      "debris": [
        "#f9a8d4",
        "#881337",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת נדיר.",
    "desc_en": "Upcoming premium rare cosmetic."
  },
  "skin_denim": {
    "kind": "skin",
    "name": "Denim",
    "name_he": "דנים",
    "tier": "common",
    "price": 280,
    "colors": [
      "#60a5fa",
      "#1e3a8a"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#60a5fa",
        "#1e3a8a"
      ],
      "frame": "#60a5fa",
      "glow": "#60a5fa88",
      "texture": "fabric",
      "emblem": "▦",
      "debris": [
        "#60a5fa",
        "#1e3a8a",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת רגיל.",
    "desc_en": "Upcoming premium common cosmetic."
  },
  "skin_clay": {
    "kind": "skin",
    "name": "Clay",
    "name_he": "חימר",
    "tier": "common",
    "price": 260,
    "colors": [
      "#fdba74",
      "#9a3412"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fdba74",
        "#9a3412"
      ],
      "frame": "#fdba74",
      "glow": "#fdba7488",
      "texture": "clay",
      "emblem": "●",
      "debris": [
        "#fdba74",
        "#9a3412",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת רגיל.",
    "desc_en": "Upcoming premium common cosmetic."
  },
  "skin_mint": {
    "kind": "skin",
    "name": "Mint",
    "name_he": "מנטה",
    "tier": "common",
    "price": 270,
    "colors": [
      "#6ee7b7",
      "#065f46"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#6ee7b7",
        "#065f46"
      ],
      "frame": "#6ee7b7",
      "glow": "#6ee7b788",
      "texture": "soft",
      "emblem": "+",
      "debris": [
        "#6ee7b7",
        "#065f46",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת רגיל.",
    "desc_en": "Upcoming premium common cosmetic."
  },
  "skin_paper": {
    "kind": "skin",
    "name": "Paper",
    "name_he": "נייר",
    "tier": "common",
    "price": 240,
    "colors": [
      "#fef3c7",
      "#78716c"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fef3c7",
        "#78716c"
      ],
      "frame": "#fef3c7",
      "glow": "#fef3c788",
      "texture": "paper",
      "emblem": "✎",
      "debris": [
        "#fef3c7",
        "#78716c",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת רגיל.",
    "desc_en": "Upcoming premium common cosmetic."
  },
  "skin_navy": {
    "kind": "skin",
    "name": "Navy",
    "name_he": "כחול צי",
    "tier": "common",
    "price": 290,
    "colors": [
      "#60a5fa",
      "#172554"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#60a5fa",
        "#172554"
      ],
      "frame": "#60a5fa",
      "glow": "#60a5fa88",
      "texture": "stripe",
      "emblem": "⚓",
      "debris": [
        "#60a5fa",
        "#172554",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת רגיל.",
    "desc_en": "Upcoming premium common cosmetic."
  },
  "skin_copper": {
    "kind": "skin",
    "name": "Copper",
    "name_he": "נחושת",
    "tier": "common",
    "price": 300,
    "colors": [
      "#fb923c",
      "#7c2d12"
    ],
    "available": false,
    "coming_soon": true,
    "style": {
      "fill": [
        "#fb923c",
        "#7c2d12"
      ],
      "frame": "#fb923c",
      "glow": "#fb923c88",
      "texture": "metal",
      "emblem": "◉",
      "debris": [
        "#fb923c",
        "#7c2d12",
        "#f8fafc"
      ]
    },
    "desc_he": "מראה קוסמטי חדש בדרגת רגיל.",
    "desc_en": "Upcoming premium common cosmetic."
  }
};

export const DEFAULT_SKIN = {
  "colors": [
    "#3b82f6",
    "#1e3a8a"
  ],
  "style": {
    "fill": [
      "#60a5fa",
      "#1d4ed8"
    ],
    "frame": "#bfdbfe",
    "glow": "rgba(59,130,246,.38)",
    "texture": "steel",
    "emblem": "●",
    "debris": [
      "#93c5fd",
      "#3b82f6",
      "#1e3a8a"
    ]
  }
};

export const COATING_ORDER = [
  "wood",
  "tin",
  "iron"
] as const;
export const COATING_NAMES: Record<string, string> = {
  "wood": "עץ",
  "tin": "פח",
  "iron": "ברזל"
};

export const DEFAULT_GAMEPLAY_CONTROLS = {
  "auth_flow": {
    "popup_enabled": true,
    "redirect_enabled": true,
    "email_code_enabled": true
  },
  "bot_fallback": {
    "enabled": true,
    "wait_seconds": 30
  },
  "xp": {
    "human_win": 2.0,
    "bot_win": 1.0,
    "per_damage": 0.01
  },
  "premium_skins": {
    "enabled": false,
    "asset_budget_kb": 80
  },
  "coatings": {
    "enabled": true,
    "max_level": 3,
    "build_minutes": 5,
    "wood_price": 80,
    "wood_minutes": 5,
    "wood_hp": 24,
    "tin_price": 240,
    "tin_minutes": 15,
    "tin_hp": 65,
    "iron_price": 600,
    "iron_minutes": 30,
    "iron_hp": 130
  },
  "tower_expansion": {
    "enabled": true,
    "max_extra_cubes": 12,
    "build_minutes": 10,
    "cube_price": 180,
    "cube_hp": 18
  },
  "dynamic_obstacle": {
    "enabled": true,
    "speed": 20,
    "warning_seconds": 1.5
  },
  "bot_system": {
    "enabled": true,
    "special_weapons": true,
    "double_bomb": true,
    "homing_missile": true,
    "cluster_shell": true,
    "movement": true,
    "reactive_shield": true,
    "tactical_mega": true,
    "adaptation": true,
    "infinite_ammo": false,
    "deep_aim": true,
    "coating_aware": true
  },
  "bot_tower_parity": {
    "enabled": true,
    "easy_pct": 0.6,
    "medium_pct": 0.75,
    "hard_pct": 0.9,
    "ultra_pct": 1.0,
    "expert_pct": 1.15,
    "match_coating": true
  },
  "bot_difficulty": {
    "easy_angle_noise": 10.0,
    "easy_power_spread": 0.12,
    "easy_wind_skill": 0.35,
    "easy_reaction": 1.8,
    "easy_rank_offset": 0,
    "easy_shield_chance": 0.1,
    "easy_mega_chance": 0.1,
    "easy_double_ammo": 1,
    "easy_homing_ammo": 1,
    "easy_cluster_ammo": 1,
    "easy_weapon_skill": 0.3,
    "easy_shield_hp": 0.28,
    "easy_shield_damage": 90,
    "easy_move_chance": 0.25,
    "easy_memory": 1,
    "easy_correction": 0.25,
    "easy_aggression": 0.3,
    "medium_angle_noise": 5.0,
    "medium_power_spread": 0.06,
    "medium_wind_skill": 0.7,
    "medium_reaction": 1.0,
    "medium_rank_offset": 2,
    "medium_shield_chance": 0.25,
    "medium_mega_chance": 0.25,
    "medium_double_ammo": 2,
    "medium_homing_ammo": 2,
    "medium_cluster_ammo": 2,
    "medium_weapon_skill": 0.55,
    "medium_shield_hp": 0.38,
    "medium_shield_damage": 70,
    "medium_move_chance": 0.45,
    "medium_memory": 2,
    "medium_correction": 0.5,
    "medium_aggression": 0.5,
    "hard_angle_noise": 2.5,
    "hard_power_spread": 0.025,
    "hard_wind_skill": 0.9,
    "hard_reaction": 0.65,
    "hard_rank_offset": 5,
    "hard_shield_chance": 0.45,
    "hard_mega_chance": 0.45,
    "hard_double_ammo": 3,
    "hard_homing_ammo": 3,
    "hard_cluster_ammo": 3,
    "hard_weapon_skill": 0.75,
    "hard_shield_hp": 0.5,
    "hard_shield_damage": 50,
    "hard_move_chance": 0.65,
    "hard_memory": 3,
    "hard_correction": 0.72,
    "hard_aggression": 0.72,
    "ultra_angle_noise": 1.2,
    "ultra_power_spread": 0.012,
    "ultra_wind_skill": 1.0,
    "ultra_reaction": 0.35,
    "ultra_rank_offset": 9,
    "ultra_shield_chance": 0.7,
    "ultra_mega_chance": 0.7,
    "ultra_double_ammo": 4,
    "ultra_homing_ammo": 4,
    "ultra_cluster_ammo": 4,
    "ultra_weapon_skill": 0.9,
    "ultra_shield_hp": 0.62,
    "ultra_shield_damage": 35,
    "ultra_move_chance": 0.82,
    "ultra_memory": 5,
    "ultra_correction": 0.88,
    "ultra_aggression": 0.88,
    "expert_angle_noise": 0.35,
    "expert_power_spread": 0.004,
    "expert_wind_skill": 1.0,
    "expert_reaction": 0.15,
    "expert_rank_offset": 12,
    "expert_shield_chance": 0.9,
    "expert_mega_chance": 0.9,
    "expert_double_ammo": 6,
    "expert_homing_ammo": 6,
    "expert_cluster_ammo": 6,
    "expert_weapon_skill": 1.0,
    "expert_shield_hp": 0.75,
    "expert_shield_damage": 20,
    "expert_move_chance": 1.0,
    "expert_memory": 8,
    "expert_correction": 1.0,
    "expert_aggression": 1.0
  }
};
