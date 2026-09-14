"""Server-authoritative game simulation for Brigagame 2.0 by OrelAI.

World coordinates: canvas 1000 x 560, y grows downward, ground at y=520.
Towers are block grids; every hit permanently removes HP from blocks so
towers visibly crumble. All math happens here on the server; the client
only renders trajectory points and resulting states it is given.
"""
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
BLOCK_HP = 15
TOWER_X = {"p1": 140, "p2": 760}  # left edge of each tower
GRAVITY = 260.0       # world-units / s^2
POWER_SCALE = 6.2     # power 0-100 -> initial speed
DT = 0.02
MAX_FLIGHT = 20.0
WIND_MAX = 40.0


def new_tower(hp_level=0):
    mult = hp_multiplier(hp_level)
    return [[round(BLOCK_HP * mult, 1) for _ in range(TOWER_COLS)]
            for _ in range(TOWER_ROWS)]


def new_state(p1_mods, p2_mods):
    """pX_mods: {'armor': lvl, 'hp': lvl, 'skin': item_id or None}"""
    return {
        "towers": {
            "p1": new_tower(p1_mods.get("hp", 0)),
            "p2": new_tower(p2_mods.get("hp", 0)),
        },
        "mods": {"p1": p1_mods, "p2": p2_mods},
        "wind": round(random.uniform(-WIND_MAX, WIND_MAX), 1),
        "last_shot_at": {"p1": 0.0, "p2": 0.0},
        "damage_dealt": {"p1": 0.0, "p2": 0.0},
        "started_at": time.time(),
    }


def tower_blocks(side):
    """Yield (row, col, cx, cy) center coordinates of every block."""
    x0 = TOWER_X[side]
    for r in range(TOWER_ROWS):
        for c in range(TOWER_COLS):
            cx = x0 + c * BLOCK + BLOCK / 2
            cy = GROUND_Y - (TOWER_ROWS - r) * BLOCK + BLOCK / 2
            yield r, c, cx, cy


def muzzle(side):
    x0 = TOWER_X[side]
    cx = x0 + TOWER_COLS * BLOCK / 2
    cy = GROUND_Y - TOWER_ROWS * BLOCK - 8
    return cx, cy


# a tower is "destroyed" when 75% of its blocks are rubble;
# requiring every last block made matches unwinnable once a channel
# was carved through the top (realistic, but bad gameplay)
DESTROY_FRACTION = 0.75


def tower_alive(tower):
    total = TOWER_COLS * TOWER_ROWS
    alive = sum(1 for row in tower for hp in row if hp > 0)
    return alive > total * (1.0 - DESTROY_FRACTION)


def _explode(state, x, y, damage, radius, attacker, events):
    """Apply blast damage to both towers; returns total damage dealt to enemy."""
    enemy = "p2" if attacker == "p1" else "p1"
    dealt = 0.0
    destroyed = []
    armor_lvl = state["mods"][enemy].get("armor", 0)
    mult = armor_reduction(armor_lvl)
    for r, c, cx, cy in tower_blocks(enemy):
        hp = state["towers"][enemy][r][c]
        if hp <= 0:
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
    for r, c, cx, cy in tower_blocks(attacker):
        hp = state["towers"][attacker][r][c]
        if hp <= 0:
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
            for c in range(TOWER_COLS):
                for r in range(TOWER_ROWS - 1):  # not the ground row
                    if tw[r][c] > 0 and tw[r + 1][c] <= 0:
                        tw[r][c] = 0.0
                        collapsed.append({"side": side, "r": r, "c": c})
                        changed = True
    if collapsed:
        events.append({"type": "collapse", "blocks": collapsed})
    events.append({"type": "explosion", "x": round(x, 1), "y": round(y, 1),
                   "radius": radius, "destroyed": destroyed})
    return dealt


def _simulate(state, side, angle_deg, power, weapon, events, target_side=None):
    """Simulate one projectile. Returns impact point or None."""
    enemy = "p2" if side == "p1" else "p1"
    facing = 1 if side == "p1" else -1
    angle = math.radians(angle_deg)
    speed = power * POWER_SCALE
    x, y = muzzle(side)
    vx = facing * speed * math.cos(angle)
    vy = -speed * math.sin(angle)
    w = WEAPONS[weapon]
    points = []
    t = 0.0
    homing = weapon == "homing_missile"
    ex, ey = muzzle(enemy)
    step = 0
    while t < MAX_FLIGHT:
        t += DT
        step += 1
        vx += state["wind"] * 0.15 * DT
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
            return x, GROUND_Y, points
        # tower collision
        for s in (enemy, side):
            for r, c, cx, cy in tower_blocks(s):
                if state["towers"][s][r][c] > 0 and abs(x - cx) <= BLOCK / 2 \
                        and abs(y - cy) <= BLOCK / 2:
                    points.append([round(x, 1), round(y, 1)])
                    return x, y, points
        if x < -80 or x > WORLD_W + 80:
            points.append([round(x, 1), round(y, 1)])
            return None, None, points  # flew off; no damage
    return None, None, points


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
            x, y, pts = _simulate(state, side, angle + i * 6, p, "standard",
                                  ev, enemy)
            events.append({"type": "shot", "side": side, "weapon": weapon,
                           "angle": angle + i * 6, "power": p,
                           "points": pts})
            if x is not None:
                _explode(state, x, y, w["damage"], w["radius"], side, ev)
            events.extend(ev)
    elif weapon == "cluster_shell":
        ev = []
        x, y, pts = _simulate(state, side, angle, power, weapon, ev, enemy)
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
        x, y, pts = _simulate(state, side, angle, power, weapon, ev, enemy)
        events.append({"type": "shot", "side": side, "weapon": weapon,
                       "angle": angle, "power": power, "points": pts})
        if x is not None:
            _explode(state, x, y, w["damage"], w["radius"], side, ev)
        events.extend(ev)

    state["last_shot_at"][side] = time.time()
    return events, not tower_alive(state["towers"][enemy])


def cooldown_for(weapon):
    return WEAPONS.get(weapon, WEAPONS["standard"])["cooldown"]


def ai_choose_shot(state, side="p2"):
    """Heuristic shot with human-like noise for the single-player bot."""
    enemy = "p1" if side == "p2" else "p2"
    sx, sy = muzzle(side)
    tx, ty = muzzle(enemy)
    dist = abs(tx - sx)
    base_angle = 45 + random.uniform(-14, 14)
    base_power = min(95.0, max(30.0, dist / 9.0 + 18 + random.uniform(-9, 9)))
    weapon = "standard"
    return base_angle, base_power, weapon
