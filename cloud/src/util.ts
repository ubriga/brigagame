/** Shared D1 adapter + gameplay-controls loader (merged with D1 overrides). */
import type { Db } from "./game/finalize.js";
import type { Env } from "./do/MatchRoom";

/** D1-backed implementation of the settlement/auth Db interface. */
export function d1(db: D1Database): Db {
  return {
    async run(sql, params) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: Number(r.meta?.changes ?? 0) };
    },
    async get(sql, params) {
      return (await db.prepare(sql).bind(...params).first()) ?? null;
    },
  };
}

/** Gameplay controls: DEFAULT_GAMEPLAY_CONTROLS merged with the D1 settings
 * row (per-group shallow merge), mirroring app.py get_gameplay_controls. */
export async function getControls(env: Env): Promise<any> {
  const { DEFAULT_GAMEPLAY_CONTROLS } = await import("./game/catalog.js");
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'gameplay_controls'").first();
  if (!row) return DEFAULT_GAMEPLAY_CONTROLS;
  try {
    const over = JSON.parse(String((row as any).value));
    const merged: any = { ...DEFAULT_GAMEPLAY_CONTROLS };
    for (const k of Object.keys(over)) merged[k] = { ...(merged[k] ?? {}), ...over[k] };
    return merged;
  } catch { return DEFAULT_GAMEPLAY_CONTROLS; }
}
