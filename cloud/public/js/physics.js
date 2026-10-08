"use strict";
var BrigaPhysics = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/game/predict.ts
  var predict_exports = {};
  __export(predict_exports, {
    predict: () => predict
  });

  // src/game/economy.ts
  var WEAPONS = {
    standard: { damage: 34, radius: 64, cooldown: 4 },
    double_bomb: { damage: 34, radius: 50, cooldown: 5 },
    homing_missile: { damage: 55, radius: 60, cooldown: 5 },
    cluster_shell: { damage: 18, radius: 40, cooldown: 6 },
    piercing_shell: { damage: 24, radius: 14, cooldown: 8 },
    emp_shell: { damage: 8, radius: 32, cooldown: 7 }
  };
  function armorReduction(level) {
    return Math.max(0.7, 1 - 0.04 * Math.max(0, Math.min(5, level)));
  }

  // src/game/game_logic.ts
  var WORLD_W = 1e3;
  var GROUND_Y = 520;
  var OBSTACLE_H = 184;
  var BLOCK = 26;
  var TOWER_X = { p1: 140, p2: 760 };
  var GRAVITY = 700;
  var POWER_SCALE = 10;
  var DT = 0.02;
  var MAX_FLIGHT = 20;
  var WIND_MAX = 40;
  var WIND_ACCEL = 0.75;
  var DESTROY_FRACTION = 0.75;
  var defaultRng = Math.random;
  function towerDims(tower) {
    return [tower.length, tower.length ? tower[0].length : 0];
  }
  function obstacleAt(state, atTime) {
    const ob = { ...state.obstacle || {} };
    const motion = state.obstacle_motion || {};
    if (!ob.x || !motion.enabled) return ob;
    const t = Number(atTime ?? Date.now() / 1e3);
    const epoch = Number(motion.epoch ?? 0);
    const lo = Number(motion.min_x), hi = Number(motion.max_x);
    const distance = Math.max(0, hi - lo);
    const speed = Math.max(1, Number(motion.speed ?? 20));
    const dwell = Math.max(0, Number(motion.warning_seconds ?? 0));
    const travel = distance ? distance / speed : 0;
    const leg = dwell + travel;
    const cycle = 2 * leg;
    const phase = (t - epoch) % Math.max(1e-3, cycle);
    const reverse = phase >= leg;
    const local = reverse ? phase - leg : phase;
    const warning = local < dwell;
    const progress = warning || travel === 0 ? 0 : Math.min(1, (local - dwell) / travel);
    const x = reverse ? hi - progress * distance : lo + progress * distance;
    const vEnabled = !!motion.v_enabled;
    const vLo = Number(motion.min_lift ?? 0), vHi = Number(motion.max_lift ?? 0);
    const vDist = Math.max(0, vHi - vLo);
    const vSpeed = Math.max(1, Number(motion.v_speed ?? 14));
    let lift = 0;
    if (vEnabled && vDist > 0) {
      const vTravel = vDist / vSpeed;
      const vCycle = Math.max(1e-3, 2 * vTravel);
      const vPhase = ((t - epoch) % vCycle + vCycle) % vCycle;
      const vReverse = vPhase >= vTravel;
      const vProgress = vTravel === 0 ? 0 : Math.min(1, (vReverse ? vPhase - vTravel : vPhase) / vTravel);
      const eased = (1 - Math.cos(Math.PI * vProgress)) / 2;
      lift = vReverse ? vHi - eased * vDist : vLo + eased * vDist;
    }
    lift = Math.round(lift * 100) / 100;
    const restY = Number(ob.y ?? GROUND_Y - Number(ob.h ?? OBSTACLE_H));
    return {
      ...ob,
      x: Math.round(x * 100) / 100,
      y: Math.round((restY - lift) * 100) / 100,
      lift,
      moving: !warning && distance > 0,
      v_moving: vEnabled && vDist > 0,
      warning,
      direction: reverse ? -1 : 1,
      motion: {
        enabled: true,
        min_x: lo,
        max_x: hi,
        speed,
        warning_seconds: dwell,
        epoch,
        v_enabled: vEnabled,
        min_lift: vLo,
        max_lift: vHi,
        v_speed: vSpeed
      }
    };
  }
  function randint(rng, lo, hi) {
    return lo + Math.floor(rng() * (hi - lo + 1));
  }
  function towerXOf(state, side) {
    return (state.tower_x || TOWER_X)[side];
  }
  function* towerBlocks(state, side) {
    const x0 = towerXOf(state, side);
    const [rows, cols] = towerDims(state.towers[side]);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        yield [r, c, x0 + c * BLOCK + BLOCK / 2, GROUND_Y - (rows - r) * BLOCK + BLOCK / 2];
  }
  function muzzle(state, side) {
    const x0 = towerXOf(state, side);
    const [rows, cols] = towerDims(state.towers[side]);
    return [x0 + cols * BLOCK / 2, GROUND_Y - rows * BLOCK - 8];
  }
  function towerAlive(tower) {
    let total = 0, alive = 0;
    for (const row of tower) for (const hp of row) {
      if (hp !== null) {
        total++;
        if (hp > 0) alive++;
      }
    }
    return alive > total * (1 - DESTROY_FRACTION);
  }
  function explode(state, x, y, damage, radius, attacker, events, cosmetic = false, coatingBypass = 0) {
    const enemy = attacker === "p1" ? "p2" : "p1";
    let dealt = 0;
    const destroyed = [];
    if (!cosmetic) {
      const armorLvl = state.mods[enemy].armor ?? 0;
      let mult = armorReduction(armorLvl);
      const coating = state.coatings?.[enemy];
      if (coating && coating.hp > 0) {
        const incoming = Math.max(0, damage * mult);
        const absorbed = Math.min(coating.hp, incoming * (1 - coatingBypass));
        if (coating.material === "wood" && incoming > 0) coating.hp = 0;
        else coating.hp = Math.round(Math.max(0, coating.hp - absorbed) * 10) / 10;
        mult *= incoming ? Math.max(0, 1 - absorbed / incoming) : 0;
        events.push({
          type: "coating_hit",
          side: enemy,
          material: coating.material,
          absorbed: Math.round(absorbed * 10) / 10,
          hp: coating.hp,
          broken: coating.hp <= 0
        });
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
      const collapsed = [];
      for (const side of [enemy, attacker]) {
        const tw = state.towers[side];
        let changed = true;
        while (changed) {
          changed = false;
          const [rows, cols] = towerDims(tw);
          for (let c = 0; c < cols; c++)
            for (let r = 0; r < rows - 1; r++)
              if (tw[r][c] !== null && tw[r][c] > 0 && tw[r + 1][c] !== null && tw[r + 1][c] <= 0) {
                tw[r][c] = 0;
                collapsed.push({ side, r, c });
                changed = true;
              }
        }
      }
      if (collapsed.length) events.push({ type: "collapse", blocks: collapsed });
    }
    events.push({
      type: "explosion",
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      radius,
      destroyed,
      damage: Math.round(dealt * 10) / 10,
      attacker,
      target: enemy,
      cosmetic
    });
    return dealt;
  }
  function simulate(state, side, angleDeg, power, weapon, events, _targetSide, now, timedPath = false) {
    const enemy = side === "p1" ? "p2" : "p1";
    const facing = side === "p1" ? 1 : -1;
    const angle = angleDeg * Math.PI / 180;
    const speed = power * POWER_SCALE;
    let [x, y] = muzzle(state, side);
    let vx = facing * speed * Math.cos(angle);
    let vy = -speed * Math.sin(angle);
    const w = WEAPONS[weapon];
    const points = timedPath ? [[x, y, 0]] : [];
    let t = 0;
    const homing = weapon === "homing_missile";
    const [ex, ey] = muzzle(state, enemy);
    let step = 0;
    const t0 = now ?? Date.now() / 1e3;
    while (t < MAX_FLIGHT) {
      t += DT;
      step++;
      vx += state.wind * WIND_ACCEL * DT;
      vy += GRAVITY * DT;
      if (homing) {
        const dx = ex - x, dy = ey - y;
        const d = Math.hypot(dx, dy) || 1;
        const steer = 90;
        vx += dx / d * steer * DT;
        vy += dy / d * steer * DT;
      }
      x += vx * DT;
      y += vy * DT;
      if (timedPath || step % 6 === 0) points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(t * 1e3) / 1e3]);
      if (y >= GROUND_Y) {
        if (timedPath) points.pop();
        points.push([Math.round(x * 10) / 10, GROUND_Y, Math.round(t * 1e3) / 1e3]);
        return [x, GROUND_Y, points, false];
      }
      const ob = obstacleAt(state, t0 + t);
      if (ob && ob.x !== void 0 && ob.x <= x && x <= ob.x + ob.w && ob.y <= y && y <= ob.y + ob.h) {
        if (timedPath) points.pop();
        points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(t * 1e3) / 1e3]);
        return [x, y, points, false];
      }
      for (const s of [enemy, side]) {
        let hit = false;
        for (const [r, c, cx, cy] of towerBlocks(state, s)) {
          const hp = state.towers[s][r][c];
          if (hp !== null && hp > 0 && Math.abs(x - cx) <= BLOCK / 2 && Math.abs(y - cy) <= BLOCK / 2) {
            if (timedPath) points.pop();
            points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(t * 1e3) / 1e3]);
            if (weapon === "piercing_shell") events.push({ type: "piercing_impact", side: s, vx, vy, r, c });
            if (weapon === "emp_shell") events.push({ type: "emp_impact", side: s });
            return [x, y, points, false];
          }
        }
        if (hit) break;
      }
      if (x < -80 || x > WORLD_W + 80) {
        const cx2 = Math.max(10, Math.min(WORLD_W - 10, x));
        const cy2 = Math.max(40, Math.min(GROUND_Y, y));
        if (timedPath) points.pop();
        points.push([Math.round(cx2 * 10) / 10, Math.round(cy2 * 10) / 10, Math.round(t * 1e3) / 1e3]);
        return [cx2, cy2, points, true];
      }
    }
    return [null, null, points, true];
  }
  function applyEmp(state, target, events, now = Date.now() / 1e3) {
    if (Number(state.emp_immune_until?.[target] ?? 0) > now) {
      events.push({ type: "emp", target, immune: true });
      return false;
    }
    (state.emp_disabled_until ??= {})[target] = now + 8;
    (state.emp_immune_until ??= {})[target] = now + 18;
    (state.shield ??= {})[target] = false;
    events.push({ type: "emp", target, disabled_until: now + 8, immune_until: now + 18 });
    return true;
  }
  function criticalMultiplier(state, attacker, x, y, events) {
    const enemy = attacker === "p1" ? "p2" : "p1";
    const [mx, my] = muzzle(state, enemy);
    if (Math.hypot(x - mx, y - my) <= 24) {
      events.push({ type: "critical", side: attacker, target: enemy });
      return 2.5;
    }
    return 1;
  }
  function fireWeapon(state, side, angle, power, weapon, rng = defaultRng, now) {
    angle = Math.max(0, Math.min(90, angle));
    power = Math.max(5, Math.min(100, power));
    const enemy = side === "p1" ? "p2" : "p1";
    const events = [];
    const w = WEAPONS[weapon] ?? WEAPONS.standard;
    if (weapon === "double_bomb") {
      [power, power * 0.85].forEach((p, i) => {
        const ev = [];
        const [x, y, pts, off] = simulate(state, side, angle + i * 6, p, "standard", ev, enemy, now, true);
        events.push({ type: "shot", side, weapon, angle: angle + i * 6, power: p, points: pts });
        if (x !== null) {
          if (off) explode(state, x, y, 0, 26, side, ev, true);
          else explode(state, x, y, w.damage * criticalMultiplier(state, side, x, y, ev), w.radius, side, ev);
        }
        events.push(...ev);
      });
    } else if (weapon === "piercing_shell" || weapon === "emp_shell") {
      const impacts = [];
      const [x, y, pts, off] = simulate(state, side, angle, power, weapon, impacts, enemy, now, true);
      events.push({ type: "shot", side, weapon, angle, power, points: pts });
      const impact = impacts.find((e) => e.side === enemy);
      if (x !== null && !off) {
        if (weapon === "piercing_shell" && impact) {
          const length = Math.hypot(impact.vx, impact.vy) || 1;
          const dx = impact.vx / length, dy = impact.vy / length;
          const cells = [];
          const seen = /* @__PURE__ */ new Set();
          for (let d = 0; d <= BLOCK * 8 && cells.length < 2; d += 2) {
            const px = x + dx * d, py = y + dy * d;
            for (const b of towerBlocks(state, enemy)) {
              const [r, c, cx, cy] = b;
              const key = `${r}:${c}`;
              if (!seen.has(key) && state.towers[enemy][r][c] > 0 && Math.abs(px - cx) <= BLOCK / 2 && Math.abs(py - cy) <= BLOCK / 2) {
                seen.add(key);
                cells.push(b);
                break;
              }
            }
          }
          for (let i = 0; i < cells.length; i++) {
            const [, , cx, cy] = cells[i];
            const start = i ? cells[i - 1].slice(2) : [x, y];
            events.push({ type: "shot", side, weapon: "piercing_pass", points: [[start[0], start[1], 0], [cx, cy, 0.12]] });
            explode(state, cx, cy, w.damage, w.radius, side, events, false, 0.5);
          }
          events.push({ type: "piercing", side, target: enemy, cells: cells.map(([r, c]) => ({ r, c })) });
        } else {
          explode(state, x, y, w.damage, w.radius, side, events);
          if (weapon === "piercing_shell") {
            const ob = obstacleAt(state, (now ?? Date.now() / 1e3) + Number(pts.at(-1)?.[2] || 0));
            const blocked = ob && x >= ob.x && x <= ob.x + ob.w && y >= ob.y && y <= ob.y + ob.h;
            const blast = [...events].reverse().find((e) => e.type === "explosion");
            if (blast && blocked) blast.impact_label = "\u05DE\u05DB\u05E9\u05D5\u05DC \u05D7\u05E1\u05DD";
          }
        }
        if (weapon === "emp_shell" && impact) applyEmp(state, enemy, events, now);
      } else if (x !== null) explode(state, x, y, 0, 26, side, events, true);
    } else if (weapon === "cluster_shell") {
      const ev = [];
      const [x, y, pts, off] = simulate(state, side, angle, power, weapon, ev, enemy, now, true);
      events.push({ type: "shot", side, weapon, angle, power, points: pts });
      const legacyPts = pts.filter((p, i) => i > 0 && i % 6 === 0);
      if (pts.length > 1) legacyPts.push(pts[pts.length - 1]);
      const apex = legacyPts.length ? legacyPts[Math.floor(legacyPts.length / 2)] : [x ?? 500, 150];
      for (let k = 0; k < 4; k++) {
        const sx = (x === null ? apex[0] : x) + (k - 1.5) * 38;
        const sy = y ?? GROUND_Y;
        const sub = [];
        explode(state, sx, sy, w.damage, w.radius, side, sub);
        events.push({ type: "shot", side, weapon: "cluster_mini", points: [[apex[0], apex[1], 0], [Math.round(sx * 10) / 10, Math.round(sy * 10) / 10, 0.32]] });
        events.push(...sub);
      }
    } else {
      const ev = [];
      const [x, y, pts, off] = simulate(state, side, angle, power, weapon, ev, enemy, now, true);
      events.push({ type: "shot", side, weapon, angle, power, points: pts });
      if (x !== null) {
        if (off) explode(state, x, y, 0, 26, side, ev, true);
        else explode(state, x, y, w.damage * criticalMultiplier(state, side, x, y, ev), w.radius, side, ev);
      }
      events.push(...ev);
    }
    const previousWind = state.wind;
    state.wind = Math.round((rng() * 2 - 1) * WIND_MAX * 10) / 10;
    events.push({ type: "wind", wind: state.wind, previous: previousWind });
    const t = now ?? Date.now() / 1e3;
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

  // src/game/predict.ts
  function predict(state, side, angle, power, weapon, mega, now) {
    const copy = JSON.parse(JSON.stringify(state));
    return fireWeapon(copy, side, angle, Math.min(100, power * (mega ? 1.2 : 1)), weapon, () => 0.5, now)[0].filter((e) => e.type === "shot");
  }
  return __toCommonJS(predict_exports);
})();
