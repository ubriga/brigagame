"""Server-authoritative game simulation for Brigagame 2.0 by OrelAI.

World coordinates: canvas 1000 x 560, y grows downward, ground at y=520.
Towers are block grids; every hit permanently removes HP from blocks so
towers visibly crumble. All math happens here on the server; the client
only renders trajectory points and resulting states it is given.
"""
import copy
import math
import random
import time

from economy import WEAPONS, armor_reduction, hp_multiplier

WORLD_W = 1000
WORLD_H = 560
GROUND_Y = 520
BLOCK = 26
TOWER_COLS = 4
TOWER_ROWS = 6
BLOCK_HP = 18
TOWER_X = {"p1": 140, "p2": 760}  # legacy default; matches now randomize
# Spawn ranges for the left edge of each tower. Every match rolls a fresh
# layout so no two games play the same; the ranges guarantee a gap of at
# least 276 world units between the towers, which keeps every layout
# winnable with the standard weapon's range.
TOWER_X_RANGE = {"p1": (60, 260), "p2": (640, 840)}
# Ballistics tuned so a comfortable mid-length drag at ~45 deg lands on the
# enemy tower (muzzle-to-muzzle distance is 620 world units). With gravity
# 700 and scale 10, power ~66 hits dead center at 45 deg; full power (100)
# overshoots past the far edge, so drag length stays meaningful.
GRAVITY = 700.0       # world-units / s^2
POWER_SCALE = 10.0    # power 0-100 -> initial speed
DT = 0.02
MAX_FLIGHT = 20.0
WIND_MAX = 40.0
# Horizontal acceleration per displayed wind unit. At maximum wind this
# shifts a normal 1.2-1.5s shot by roughly one tower block, so players must
# compensate without making the battlefield unwinnable.
WIND_ACCEL = 0.75
MAPS = ("valley", "desert", "highlands")


def tower_dims(tower):
    return len(tower), len(tower[0]) if tower else 0


def obstacle_at(state, at_time=None):
    """Return the obstacle at a server time. Old matches remain stationary."""
    ob = dict(state.get("obstacle") or {})
    motion = state.get("obstacle_motion") or {}
    if not ob or not motion.get("enabled"):
        return ob
    lo, hi = float(motion["min_x"]), float(motion["max_x"])
    distance = max(0.0, hi - lo)
    speed = max(1.0, float(motion.get("speed", 20)))
    dwell = max(0.0, float(motion.get("warning_seconds", 0)))
    travel = distance / speed if distance else 0.0
    leg = dwell + travel
    cycle = 2 * leg
    phase = (float(at_time if at_time is not None else time.time()) - float(motion.get("epoch", 0))) % max(0.001, cycle)
    reverse = phase >= leg
    local = phase - leg if reverse else phase
    warning = local < dwell
    progress = 0.0 if warning or travel == 0 else min(1.0, (local - dwell) / travel)
    x = (hi - progress * distance) if reverse else (lo + progress * distance)
    ob.update({"x": round(x, 2), "moving": not warning and distance > 0,
               "warning": warning, "direction": -1 if reverse else 1,
               "motion": {"enabled": True, "min_x": lo, "max_x": hi,
                          "speed": speed, "warning_seconds": dwell,
                          "epoch": float(motion.get("epoch", 0))}})
    return ob


def expanded_dims(extra_cubes):
    # Add full-height side strips first. Every cube increases area/HP, and each
    # completed strip makes the silhouette wider and easier to hit.
    extra = max(0, int(extra_cubes or 0))
    cols = TOWER_COLS + extra // TOWER_ROWS
    rem = extra % TOWER_ROWS
    return TOWER_ROWS, cols, rem


def new_tower(hp_level=0, extra_cubes=0, cube_hp=BLOCK_HP):
    mult = hp_multiplier(hp_level)
    rows, cols, rem = expanded_dims(extra_cubes)
    base_hp = round(BLOCK_HP * mult, 1)
    tower = [[base_hp for _ in range(cols)] for _ in range(rows)]
    full_extra_cols = max(0, cols - TOWER_COLS)
    for r in range(rows):
        for c in range(full_extra_cols): tower[r][c] = round(float(cube_hp) * mult, 1)
    if rem:
        tower = [[None] + row for row in tower]
        for r in range(rows - rem, rows): tower[r][0] = round(float(cube_hp) * mult, 1)
    return tower


def new_state(p1_mods, p2_mods):
    """Create a complete server-authoritative battlefield."""
    p1_cols = expanded_dims(p1_mods.get("extra_cubes", 0))[1] + (1 if int(p1_mods.get("extra_cubes", 0) or 0) % TOWER_ROWS else 0)
    p2_cols = expanded_dims(p2_mods.get("extra_cubes", 0))[1] + (1 if int(p2_mods.get("extra_cubes", 0) or 0) % TOWER_ROWS else 0)
    p1x = random.randint(TOWER_X_RANGE["p1"][0],
                         min(TOWER_X_RANGE["p1"][1], 420 - p1_cols * BLOCK))
    p2x = random.randint(max(TOWER_X_RANGE["p2"][0],
                             580 + (p2_cols - TOWER_COLS) * BLOCK),
                         min(TOWER_X_RANGE["p2"][1], WORLD_W - 40 - p2_cols * BLOCK))
    gap_start, gap_end = p1x + p1_cols * BLOCK + 60, p2x - 128
    obstacle_x = random.randint(int(gap_start), int(max(gap_start, gap_end)))
    dyn = p1_mods.get("dynamic_obstacle") or {}
    obstacle_enabled = bool(dyn.get("enabled"))
    obstacle_epoch = time.time()
    return {
        "tower_x": {"p1": p1x, "p2": p2x},
        "map": random.choice(MAPS),
        "obstacle": {"x": obstacle_x, "y": GROUND_Y - 105, "w": 68, "h": 105},
        "obstacle_motion": {"enabled": obstacle_enabled,
            "min_x": float(gap_start), "max_x": float(max(gap_start, gap_end)),
            "speed": float(dyn.get("speed", 20)),
            "warning_seconds": float(dyn.get("warning_seconds", 1.5)),
            "epoch": obstacle_epoch},
        "towers": {
            "p1": new_tower(p1_mods.get("hp", 0), p1_mods.get("extra_cubes", 0), p1_mods.get("expansion_cube_hp", BLOCK_HP)),
            "p2": new_tower(p2_mods.get("hp", 0), p2_mods.get("extra_cubes", 0), p2_mods.get("expansion_cube_hp", BLOCK_HP)),
        },
        "mods": {"p1": p1_mods, "p2": p2_mods},
        "tower_max_hp": {
            "p1": round((TOWER_COLS*TOWER_ROWS*BLOCK_HP + int(p1_mods.get("extra_cubes",0) or 0)*float(p1_mods.get("expansion_cube_hp",BLOCK_HP))) * hp_multiplier(p1_mods.get("hp",0)), 1),
            "p2": round((TOWER_COLS*TOWER_ROWS*BLOCK_HP + int(p2_mods.get("extra_cubes",0) or 0)*float(p2_mods.get("expansion_cube_hp",BLOCK_HP))) * hp_multiplier(p2_mods.get("hp",0)), 1)},
        "wind": round(random.uniform(-WIND_MAX, WIND_MAX), 1),
        "last_shot_at": {"p1": 0.0, "p2": 0.0},
        "damage_dealt": {"p1": 0.0, "p2": 0.0},
        "coatings": {"p1": p1_mods.get("coating"), "p2": p2_mods.get("coating")},
        "ready": {"p1": False, "p2": False},
        "started_at": time.time(),
        "sudden_death": False,
        "last_turn_at": {"p1": time.time(), "p2": time.time()},
        "moves_left": {"p1": 1, "p2": 1},
        "abilities": {"p1": {"shield": 1, "mega": 1}, "p2": {"shield": 1, "mega": 1}},
        "shield": {"p1": False, "p2": False},
        "shot_count": 0,
    }


def tower_x_of(state, side):
    """Left edge of a side's tower; falls back to the legacy fixed layout
    for matches created before layouts were randomized."""
    return (state.get("tower_x") or TOWER_X)[side]


def tower_blocks(state, side):
    """Yield (row, col, cx, cy) center coordinates of every block."""
    x0 = tower_x_of(state, side)
    rows, cols = tower_dims(state["towers"][side])
    for r in range(rows):
        for c in range(cols):
            cx = x0 + c * BLOCK + BLOCK / 2
            cy = GROUND_Y - (rows - r) * BLOCK + BLOCK / 2
            yield r, c, cx, cy


def muzzle(state, side):
    x0 = tower_x_of(state, side)
    rows, cols = tower_dims(state["towers"][side])
    cx = x0 + cols * BLOCK / 2
    cy = GROUND_Y - rows * BLOCK - 8
    return cx, cy


def tower_hp(state, side):
    """Current and max HP of one tower, for client HP bars."""
    tw = state["towers"][side]
    hp = sum(v for row in tw for v in row if v is not None)
    mult = hp_multiplier(state.get("mods", {}).get(side, {}).get("hp", 0))
    max_blocks = sum(1 for row in tw for v in row if v is not None)
    fallback = round(BLOCK_HP * mult * max_blocks, 1)
    return {"hp": round(hp, 1), "max": (state.get("tower_max_hp") or {}).get(side, fallback)}


# a tower is "destroyed" when 75% of its blocks are rubble;
# requiring every last block made matches unwinnable once a channel
# was carved through the top (realistic, but bad gameplay)
DESTROY_FRACTION = 0.75


def tower_alive(tower):
    total = sum(1 for row in tower for hp in row if hp is not None)
    alive = sum(1 for row in tower for hp in row if hp is not None and hp > 0)
    return alive > total * (1.0 - DESTROY_FRACTION)


def _explode(state, x, y, damage, radius, attacker, events, cosmetic=False):
    """Apply blast damage to both towers; returns total damage dealt to enemy.

    cosmetic=True marks a no-damage visual puff (shot left the world), so the
    client still shows where the shell ended up instead of vanishing silently.
    """
    enemy = "p2" if attacker == "p1" else "p1"
    dealt = 0.0
    destroyed = []
    if not cosmetic:
        armor_lvl = state["mods"][enemy].get("armor", 0)
        mult = armor_reduction(armor_lvl)
        coating = state.get("coatings", {}).get(enemy)
        if coating and coating.get("hp", 0) > 0:
            # The coating is a separate server-owned layer. It absorbs blast
            # energy before structural blocks; wood always breaks on first hit.
            incoming = max(0.0, damage * mult)
            absorbed = min(float(coating["hp"]), incoming)
            if coating.get("material") == "wood" and incoming > 0:
                coating["hp"] = 0.0
            else:
                coating["hp"] = round(max(0.0, float(coating["hp"]) - absorbed), 1)
            mult *= max(0.0, 1.0 - absorbed / incoming) if incoming else 0.0
            events.append({"type": "coating_hit", "side": enemy,
                           "material": coating.get("material"),
                           "absorbed": round(absorbed, 1),
                           "hp": coating["hp"], "broken": coating["hp"] <= 0})
        if state.get("shield", {}).get(enemy):
            mult *= 0.4
            state["shield"][enemy] = False
            events.append({"type": "shield", "side": enemy, "active": False})
        if state.get("sudden_death"):
            mult *= 2.0
        for r, c, cx, cy in tower_blocks(state, enemy):
            hp = state["towers"][enemy][r][c]
            if hp is None or hp <= 0:
                continue
            dist = math.hypot(cx - x, cy - y)
            if dist <= radius:
                dmg = damage * (1.0 - dist / radius) * mult
                if dmg <= 0:
                    continue
                new_hp = round(hp - dmg, 1)
                dealt += min(hp, dmg)
                state["towers"][enemy][r][c] = max(0.0, new_hp)
                if new_hp <= 0:
                    destroyed.append({"r": r, "c": c})
        # small splash to own tower keeps shots honest but is heavily reduced
        for r, c, cx, cy in tower_blocks(state, attacker):
            hp = state["towers"][attacker][r][c]
            if hp is None or hp <= 0:
                continue
            dist = math.hypot(cx - x, cy - y)
            if dist <= radius * 0.7:
                dmg = damage * 0.3 * (1.0 - dist / (radius * 0.7))
                if dmg > 0:
                    state["towers"][attacker][r][c] = max(0.0, round(hp - dmg, 1))
        state["damage_dealt"][attacker] = round(
            state["damage_dealt"][attacker] + dealt, 1)
        # structural collapse: a block with nothing below it crumbles,
        # cascading down each column (undermining a tower works)
        collapsed = []
        for side in (enemy, attacker):
            tw = state["towers"][side]
            changed = True
            while changed:
                changed = False
                rows, cols = tower_dims(tw)
                for c in range(cols):
                    for r in range(rows - 1):  # not the ground row
                        if tw[r][c] is not None and tw[r][c] > 0 and tw[r + 1][c] is not None and tw[r + 1][c] <= 0:
                            tw[r][c] = 0.0
                            collapsed.append({"side": side, "r": r, "c": c})
                            changed = True
        if collapsed:
            events.append({"type": "collapse", "blocks": collapsed})
    events.append({"type": "explosion", "x": round(x, 1), "y": round(y, 1),
                   "radius": radius, "destroyed": destroyed,
                   "damage": round(dealt, 1), "attacker": attacker,
                   "target": enemy, "cosmetic": cosmetic})
    return dealt


def _simulate(state, side, angle_deg, power, weapon, events, target_side=None):
    """Simulate one projectile.

    Returns (x, y, points, flew_off). Impact point is None only when the
    shell left the world; in that case x/y are the clamped exit point so the
    caller can still emit a visual puff there.
    """
    enemy = "p2" if side == "p1" else "p1"
    facing = 1 if side == "p1" else -1
    angle = math.radians(angle_deg)
    speed = power * POWER_SCALE
    x, y = muzzle(state, side)
    vx = facing * speed * math.cos(angle)
    vy = -speed * math.sin(angle)
    w = WEAPONS[weapon]
    points = []
    t = 0.0
    homing = weapon == "homing_missile"
    ex, ey = muzzle(state, enemy)
    step = 0
    while t < MAX_FLIGHT:
        t += DT
        step += 1
        vx += state["wind"] * WIND_ACCEL * DT
        vy += GRAVITY * DT
        if homing:
            # gentle steering toward enemy muzzle
            dx, dy = ex - x, ey - y
            d = math.hypot(dx, dy) or 1.0
            steer = 90.0
            vx += dx / d * steer * DT
            vy += dy / d * steer * DT
        x += vx * DT
        y += vy * DT
        if step % 6 == 0:
            points.append([round(x, 1), round(y, 1)])
        if y >= GROUND_Y:
            points.append([round(x, 1), GROUND_Y])
            return x, GROUND_Y, points, False
        # Random mid-field obstacle changes the viable firing arcs.
        ob = obstacle_at(state, time.time() + t)
        if ob and ob.get("x", 0) <= x <= ob.get("x", 0) + ob.get("w", 0) and ob.get("y", 0) <= y <= GROUND_Y:
            points.append([round(x, 1), round(y, 1)])
            return x, y, points, False
        # tower collision
        for s in (enemy, side):
            for r, c, cx, cy in tower_blocks(state, s):
                if state["towers"][s][r][c] is not None and state["towers"][s][r][c] > 0 and abs(x - cx) <= BLOCK / 2 \
                        and abs(y - cy) <= BLOCK / 2:
                    points.append([round(x, 1), round(y, 1)])
                    return x, y, points, False
        if x < -80 or x > WORLD_W + 80:
            cx = max(10.0, min(WORLD_W - 10.0, x))
            cy = max(40.0, min(GROUND_Y, y))
            points.append([round(cx, 1), round(cy, 1)])
            return cx, cy, points, True
    return None, None, points, True


def _critical_multiplier(state, attacker, x, y, events):
    """A direct hit on the enemy cannon barrel is a server-verified critical."""
    enemy = "p2" if attacker == "p1" else "p1"
    mx, my = muzzle(state, enemy)
    if math.hypot(x - mx, y - my) <= 24:
        events.append({"type": "critical", "side": attacker, "target": enemy})
        return 2.5
    return 1.0


def fire_weapon(state, side, angle, power, weapon):
    """Validate is done by the caller; here we mutate state and build events.

    Returns (events, destroyed_enemy: bool)."""
    angle = max(0.0, min(90.0, float(angle)))
    power = max(5.0, min(100.0, float(power)))
    enemy = "p2" if side == "p1" else "p1"
    events = []
    w = WEAPONS.get(weapon, WEAPONS["standard"])

    if weapon == "double_bomb":
        for i, p in enumerate((power, power * 0.85)):
            ev = []
            x, y, pts, off = _simulate(state, side, angle + i * 6, p,
                                       "standard", ev, enemy)
            events.append({"type": "shot", "side": side, "weapon": weapon,
                           "angle": angle + i * 6, "power": p,
                           "points": pts})
            if x is not None:
                if off:
                    _explode(state, x, y, 0, 26, side, ev, cosmetic=True)
                else:
                    _explode(state, x, y, w["damage"] * _critical_multiplier(state, side, x, y, ev), w["radius"], side, ev)
            events.extend(ev)
    elif weapon == "cluster_shell":
        ev = []
        x, y, pts, off = _simulate(state, side, angle, power, weapon, ev, enemy)
        events.append({"type": "shot", "side": side, "weapon": weapon,
                       "angle": angle, "power": power, "points": pts})
        apex = pts[len(pts) // 2] if pts else [x or 500, 150]
        for k in range(4):
            sx = (apex[0] if x is None else x) + (k - 1.5) * 38
            sy = y if y is not None else GROUND_Y
            sub = []
            _explode(state, sx, sy, w["damage"], w["radius"], side, sub)
            events.append({"type": "shot", "side": side, "weapon": "cluster_mini",
                           "points": [[apex[0], apex[1]], [round(sx, 1), round(sy, 1)]]})
            events.extend(sub)
    else:
        ev = []
        x, y, pts, off = _simulate(state, side, angle, power, weapon, ev, enemy)
        events.append({"type": "shot", "side": side, "weapon": weapon,
                       "angle": angle, "power": power, "points": pts})
        if x is not None:
            if off:
                _explode(state, x, y, 0, 26, side, ev, cosmetic=True)
            else:
                _explode(state, x, y, w["damage"] * _critical_multiplier(state, side, x, y, ev), w["radius"], side, ev)
        events.extend(ev)

    # Dynamic wind: every shot re-rolls the wind, so the next shot always
    # needs a fresh read of the wind indicator. Clients get the new value
    # both in the next snapshot and as an explicit event.
    previous_wind = state["wind"]
    state["wind"] = round(random.uniform(-WIND_MAX, WIND_MAX), 1)
    events.append({"type": "wind", "wind": state["wind"],
                   "previous": previous_wind})

    state["last_shot_at"][side] = time.time()
    state.setdefault("last_turn_at", {})[side] = time.time()
    state["shot_count"] = int(state.get("shot_count", 0)) + 1
    # Bounded random events, rolled authoritatively after every third shot.
    if state["shot_count"] % 3 == 0:
        kind = random.choice(("gust", "meteor", "charge"))
        if kind == "gust":
            state["wind"] = round(random.choice((-1, 1)) * WIND_MAX, 1)
        elif kind == "meteor":
            mx = random.randint(360, 640)
            _explode(state, mx, GROUND_Y, 10, 48, side, events)
        else:
            state.setdefault("abilities", {}).setdefault(side, {}).setdefault("mega", 0)
            state["abilities"][side]["mega"] += 1
        events.append({"type": "random_event", "kind": kind})
    return events, not tower_alive(state["towers"][enemy])


def cooldown_for(weapon):
    return WEAPONS.get(weapon, WEAPONS["standard"])["cooldown"]



def _aim_candidates(state, enemy):
    """Base-row aimpoints: the lowest live block of every tower column.

    Hitting the base undermines the whole column (unsupported blocks
    crumble) and a low impact point maximizes blast overlap with the
    structure, so these beat the raw center of mass as aimpoints.
    """
    by_col = {}
    for r, c, cx, cy in tower_blocks(state, enemy):
        hp = state["towers"][enemy][r][c]
        if hp is not None and hp > 0:
            by_col.setdefault(c, []).append((r, cx, cy))
    out = []
    for c, lst in by_col.items():
        r, cx, cy = max(lst)  # largest row index = lowest block = base row
        out.append((cx, cy))
    return out


def _expected_damage(state, side, x, y, ignore_coating=False):
    """Simulated structural damage of a standard blast at (x, y).

    Runs the real _explode mechanics on a throwaway copy so armor, coating
    absorption, shield and distance falloff all count exactly as they would
    in a live shot. Coating-aware by default; ignore_coating=True gives the
    pre-absorption overlap used as a tie-breaker (wearing a coating down
    still matters when every hit is absorbed).
    """
    st = copy.deepcopy(state)
    if ignore_coating:
        st["coatings"] = {s: None for s in ("p1", "p2")}
    w = WEAPONS["standard"]
    return _explode(st, x, y, w["damage"], w["radius"], side, [])


def ai_choose_shot(state, side="p2", difficulty="normal", rank_level=None, profile_override=None):
    """Heuristic shot with human-like noise for the single-player bot.

    Aims at the center of the enemy's remaining tower mass (so carved gaps
    don't make the bot shell the same hole forever) and solves the ballistic
    equation for that point, then adds noise so it hits often but not always.
    """
    enemy = "p1" if side == "p2" else "p2"
    facing = 1 if side == "p1" else -1
    sx, sy = muzzle(state, side)
    blocks = [(cx, cy) for r, c, cx, cy in tower_blocks(state, enemy)
              if state["towers"][enemy][r][c] is not None and state["towers"][enemy][r][c] > 0]
    if blocks:
        tx = sum(b[0] for b in blocks) / len(blocks)
        ty = sum(b[1] for b in blocks) / len(blocks)
    else:
        tx, ty = muzzle(state, enemy)
    dist = max(60.0, abs(tx - sx))
    profiles = {
        "easy": {"angle_noise": 20, "power_min": 0.72, "power_max": 1.28},
        "normal": {"angle_noise": 13, "power_min": 0.82, "power_max": 1.20},
        "hard": {"angle_noise": 6, "power_min": 0.93, "power_max": 1.08},
    }
    if difficulty == "ranked":
        # The 18 bot ranks form a real expertise ladder. Rank 1 is forgiving
        # but still stronger than unranked practice; rank 18 is the sharpest.
        lvl = max(1, min(18, int(rank_level or 1)))
        t = (lvl - 1) / 17
        profile = {
            "angle_noise": 16 - 12.5 * t,
            "power_min": 0.80 + 0.16 * t,
            "power_max": 1.22 - 0.18 * t,
        }
    else:
        profile = profiles.get(difficulty, profiles["normal"])
    override = profile_override or state.get("ai_profile") or {}
    if override:
        spread = max(0.0, min(0.5, float(override.get("power_spread", 0.1))))
        profile = {"angle_noise": max(0.0, min(45.0, float(override.get("angle_noise", profile["angle_noise"])))),
                   "power_min": 1.0 - spread, "power_max": 1.0 + spread}
    # Better bots compensate for the current wind rather than turning strong
    # gusts into random misses. Medium/ranked bots learn this gradually with
    # rank; hard compensates most of it and ultra compensates fully.
    tier = state.get("ai_tier", "medium")
    if override:
        wind_skill = max(0.0, min(1.0, float(override.get("wind_skill", 0.0))))
    elif tier == "expert":
        wind_skill = 1.0
        profile = {"angle_noise": 0.8, "power_min": 0.995, "power_max": 1.005}
    elif tier == "ultra":
        wind_skill = 1.0
    elif tier == "hard":
        wind_skill = 0.7
    elif difficulty == "ranked":
        wind_skill = max(0.0, min(1.0, ((int(rank_level or 1) - 1) / 17)))
    else:
        wind_skill = 0.0
    along_accel = state.get("wind", 0.0) * WIND_ACCEL * facing * wind_skill

    # Deep aim (admin-tunable via bot_system.deep_aim): instead of the raw
    # center of mass, pick the aimpoint with the best simulated blast
    # overlap among every column's base-row block (plus the center of mass
    # as a fallback candidate). Structural damage is measured after coating
    # absorption; pre-absorption overlap breaks ties so coated targets still
    # get the most direct hit available.
    if blocks and (state.get("bot_controls") or {}).get("deep_aim", True):
        candidates = _aim_candidates(state, enemy)
        candidates.append((tx, ty))
        best_score, best_target = None, (tx, ty)
        rad0 = math.radians(45.0)
        tan0 = math.tan(rad0)
        cos0 = math.cos(rad0)
        for cx, cy in candidates:
            dist_c = max(60.0, abs(cx - sx))
            dy_c = cy - sy
            t2n = 2 * (dy_c + dist_c * tan0)
            t2d = GRAVITY + along_accel * tan0
            ft = math.sqrt(max(0.01, t2n / max(1.0, t2d)))
            v0 = (dist_c - 0.5 * along_accel * ft * ft) / max(0.05, cos0 * ft)
            p0 = min(96.0, max(30.0, v0 / POWER_SCALE))
            ev = []
            ix, iy, _pts, _off = _simulate(state, side, 45.0, p0, "standard", ev)
            if ix is None:
                continue
            dealt = _expected_damage(state, side, ix, iy)
            raw = _expected_damage(state, side, ix, iy, ignore_coating=True)
            score = (round(dealt, 1), round(raw, 1), round(cy, 1))
            if best_score is None or score > best_score:
                best_score, best_target = score, (cx, cy)
        tx, ty = best_target
        dist = max(60.0, abs(tx - sx))

    angle = 45 + random.uniform(-profile["angle_noise"], profile["angle_noise"])
    rad = math.radians(angle)
    dy = ty - sy  # positive when target is lower (y grows downward)

    # Closed-form ballistic solution with constant horizontal acceleration.
    # In coordinates facing the enemy: dist = v*cos(a)*t + .5*A*t^2.
    tan_a = math.tan(rad)
    t2_num = 2 * (dy + dist * tan_a)
    t2_den = GRAVITY + along_accel * tan_a
    flight_t = math.sqrt(max(0.01, t2_num / max(1.0, t2_den)))
    v = (dist - 0.5 * along_accel * flight_t * flight_t) / \
        max(0.05, math.cos(rad) * flight_t)
    power = v / POWER_SCALE * random.uniform(profile["power_min"], profile["power_max"])
    power = min(96.0, max(30.0, power))
    weapon = "standard"
    return angle, power, weapon
