/** Shared D1 adapter + gameplay-controls loader (merged with D1 overrides). */
import type { Db } from "./game/finalize.js";
import type { PlayerMods } from "./game/game_logic.js";
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

/** Player loadout/mods for match creation (port of app.py user_mods). */
export async function userMods(env: Env, userId: number): Promise<PlayerMods> {
  const items = await env.DB.prepare(
    "SELECT item_id, level, equipped FROM user_items WHERE user_id = ?").bind(userId).all();
  const armor = items.results.find((r: any) => r.item_id === "armor")?.level ?? 0;
  const hp = items.results.find((r: any) => r.item_id === "reinforced_hp")?.level ?? 0;
  const skin = items.results.find((r: any) => String(r.item_id).startsWith("skin_") && r.equipped)?.item_id ?? null;
  const coating = await env.DB.prepare(
    "SELECT material, hp FROM user_coatings WHERE user_id = ?").bind(userId).first();
  const expansion = await env.DB.prepare(
    "SELECT extra_cubes FROM user_expansions WHERE user_id = ?").bind(userId).first();
  const controls = await getControls(env);
  return {
    armor: Number(armor), hp: Number(hp), skin: skin as string | null,
    coating: coating ? { material: coating.material, hp: Number(coating.hp), max_hp: Number(coating.hp) } : null,
    extra_cubes: Number((expansion as any)?.extra_cubes ?? 0),
    expansion_cube_hp: Number((controls as any).tower_expansion.cube_hp),
    dynamic_obstacle: (controls as any).dynamic_obstacle,
  } as PlayerMods;
}
