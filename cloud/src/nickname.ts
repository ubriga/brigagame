/* Created by OrelAI - Brigagame 2.0 (https://github.com/ubriga/brigagame) */
/**
 * Public nicknames. Players are shown to each other only by nickname, never by
 * the Google account name. Pure validation lives here (no DB) so it is unit-testable.
 */
export const NICK_MIN = 2;
export const NICK_MAX = 16;
export const DEFAULT_CHANGE_PRICE = 100;

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g;
const NIQQUD = /[\u0591-\u05C7]/g;

// Lower-case, strip invisible/bidi/niqqud, fold look-alike characters, drop separators.
export function normalizeNick(raw: string): string {
  let s = String(raw ?? "").normalize("NFKC").replace(INVISIBLE, "").replace(NIQQUD, "").toLowerCase();
  s = s.replace(/[0]/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[4@]/g, "a")
       .replace(/[5$]/g, "s").replace(/7/g, "t").replace(/ё/g, "е");
  return s.replace(/[\s_.\-]+/g, "");
}

export function cleanNick(raw: string): string {
  return String(raw ?? "").normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

// Words that must not appear (after normalization). Admin can add more via settings.nickname_cfg.blocked_words.
export const BASE_BLOCKED = [
  "fuck", "shit", "bitch", "cunt", "dick", "pussy", "nigg", "fagg", "whore", "slut", "rape", "nazi", "hitler", "cock",
  "זונה", "שרמוטה", "כוסאמק", "כוסית", "כוס", "זין", "תזדיין", "מניאק", "בןזונה", "בנזונה", "הומו", "מזדיין", "חרא", "קקי",
  "נאצי", "היטלר", "אונס", "מחבל", "ערס", "פרחה", "אמאשלך", "אמשלך", "שרמוט", "מפגר", "דביל", "אידיוט",
];
// Identities that would impersonate staff/owner.
export const RESERVED = [
  "admin", "administrator", "moderator", "support", "staff", "owner", "official", "system", "orelai", "orelbriga", "brigagame",
  "אדמין", "מנהל", "מנהלת", "תמיכה", "בעלים", "צוות", "רשמי", "מערכת", "אוראלבריגה", "בריגגיים", "brigagame2",
];

export type NickCheck = { ok: true; nickname: string; norm: string } | { ok: false; error: string; error_he: string };

export function validateNick(raw: string, extraBlocked: string[] = []): NickCheck {
  const nickname = cleanNick(raw);
  const len = [...nickname].length;
  if (len < NICK_MIN || len > NICK_MAX)
    return { ok: false, error: "nick_length", error_he: `הכינוי צריך להכיל ${NICK_MIN}-${NICK_MAX} תווים.` };
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(nickname))
    return { ok: false, error: "nick_chars", error_he: "אפשר רק אותיות, ספרות, רווח, נקודה, מקף וקו תחתון." };
  if (/^[\d _.\-]+$/.test(nickname))
    return { ok: false, error: "nick_digits", error_he: "הכינוי חייב להכיל גם אותיות." };
  const norm = normalizeNick(nickname);
  if (norm.length < NICK_MIN)
    return { ok: false, error: "nick_length", error_he: `הכינוי צריך להכיל ${NICK_MIN}-${NICK_MAX} תווים.` };
  if (/https?|www|\.(com|net|org|il|co)\b|t\.me|wa\.me/i.test(nickname))
    return { ok: false, error: "nick_link", error_he: "אי אפשר להשתמש בכתובות אתר בכינוי." };
  for (const r of RESERVED)
    if (norm === normalizeNick(r) || norm.includes(normalizeNick(r)) && normalizeNick(r).length >= 5)
      return { ok: false, error: "nick_reserved", error_he: "הכינוי שמור. בחר כינוי אחר." };
  // Short words only match a whole token (avoids false hits inside normal words, e.g. "Dickens");
  // longer words match anywhere in the folded string (catches "f.u.c.k", "SH1T").
  const tokens = nickname.split(/[\s_.\-]+/).map(normalizeNick).filter(Boolean);
  for (const w of [...BASE_BLOCKED, ...extraBlocked]) {
    const nw = normalizeNick(w);
    if (nw.length < 2) continue;
    if (nw.length <= 4 ? (norm === nw || tokens.includes(nw)) : norm.includes(nw))
      return { ok: false, error: "nick_blocked", error_he: "הכינוי לא מתאים. בחר כינוי אחר." };
  }
  return { ok: true, nickname, norm };
}

/** What other players see. Guests keep their generated guest name; others only a chosen nickname. */
export function shownName(u: { id: number; is_guest?: any; name?: any; nick?: any }): string {
  if (u.is_guest) return String(u.name ?? "אורח");
  const n = String(u.nick ?? "").trim();
  return n || `שחקן ${u.id}`;
}
