/**
 * Brigagame 2.0 - IDF rank ladder. Faithful TypeScript port of backend/ranks.py.
 * 19 tower levels: 0 = unranked base tower, 1-18 = טוראי through רא״ל.
 * Hebrew strings written directly (UTF-8 source; the PA mojibake came from a
 * bad upload path, not from the source - keep this file UTF-8 clean).
 */

export interface RankEntry {
  level: number; key: string; name_he: string; abbr_he: string;
  group: string; wins_required: number; insignia: string;
}

const L = (level: number, key: string, name_he: string, abbr_he: string, group: string, req: number): RankEntry =>
  ({ level, key, name_he, abbr_he, group, wins_required: req, insignia: `assets/ranks/rank-${String(level).padStart(2, "0")}-${key}.svg` });

export const RANK_LEVELS: RankEntry[] = [
  L(1,  "turai", "טוראי", "טור׳", "hogrim", 0),
  L(2,  "rabat", "רב טוראי", "רב״ט", "hogrim", 6),
  L(3,  "samal", "סמל", "סמל", "hogrim", 12),
  L(4,  "samar", "סמל ראשון", "סמ״ר", "hogrim", 20),
  L(5,  "rasal", "רב סמל", "רס״ל", "nagadim", 30),
  L(6,  "rasar", "רב סמל ראשון", "רס״ר", "nagadim", 42),
  L(7,  "rasam", "רב סמל מתקדם", "רס״ם", "nagadim", 56),
  L(8,  "rasab", "רב סמל בכיר", "רס״ב", "nagadim", 72),
  L(9,  "ranag", "רב נגד", "רנ״ג", "nagadim", 90),
  L(10, "sagam", "סגן משנה", "סג״מ", "ktzinim", 110),
  L(11, "segen", "סגן", "סגן", "ktzinim", 140),
  L(12, "seren", "סרן", "סרן", "ktzinim", 180),
  L(13, "rasan", "רב סרן", "רס״ן", "ktzinim", 230),
  L(14, "saal",  "סגן אלוף", "סא״ל", "ktzinim", 290),
  L(15, "alam",  "אלוף משנה", "אל״ם", "ktzinim", 360),
  L(16, "taal",  "תת אלוף", "תא״ל", "ktzinim", 450),
  L(17, "aluf",  "אלוף", "אלוף", "ktzinim", 560),
  L(18, "raal",  "רב אלוף", "רא״ל", "ktzinim", 700),
];

export const MAX_LEVEL = RANK_LEVELS[RANK_LEVELS.length - 1].level;

export function levelForWins(wins: number): number {
  let lvl = 1;
  for (const e of RANK_LEVELS) {
    if (wins >= e.wins_required) lvl = e.level; else break;
  }
  return lvl;
}

export function rankForLevel(level: number): RankEntry {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.trunc(level) || 1));
  return RANK_LEVELS[l - 1];
}

export function rankPayload(points: number): Record<string, unknown> {
  points = Math.round(points * 10) / 10;
  const level = levelForWins(points);
  const cur = rankForLevel(level);
  const out: Record<string, unknown> = { ...cur, xp: points, wins: points, tower_level: level, upgrade_level: level + 1, upgrade_levels_total: 19 };
  if (level < MAX_LEVEL) {
    const nxt = rankForLevel(level + 1);
    const span = nxt.wins_required - cur.wins_required;
    const done = points - cur.wins_required;
    out.next = { level: nxt.level, name_he: nxt.name_he, abbr_he: nxt.abbr_he, wins_required: nxt.wins_required, wins_to_go: Math.round((nxt.wins_required - points) * 10) / 10 };
    out.progress_pct = span ? Math.round(100 * done / span) : 100;
  } else {
    out.next = null;
    out.progress_pct = 100;
  }
  return out;
}

export function rankUpInfo(winsBefore: number, winsAfter: number): Record<string, unknown> | null {
  const lo = levelForWins(winsBefore), hi = levelForWins(winsAfter);
  if (hi <= lo) return null;
  const e = rankForLevel(hi);
  return { from_level: lo, to_level: hi, name_he: e.name_he, abbr_he: e.abbr_he, group: e.group, insignia: e.insignia };
}