/**
 * Brigagame 2.0 - server-authoritative game simulation.
 * Faithful TypeScript port of backend/game_logic.py.
 *
 * World coordinates: canvas 1000 x 560, y grows downward, ground at y=520.
 * Towers are block grids; every hit permanently removes HP from blocks.
 * All math happens here on the server; the client only renders.
 *
 * RNG is injectable (rng: () => number in [0,1)) so parity tests can drive
 * both implementations with identical streams.
 */
import { WEAPONS, armorReduction, hpMultiplier } from "./economy.js";

export const WORLD_W = 1000;
export const WORLD_H = 560;
export const GROUND_Y = 520;
export const BLOCK = 26;
export const TOWER_COLS = 4;
export const TOWER_ROWS = 6;
export const BLOCK_HP = 18;
export const TOWER_X: Record<string, number> = { p1: 140, p2: 760 };
export const TOWER_X_RANGE: Record<string, [number, number]> = { p1: [60, 260], p2: [640, 840] };
export const GRAVITY = 700.0;
export const POWER_SCALE = 10.0;
export const DT = 0.02;
export const MAX_FLIGHT = 20.0;
export const WIND_MAX = 40.0;
export const WIND_ACCEL = 0.75;
export const MAPS = ["valley", "desert", "highlands"] as const;
export const DESTROY_FRACTION = 0.75;

export type Tower = (number | null)[][];
export type Rng = () => number;
export const defaultRng: Rng = Math.random;

export interface PlayerMods {
  armor: number; hp: number; skin: string | null;
  coating?: { material: string; hp: number; max_hp: number } | null;
  extra_cubes?: number;
  expansion_cube_hp?: number;
  dynamic_obstacle?: { enabled: boolean; speed: number; warning_seconds: number };
}

export function towerDims(tower: Tower): [number, number] {
  return [tower.length, tower.length ? tower[0].length : 0];
}

export function obstacleAt(state: any, atTime?: number): any {
  const ob = { ...(state.obstacle || {}) };
  const motion = state.obstacle_motion || {};
  if (!ob.x || !motion.enabled) return ob;
  const lo = Number(motion.min_x), hi = Number(motion.max_x);
  const distance = Math.max(0, hi - lo);
  const speed = Math.max(1, Number(motion.speed ?? 20));
  const dwell = Math.max(0, Number(motion.warning_seconds ?? 0));
  const travel = distance ? distance / speed : 0;
  const leg = dwell + travel;
  const cycle = 2 * leg;
  const phase = (Number(atTime ?? Date.now() / 1000) - Number(motion.epoch ?? 0)) % Math.max(0.001, cycle);
  const reverse = phase >= leg;
  const local = reverse ? phase - leg : phase;
  const warning = local < dwell;
  const progress = warning || travel === 0 ? 0 : Math.min(1, (local - dwell) / travel);
  const x = reverse ? hi - progress * distance : lo + progress * distance;
  return { ...ob, x: Math.round(x * 100) / 100, moving: !warning && distance > 0, warning,
           direction: reverse ? -1 : 1,
           motion: { enabled: true, min_x: lo, max_x: hi, speed, warning_seconds: dwell, epoch: Number(motion.epoch ?? 0) } };
}

export function expandedDims(extraCubes: number): [number, number, number] {
  const extra = Math.max(0, Math.trunc(extraCubes || 0));
  const cols = TOWER_COLS + Math.floor(extra / TOWER_ROWS);
  const rem = extra % TOWER_ROWS;
  return [TOWER_ROWS, cols, rem];
}

export function newTower(hpLevel = 0, extraCubes = 0, cubeHp = BLOCK_HP): Tower {
  const mult = hpMultiplier(hpLevel);
  const [rows, cols, rem] = expandedDims(extraCubes);
  const baseHp = Math.round(BLOCK_HP * mult * 10) / 10;
  let tower: Tower = Array.from({ length: rows }, () => Array(cols).fill(baseHp));
  const fullExtraCols = Math.max(0, cols - TOWER_COLS);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < fullExtraCols; c++)
      tower[r][c] = Math.round(cubeHp * mult * 10) / 10;
  if (rem) {
    tower = tower.map(row => [null, ...row]);
    for (let r = rows - rem; r < rows; r++)
      tower[r][0] = Math.round(cubeHp * mult * 10) / 10;
  }
  return tower;
}

function randint(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function newState(p1Mods: PlayerMods, p2Mods: PlayerMods, rng: Rng = defaultRng, now?: number): any {
  const t = now ?? Date.now() / 1000;
  const p1c = expandedDims(p1Mods.extra_cubes ?? 0);
  const p2c = expandedDims(p2Mods.extra_cubes ?? 0);
  const p1Cols = p1c[1] + (p1c[2] ? 1 : 0);
  const p2Cols = p2c[1] + (p2c[2] ? 1 : 0);
  const p1x = randint(rng, TOWER_X_RANGE.p1[0], Math.min(TOWER_X_RANGE.p1[1], 420 - p1Cols * BLOCK));
  const p2x = randint(rng, Math.max(TOWER_X_RANGE.p2[0], 580 + (p2Cols - TOWER_COLS) * BLOCK),
                      Math.min(TOWER_X_RANGE.p2[1], WORLD_W - 40 - p2Cols * BLOCK));
  const gapStart = p1x + p1Cols * BLOCK + 60, gapEnd = p2x - 128;
  const obstacleX = randint(rng, Math.floor(gapStart), Math.floor(Math.max(gapStart, gapEnd)));
  const dyn = p1Mods.dynamic_obstacle || { enabled: false, speed: 20, warning_seconds: 1.5 };
  const p1CubeHp = p1Mods.expansion_cube_hp ?? BLOCK_HP;
  const p2CubeHp = p2Mods.expansion_cube_hp ?? BLOCK_HP;
  return {
    tower_x: { p1: p1x, p2: p2x },
    map: MAPS[randint(rng, 0, MAPS.length - 1)],
    obstacle: { x: obstacleX, y: GROUND_Y - 105, w: 68, h: 105 },
    obstacle_motion: { enabled: !!dyn.enabled, min_x: gapStart, max_x: Math.max(gapStart, gapEnd),
                       speed: Number(dyn.speed ?? 20), warning_seconds: Number(dyn.warning_seconds ?? 1.5), epoch: t },
    towers: { p1: newTower(p1Mods.hp ?? 0, p1Mods.extra_cubes ?? 0, p1CubeHp),
              p2: newTower(p2Mods.hp ?? 0, p2Mods.extra_cubes ?? 0, p2CubeHp) },
    mods: { p1: p1Mods, p2: p2Mods },
    tower_max_hp: {
      p1: Math.round((TOWER_COLS * TOWER_ROWS * BLOCK_HP + (p1Mods.extra_cubes ?? 0) * p1CubeHp) * hpMultiplier(p1Mods.hp ?? 0) * 10) / 10,
      p2: Math.round((TOWER_COLS * TOWER_ROWS * BLOCK_HP + (p2Mods.extra_cubes ?? 0) * p2CubeHp) * hpMultiplier(p2Mods.hp ?? 0) * 10) / 10 },
    wind: Math.round((rng() * 2 - 1) * WIND_MAX * 10) / 10,
    last_shot_at: { p1: 0, p2: 0 },
    damage_dealt: { p1: 0, p2: 0 },
    coatings: { p1: p1Mods.coating ?? null, p2: p2Mods.coating ?? null },
    ready: { p1: false, p2: false },
    started_at: t,
    sudden_death: false,
    last_turn_at: { p1: t, p2: t },
    moves_left: { p1: 1, p2: 1 },
    abilities: { p1: { shield: 1, mega: 1 }, p2: { shield: 1, mega: 1 } },
    shield: { p1: false, p2: false },
    shot_count: 0,
  };
}

export function towerXOf(state: any, side: string): number {
  return (state.tower_x || TOWER_X)[side];
}

export function* towerBlocks(state: any, side: string): Generator<[number, number, number, number]> {
  const x0 = towerXOf(state, side);
  const [rows, cols] = towerDims(state.towers[side]);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      yield [r, c, x0 + c * BLOCK + BLOCK / 2, GROUND_Y - (rows - r) * BLOCK + BLOCK / 2];
}

export function muzzle(state: any, side: string): [number, number] {
  const x0 = towerXOf(state, side);
  const [rows, cols] = towerDims(state.towers[side]);
  return [x0 + cols * BLOCK / 2, GROUND_Y - rows * BLOCK - 8];
}

export function towerHp(state: any, side: string): { hp: number; max: number } {
  const tw = state.towers[side] as Tower;
  let hp = 0, maxBlocks = 0;
  for (const row of tw) for (const v of row) {
    if (v !== null) { hp += v; maxBlocks++; }
  }
  const mult = hpMultiplier(state.mods?.[side]?.hp ?? 0);
  const fallback = Math.round(BLOCK_HP * mult * maxBlocks * 10) / 10;
  return { hp: Math.round(hp * 10) / 10, max: state.tower_max_hp?.[side] ?? fallback };
}

export function towerAlive(tower: Tower): boolean {
  let total = 0, alive = 0;
  for (const row of tower) for (const hp of row) {
    if (hp !== null) { total++; if (hp > 0) alive++; }
  }
  return alive > total * (1 - DESTROY_FRACTION);
}

export function explode(state: any, x: number, y: number, damage: number, radius: number,
                        attacker: string, events: any[], cosmetic = false): number {
  const enemy = attacker === "p1" ? "p2" : "p1";
  let dealt = 0;
  const destroyed: any[] = [];
  if (!cosmetic) {
    const armorLvl = state.mods[enemy].armor ?? 0;
    let mult = armorReduction(armorLvl);
    const coating = state.coatings?.[enemy];
    if (coating && coating.hp > 0) {
      const incoming = Math.max(0, damage * mult);
      const absorbed = Math.min(coating.hp, incoming);
      if (coating.material === "wood" && incoming > 0) coating.hp = 0;
      else coating.hp = Math.round(Math.max(0, coating.hp - absorbed) * 10) / 10;
      mult *= incoming ? Math.max(0, 1 - absorbed / incoming) : 0;
      events.push({ type: "coating_hit", side: enemy, material: coating.material,
                    absorbed: Math.round(absorbed * 10) / 10, hp: coating.hp, broken: coating.hp <= 0 });
    }
    if (state.shield?.[enemy]) {
      mult *= 0.4;
      state.shield[enemy] = false;
      events.push({ type: "shield", side: enemy, active: false });
    }
    if (state.sudden_death) mult *= 2;
    for (const [r, c, cx, cy] of towerBlocks(state, enemy)) {
      const hp = state.towers[enemy][r][c];
      if (hp === null || hp <= 0) continue;
      const dist = Math.hypot(cx - x, cy - y);
      if (dist <= radius) {
        const dmg = damage * (1 - dist / radius) * mult;
        if (dmg <= 0) continue;
        const newHp = Math.round((hp - dmg) * 10) / 10;
        dealt += Math.min(hp, dmg);
        state.towers[enemy][r][c] = Math.max(0, newHp);
        if (newHp <= 0) destroyed.push({ r, c });
      }
    }
    for (const [r, c, cx, cy] of towerBlocks(state, attacker)) {
      const hp = state.towers[attacker][r][c];
      if (hp === null || hp <= 0) continue;
      const dist = Math.hypot(cx - x, cy - y);
      if (dist <= radius * 0.7) {
        const dmg = damage * 0.3 * (1 - dist / (radius * 0.7));
        if (dmg > 0) state.towers[attacker][r][c] = Math.max(0, Math.round((hp - dmg) * 10) / 10);
      }
    }
    state.damage_dealt[attacker] = Math.round((state.damage_dealt[attacker] + dealt) * 10) / 10;
    const collapsed: any[] = [];
    for (const side of [enemy, attacker]) {
      const tw = state.towers[side] as Tower;
      let changed = true;
      while (changed) {
        changed = false;
        const [rows, cols] = towerDims(tw);
        for (let c = 0; c < cols; c++)
          for (let r = 0; r < rows - 1; r++)
            if (tw[r][c] !== null && tw[r][c]! > 0 && tw[r + 1][c] !== null && tw[r + 1][c]! <= 0) {
              tw[r][c] = 0;
              collapsed.push({ side, r, c });
              changed = true;
            }
      }
    }
    if (collapsed.length) events.push({ type: "collapse", blocks: collapsed });
  }
  events.push({ type: "explosion", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, radius,
                destroyed, damage: Math.round(dealt * 10) / 10, attacker, target: enemy, cosmetic });
  return dealt;
}

export function simulate(state: any, side: string, angleDeg: number, power: number,
                         weapon: string, events: any[], _targetSide?: string, now?: number): [number | null, number | null, number[][], boolean] {
  const enemy = side === "p1" ? "p2" : "p1";
  const facing = side === "p1" ? 1 : -1;
  const angle = angleDeg * Math.PI / 180;
  const speed = power * POWER_SCALE;
  let [x, y] = muzzle(state, side);
  let vx = facing * speed * Math.cos(angle);
  let vy = -speed * Math.sin(angle);
  const w = WEAPONS[weapon];
  const points: number[][] = [];
  let t = 0;
  const homing = weapon === "homing_missile";
  const [ex, ey] = muzzle(state, enemy);
  let step = 0;
  const t0 = now ?? Date.now() / 1000;
  while (t < MAX_FLIGHT) {
    t += DT; step++;
    vx += state.wind * WIND_ACCEL * DT;
    vy += GRAVITY * DT;
    if (homing) {
      const dx = ex - x, dy = ey - y;
      const d = Math.hypot(dx, dy) || 1;
      const steer = 90;
      vx += dx / d * steer * DT;
      vy += dy / d * steer * DT;
    }
    x += vx * DT; y += vy * DT;
    if (step % 6 === 0) points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    if (y >= GROUND_Y) {
      points.push([Math.round(x * 10) / 10, GROUND_Y]);
      return [x, GROUND_Y, points, false];
    }
    const ob = obstacleAt(state, t0 + t);
    if (ob && ob.x !== undefined && ob.x <= x && x <= ob.x + ob.w && ob.y <= y && y <= GROUND_Y) {
      points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      return [x, y, points, false];
    }
    for (const s of [enemy, side]) {
      let hit = false;
      for (const [r, c, cx, cy] of towerBlocks(state, s)) {
        const hp = state.towers[s][r][c];
        if (hp !== null && hp > 0 && Math.abs(x - cx) <= BLOCK / 2 && Math.abs(y - cy) <= BLOCK / 2) {
          points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
          return [x, y, points, false];
        }
      }
      if (hit) break;
    }
    if (x < -80 || x > WORLD_W + 80) {
      const cx2 = Math.max(10, Math.min(WORLD_W - 10, x));
      const cy2 = Math.max(40, Math.min(GROUND_Y, y));
      points.push([Math.round(cx2 * 10) / 10, Math.round(cy2 * 10) / 10]);
      return [cx2, cy2, points, true];
    }
  }
  return [null, null, points, true];
}

export function criticalMultiplier(state: any, attacker: string, x: number, y: number, events: any[]): number {
  const enemy = attacker === "p1" ? "p2" : "p1";
  const [mx, my] = muzzle(state, enemy);
  if (Math.hypot(x - mx, y - my) <= 24) {
    events.push({ type: "critical", side: attacker, target: enemy });
    return 2.5;
  }
  return 1.0;
}

export function fireWeapon(state: any, side: string, angle: number, power: number, weapon: string,
                           rng: Rng = defaultRng, now?: number): [any[], boolean] {
  angle = Math.max(0, Math.min(90, angle));
  power = Math.max(5, Math.min(100, power));
  const enemy = side === "p1" ? "p2" : "p1";
  const events: any[] = [];
  const w = WEAPONS[weapon] ?? WEAPONS.standard;

  if (weapon === "double_bomb") {
    [power, power * 0.85].forEach((p, i) => {
      const ev: any[] = [];
      const [x, y, pts, off] = simulate(state, side, angle + i * 6, p, "standard", ev, enemy, now);
      events.push({ type: "shot", side, weapon, angle: angle + i * 6, power: p, points: pts });
      if (x !== null) {
        if (off) explode(state, x, y!, 0, 26, side, ev, true);
        else explode(state, x, y!, w.damage * criticalMultiplier(state, side, x, y!, ev), w.radius, side, ev);
      }
      events.push(...ev);
    });
  } else if (weapon === "cluster_shell") {
    const ev: any[] = [];
    const [x, y, pts, off] = simulate(state, side, angle, power, weapon, ev, enemy, now);
    events.push({ type: "shot", side, weapon, angle, power, points: pts });
    const apex = pts.length ? pts[Math.floor(pts.length / 2)] : [x ?? 500, 150];
    for (let k = 0; k < 4; k++) {
      const sx = (x === null ? apex[0] : x) + (k - 1.5) * 38;
      const sy = y ?? GROUND_Y;
      const sub: any[] = [];
      explode(state, sx, sy, w.damage, w.radius, side, sub);
      events.push({ type: "shot", side, weapon: "cluster_mini", points: [[apex[0], apex[1]], [Math.round(sx * 10) / 10, Math.round(sy * 10) / 10]] });
      events.push(...sub);
    }
  } else {
    const ev: any[] = [];
    const [x, y, pts, off] = simulate(state, side, angle, power, weapon, ev, enemy, now);
    events.push({ type: "shot", side, weapon, angle, power, points: pts });
    if (x !== null) {
      if (off) explode(state, x, y!, 0, 26, side, ev, true);
      else explode(state, x, y!, w.damage * criticalMultiplier(state, side, x, y!, ev), w.radius, side, ev);
    }
    events.push(...ev);
  }

  const previousWind = state.wind;
  state.wind = Math.round((rng() * 2 - 1) * WIND_MAX * 10) / 10;
  events.push({ type: "wind", wind: state.wind, previous: previousWind });
  const t = now ?? Date.now() / 1000;
  state.last_shot_at[side] = t;
  state.last_turn_at = state.last_turn_at || {};
  state.last_turn_at[side] = t;
  state.shot_count = (state.shot_count || 0) + 1;
  if (state.shot_count % 3 === 0) {
    const kind = ["gust", "meteor", "charge"][randint(rng, 0, 2)];
    if (kind === "gust") state.wind = Math.round((rng() < 0.5 ? -1 : 1) * WIND_MAX * 10) / 10;
    else if (kind === "meteor") {
      const mx = randint(rng, 360, 640);
      explode(state, mx, GROUND_Y, 10, 48, side, events);
    } else {
      state.abilities = state.abilities || {};
      state.abilities[side] = state.abilities[side] || {};
      state.abilities[side].mega = (state.abilities[side].mega ?? 0) + 1;
    }
    events.push({ type: "random_event", kind });
  }
  return [events, !towerAlive(state.towers[enemy])];
}

export function cooldownFor(weapon: string): number {
  return (WEAPONS[weapon] ?? WEAPONS.standard).cooldown;
}

export interface AiProfile {
  angle_noise?: number; power_spread?: number; wind_skill?: number;
  reaction?: number; correction?: number; aggression?: number; weapon_skill?: number;
  memory?: number; [k: string]: number | undefined;
}


/**
 * v23 item B (mirror of game_logic.py): base-row aimpoints - the lowest live
 * block of every tower column.
 */
export function aimCandidates(state: any, enemy: string): [number, number][] {
  const byCol = new Map<number, [number, number, number][]>();
  for (const [r, c, cx, cy] of towerBlocks(state, enemy)) {
    const hp = state.towers[enemy][r][c];
    if (hp !== null && hp > 0) {
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c)!.push([r, cx, cy]);
    }
  }
  const out: [number, number][] = [];
  for (const lst of byCol.values()) {
    let best = lst[0];
    for (const b of lst) if (b[0] > best[0]) best = b;
    out.push([best[1], best[2]]);
  }
  return out;
}

/**
 * Simulated structural damage of a standard blast at (x, y), running the real
 * explode mechanics on a throwaway clone (coating-aware unless ignored).
 */
export function expectedDamage(state: any, side: string, x: number, y: number, ignoreCoating = false): number {
  const st = structuredClone(state);
  if (ignoreCoating) st.coatings = { p1: null, p2: null };
  const w = WEAPONS.standard;
  return explode(st, x, y, w.damage, w.radius, side, []);
}

export function aiChooseShot(state: any, side = "p2", difficulty = "normal",
                             rankLevel?: number, profileOverride?: AiProfile,
                             rng: Rng = defaultRng, now?: number): [number, number, string] {
  const enemy = side === "p2" ? "p1" : "p2";
  const facing = side === "p1" ? 1 : -1;
  const [sx, sy] = muzzle(state, side);
  const blocks: [number, number][] = [];
  for (const [r, c, cx, cy] of towerBlocks(state, enemy)) {
    const hp = state.towers[enemy][r][c];
    if (hp !== null && hp > 0) blocks.push([cx, cy]);
  }
  let tx: number, ty: number;
  if (blocks.length) {
    tx = blocks.reduce((a, b) => a + b[0], 0) / blocks.length;
    ty = blocks.reduce((a, b) => a + b[1], 0) / blocks.length;
  } else {
    [tx, ty] = muzzle(state, enemy);
  }
  const dist = Math.max(60, Math.abs(tx - sx));
  const profiles: Record<string, { angle_noise: number; power_min: number; power_max: number }> = {
    easy:   { angle_noise: 20, power_min: 0.72, power_max: 1.28 },
    normal: { angle_noise: 13, power_min: 0.82, power_max: 1.20 },
    hard:   { angle_noise: 6,  power_min: 0.93, power_max: 1.08 },
  };
  let profile: { angle_noise: number; power_min: number; power_max: number };
  if (difficulty === "ranked") {
    const lvl = Math.max(1, Math.min(18, Math.trunc(rankLevel ?? 1)));
    const t = (lvl - 1) / 17;
    profile = { angle_noise: 16 - 12.5 * t, power_min: 0.80 + 0.16 * t, power_max: 1.22 - 0.18 * t };
  } else {
    profile = profiles[difficulty] ?? profiles.normal;
  }
  const override = profileOverride || state.ai_profile || {};
  let windSkill: number;
  if (Object.keys(override).length) {
    const spread = Math.max(0, Math.min(0.5, override.power_spread ?? 0.1));
    profile = { angle_noise: Math.max(0, Math.min(45, override.angle_noise ?? profile.angle_noise)),
                power_min: 1 - spread, power_max: 1 + spread };
  }
  const tier = state.ai_tier ?? "medium";
  if (Object.keys(override).length) {
    windSkill = Math.max(0, Math.min(1, override.wind_skill ?? 0));
  } else if (tier === "expert") {
    windSkill = 1.0;
    profile = { angle_noise: 0.8, power_min: 0.995, power_max: 1.005 };
  } else if (tier === "ultra") {
    windSkill = 1.0;
  } else if (tier === "hard") {
    windSkill = 0.7;
  } else if (difficulty === "ranked") {
    windSkill = Math.max(0, Math.min(1, (Math.trunc(rankLevel ?? 1) - 1) / 17));
  } else {
    windSkill = 0.0;
  }
  const alongAccel = (state.wind ?? 0) * WIND_ACCEL * facing * windSkill;

  // v23 item B (mirror): deep aim - pick the aimpoint with the best
  // simulated blast overlap among base-row candidates (plus center of mass).
  let dist2 = dist;
  if (blocks.length && (state.bot_controls ?? {}).deep_aim !== false) {
    const candidates = aimCandidates(state, enemy);
    candidates.push([tx, ty]);
    let bestScore: [number, number, number] | null = null;
    let bestTarget: [number, number] = [tx, ty];
    const tan0 = 1.0; // tan(45deg)
    const cos0 = Math.SQRT1_2;
    for (const [cx, cy] of candidates) {
      const distC = Math.max(60, Math.abs(cx - sx));
      const dyC = cy - sy;
      const t2n = 2 * (dyC + distC * tan0);
      const t2d = GRAVITY + alongAccel * tan0;
      const ft = Math.sqrt(Math.max(0.01, t2n / Math.max(1, t2d)));
      const v0 = (distC - 0.5 * alongAccel * ft * ft) / Math.max(0.05, cos0 * ft);
      const p0 = Math.min(96, Math.max(30, v0 / POWER_SCALE));
      const ev: any[] = [];
      const [ix, iy] = simulate(state, side, 45.0, p0, "standard", ev, undefined, now);
      if (ix === null) continue;
      const dealt = expectedDamage(state, side, ix, iy!);
      const raw = expectedDamage(state, side, ix, iy!, true);
      const score: [number, number, number] =
        [Math.round(dealt * 10) / 10, Math.round(raw * 10) / 10, Math.round(cy * 10) / 10];
      if (bestScore === null || score[0] > bestScore[0]
          || (score[0] === bestScore[0] && score[1] > bestScore[1])
          || (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] > bestScore[2])) {
        bestScore = score;
        bestTarget = [cx, cy];
      }
    }
    [tx, ty] = bestTarget;
    dist2 = Math.max(60, Math.abs(tx - sx));
  }

  const angle = 45 + (rng() * 2 - 1) * profile.angle_noise;
  const rad = angle * Math.PI / 180;
  const dy = ty - sy;
  const tanA = Math.tan(rad);
  const t2Num = 2 * (dy + dist2 * tanA);
  const t2Den = GRAVITY + alongAccel * tanA;
  const flightT = Math.sqrt(Math.max(0.01, t2Num / Math.max(1, t2Den)));
  const v = (dist2 - 0.5 * alongAccel * flightT * flightT) / Math.max(0.05, Math.cos(rad) * flightT);
  let power = v / POWER_SCALE * (profile.power_min + rng() * (profile.power_max - profile.power_min));
  power = Math.min(96, Math.max(30, power));
  return [angle, power, "standard"];
}