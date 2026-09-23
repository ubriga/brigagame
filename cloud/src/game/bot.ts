/**
 * Brigagame 2.0 - bot decision engine. Faithful TypeScript port of the
 * app.py functions _tower_ratio / _bot_choose_weapon / _apply_bot_tactics /
 * _execute_shot (bot half). RNG is injectable for parity tests.
 * The human ammo debit (D1 user_items) is injected as `spendAmmo` so this
 * module stays persistence-free; the Durable Object wires storage in.
 */
import {
  towerHp, obstacleAt, towerBlocks, TOWER_X_RANGE, cooldownFor, fireWeapon,
  type Rng, defaultRng,
} from "./game_logic.js";
import { WEAPONS } from "./economy.js";

export function towerRatio(state: any, side: string): number {
  const hp = towerHp(state, side);
  return hp.hp / Math.max(1.0, hp.max);
}

export function botChooseWeapon(state: any, rng: Rng = defaultRng): string {
  const controls = state.bot_controls ?? {};
  const profile = state.ai_profile ?? {};
  const ammo = (state.bot_ammo ??= {});
  if (controls.enabled === false || controls.special_weapons === false) return "standard";
  const available = ["double_bomb", "homing_missile", "cluster_shell"].filter(
    (w) => (controls[w] ?? true) && (controls.infinite_ammo || (ammo[w] ?? 0) > 0));
  if (!available.length) return "standard";
  const skill = Number(profile.weapon_skill ?? 0.5);
  const aggression = Number(profile.aggression ?? 0.5);
  const enemyRatio = towerRatio(state, "p1");
  const scores: Record<string, number> = {
    standard: 0.35 + (1 - aggression) * 0.35,
    double_bomb: 0.45 + (1 - enemyRatio) * 0.45,
    homing_missile: 0.45 + Math.min(1, Math.abs(Number(state.wind ?? 0)) / 30) * 0.65,
    cluster_shell: 0.45 + enemyRatio * 0.55,
  };
  // v23 item C (mirror): coating-aware weapons - coated targets shrug off
  // glancing blasts, so prefer direct-hit weapons and fast coating wear.
  if (controls.coating_aware !== false) {
    const ecoat = (state.coatings ?? {}).p1;
    if (ecoat && Number(ecoat.hp ?? 0) > 0) {
      scores.homing_missile += 0.5;
      scores.double_bomb += 0.15;
      scores.cluster_shell -= 0.35;
    }
  }
  const best = available.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  return rng() < Math.min(1.0, skill * (0.7 + 0.3 * aggression)) ? best : "standard";
}

export function applyBotTactics(m: any, rng: Rng = defaultRng): any[] {
  const state = m.state;
  const controls = state.bot_controls ?? {};
  const profile = state.ai_profile ?? {};
  const events: any[] = [];
  const tactics = (state.bot_tactics ??= { history: [] });
  if (controls.enabled === false) return events;
  // Reactive shield is based on real HP/loss, never an unconditional pre-shot roll.
  const current = towerHp(state, "p2").hp;
  const previous = Number(tactics.last_hp ?? current);
  const loss = Math.max(0, previous - current);
  const abilities = (state.abilities ??= {}).p2 ??= {};
  if ((controls.reactive_shield ?? true) && (abilities.shield ?? 0) > 0
      && !(state.shield ??= {}).p2
      && (towerRatio(state, "p2") <= Number(profile.shield_hp ?? 0.4)
          || loss >= Number(profile.shield_damage ?? 60))) {
    abilities.shield -= 1;
    state.shield.p2 = true;
    events.push({ type: "shield", side: "p2", active: true, reason: "reactive" });
  }
  tactics.last_hp = current;
  // One legal movement, selected only when risk/obstacle makes it useful.
  if ((controls.movement ?? true) && ((state.moves_left ??= {}).p2 ?? 0) > 0
      && rng() < Number(profile.move_chance ?? 0)) {
    const old = state.tower_x.p2;
    const ob = obstacleAt(state);
    let direction = old < TOWER_X_RANGE.p2[1] - 30 ? 1 : -1;
    if (ob && (ob.x ?? 0) > 500) direction = ob.x < old ? 1 : -1;
    state.tower_x.p2 = Math.max(TOWER_X_RANGE.p2[0], Math.min(TOWER_X_RANGE.p2[1], old + direction * 45));
    if (state.tower_x.p2 !== old) {
      state.moves_left.p2 -= 1;
      events.push({ type: "tower_move", side: "p2", direction: direction > 0 ? "right" : "left", reason: "tactical" });
    }
  }
  return events;
}

export interface ShotError { status: number; body: Record<string, unknown>; }

/**
 * Port of _execute_shot. Returns [events, won] on success or a ShotError.
 * `spendAmmo(userId, weapon)` must return true when the human's consumable
 * was debited; for the AI side pass null (bot ammo is handled internally).
 */
export function executeShot(
  m: any, side: string, angle: number, power: number, weapon = "standard",
  mega = false, userId: number | null = null,
  spendAmmo: ((userId: number, weapon: string) => boolean) | null = null,
  rng: Rng = defaultRng, now?: number,
): [{ events: any[]; won: boolean } | null, ShotError | null] {
  const t = now ?? Date.now() / 1000;
  if (!(weapon in WEAPONS)) return [null, { status: 400, body: { error: "bad_weapon" } }];
  const state = m.state;
  const last = state.last_shot_at[side];
  const remaining = cooldownFor(weapon) - (t - last);
  if (remaining > 0.05) return [null, { status: 429, body: { error: "reloading", remaining: Math.round(remaining * 100) / 100, error_he: "התותח בטעינה." } }];
  if (weapon !== "standard") {
    if (side === "p2" && m.p2_ai) {
      const controls = state.bot_controls ?? {};
      const ammo = (state.bot_ammo ??= {});
      if (!controls.infinite_ammo) {
        if ((ammo[weapon] ?? 0) < 1) return [null, { status: 400, body: { error: "no_ammo" } }];
        ammo[weapon] -= 1;
      }
    } else {
      if (!spendAmmo || userId == null || !spendAmmo(userId, weapon)) {
        return [null, { status: 400, body: { error: "no_ammo", error_he: "אין לך תחמושת מהסוג הזה." } }];
      }
    }
  }
  if (mega) {
    const abilities = (state.abilities ??= {})[side] ??= {};
    const charges = abilities.mega ?? 0;
    if (charges < 1) return [null, { status: 400, body: { error: "no_ability", error_he: "יכולת המגה כבר נוצלה." } }];
    abilities.mega = charges - 1;
  }
  const enemySide = side === "p2" ? "p1" : "p2";
  const before = towerHp(state, enemySide).hp;
  const [events, won] = fireWeapon(state, side, angle, Math.min(100, power * (mega ? 1.2 : 1)), weapon, rng, t);
  if (mega) events.push({ type: "ability", side, ability: "mega" });
  const after = towerHp(state, enemySide).hp;
  if (side === "p2" && m.p2_ai) {
    const tactics = (state.bot_tactics ??= {});
    const history = (tactics.history ??= []);
    const shot = events.find((e) => e.type === "shot") ?? {};
    const points = shot.points ?? [];
    const impactX = points.length ? points[points.length - 1][0] : null;
    const blocks = [...towerBlocks(state, "p1")];
    const targetX = blocks.reduce((s, b) => s + b[2], 0) / Math.max(1, blocks.length);
    const ob = obstacleAt(state);
    const blocked = Boolean(points.length && ob
      && (ob.x ?? 0) <= points[points.length - 1][0] && points[points.length - 1][0] <= (ob.x ?? 0) + (ob.w ?? 0)
      && (ob.y ?? 0) <= points[points.length - 1][1] && points[points.length - 1][1] <= 520);
    const offWorld = events.some((e) => e.type === "explosion" && e.cosmetic);
    const result = {
      weapon, damage: Math.round(Math.max(0, before - after) * 10) / 10,
      angle: Math.round(angle * 100) / 100, power: Math.round(power * 100) / 100,
      blocked, off_world: offWorld,
      impact_x: impactX != null ? Math.round(impactX * 10) / 10 : null,
      target_x: Math.round(targetX * 10) / 10,
    };
    history.push(result);
    const depth = Number((state.ai_profile ?? {}).memory ?? 3);
    while (history.length > Math.max(1, depth)) history.shift();
    tactics.last_weapon = weapon;
    tactics.last_result = result;
    events.push({ type: "bot_decision", weapon, mega, ammo: { ...(state.bot_ammo ?? {}) }, result });
  }
  return [{ events, won }, null];
}