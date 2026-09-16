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


def new_tower(hp_level=0):
    mult = hp_multiplier(hp_level)
    return [[round(BLOCK_HP * mult, 1) for _ in range(TOWER_COLS)]
            for _ in range(TOWER_ROWS)]


def new_state(p1_mods, p2_mods):
    """pX_mods: {'armor': lvl, 'hp': lvl, 'skin': item_id or None}"""
    return {
        "tower_x": {"p1": random.randint(*TOWER_X_RANGE["p1"]),
                    "p2": random.randint(*TOWER_X_RANGE["p2"])},
        "towers": {
            "p1": new_tower(p1_mods.get("hp", 0)),
            "p2": new_tower(p2_mods.get("hp", 0)),
        },
        "mods": {"p1": p1_mods, "p2": p2_mods},
        "wind": round(random.uniform(-WIND_MAX, WIND_MAX), 1),
        "last_shot_at": {"p1": 0.0, "p2": 0.0},
        "damage_dealt": {"p1": 0.0, "p2": 0.0},
        "ready": {"p1": False, "p2": False},
        "started_at": time.time(),
    }


def tower_x_of(state, side):
    """Left edge of a side's tower; falls back to the legacy fixed layout
    for matches created before layouts were randomized."""
    return (state.get("tower_x") or TOWER_X)[side]


def tower_blocks(state, side):
    """Yield (row, col, cx, cy) center coordinates of every block."""
    x0 = tower_x_of(state, side)
    for r in range(TOWER_ROWS):
        for c in range(TOWER_COLS):
            cx = x0 + c * BLOCK + BLOCK / 2
            cy = GROUND_Y - (TOWER_ROWS - r) * BLOCK + BLOCK / 2
            yield r, c, cx, cy


def muzzle(state, side):
    x0 = tower_x_of(state, side)
    cx = x0 + TOWER_COLS * BLOCK / 2
    cy = GROUND_Y - TOWER_ROWS * BLOCK - 8
    return cx, cy


def tower_hp(state, side):
    """Current and max HP of one tower, for client HP bars."""
    tw = state["towers"][side]
    hp = sum(v for row in tw for v in row)
    mult = hp_multiplier(state.get("mods", {}).get(side, {}).get("hp", 0))
    return {"hp": round(hp, 1),
            "max": round(BLOCK_HP * mult * TOWER_COLS * TOWER_ROWS, 1)}


# a tower is "destroyed" when 75% of its blocks are rubble;
# requiring every last block made matches unwinnable once a channel
# was carved through the top (realistic, but bad gameplay)
DESTROY_FRACTION = 0.75


def tower_alive(tower):
    total = TOWER_COLS * TOWER_ROWS
    alive = sum(1 for row in tower for hp in row if hp > 0)
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
        for r, c, cx, cy in tower_blocks(state, enemy):
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
        for r, c, cx, cy in tower_blocks(state, attacker):
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
        # tower collision
        for s in (enemy, side):
            for r, c, cx, cy in tower_blocks(state, s):
                if state["towers"][s][r][c] > 0 and abs(x - cx) <= BLOCK / 2 \
                        and abs(y - cy) <= BLOCK / 2:
                    points.append([round(x, 1), round(y, 1)])
                    return x, y, points, False
        if x < -80 or x > WORLD_W + 80:
            cx = max(10.0, min(WORLD_W - 10.0, x))
            cy = max(40.0, min(GROUND_Y, y))
            points.append([round(cx, 1), round(cy, 1)])
            return cx, cy, points, True
    return None, None, points, True


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
                    _explode(state, x, y, w["damage"], w["radius"], side, ev)
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
                _explode(state, x, y, w["damage"], w["radius"], side, ev)
        events.extend(ev)

    # Dynamic wind: every shot re-rolls the wind, so the next shot always
    # needs a fresh read of the wind indicator. Clients get the new value
    # both in the next snapshot and as an explicit event.
    previous_wind = state["wind"]
    state["wind"] = round(random.uniform(-WIND_MAX, WIND_MAX), 1)
    events.append({"type": "wind", "wind": state["wind"],
                   "previous": previous_wind})

    state["last_shot_at"][side] = time.time()
    return events, not tower_alive(state["towers"][enemy])


def cooldown_for(weapon):
    return WEAPONS.get(weapon, WEAPONS["standard"])["cooldown"]


def ai_choose_shot(state, side="p2", difficulty="normal", rank_level=None):
    """Heuristic shot with human-like noise for the single-player bot.

    Aims at the center of the enemy's remaining tower mass (so carved gaps
    don't make the bot shell the same hole forever) and solves the ballistic
    equation for that point, then adds noise so it hits often but not always.
    """
    enemy = "p1" if side == "p2" else "p2"
    facing = 1 if side == "p1" else -1
    sx, sy = muzzle(state, side)
    blocks = [(cx, cy) for r, c, cx, cy in tower_blocks(state, enemy)
              if state["towers"][enemy][r][c] > 0]
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
    angle = 45 + random.uniform(-profile["angle_noise"], profile["angle_noise"])
    rad = math.radians(angle)
    dy = ty - sy  # positive when target is lower (y grows downward)

    # Better bots compensate for the current wind rather than turning strong
    # gusts into random misses. Medium/ranked bots learn this gradually with
    # rank; hard compensates most of it and ultra compensates fully.
    tier = state.get("ai_tier", "medium")
    if tier == "ultra":
        wind_skill = 1.0
    elif tier == "hard":
        wind_skill = 0.7
    elif difficulty == "ranked":
        wind_skill = max(0.0, min(1.0, ((int(rank_level or 1) - 1) / 17)))
    else:
        wind_skill = 0.0
    along_accel = state.get("wind", 0.0) * WIND_ACCEL * facing * wind_skill

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
