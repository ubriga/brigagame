# Brigagame 2.0 - Coin Economy Research & Design

Goal (from the owner): coins come from wins, hits and a daily login bonus.
Before choosing numbers we surveyed comparable artillery games, then designed
sources and sinks that keep progression satisfying without any real-money
purchases (everything in the game is free).

## Market survey

### ShellShock Live (web/Steam artillery)
Source: https://shellshocklive-2.fandom.com/wiki/Store
- Soft currency ("Tank Coins") buys: weapon packs (80 coins for 10 weapons),
  map packs (30 coins), tank skins (20 coins), power-ups (3 coins each),
  upgrade tokens (10/25/80 coins for 1/3/10 skill points).
- Pattern: cheap consumables (single-digit coins), mid-tier cosmetics (~20),
  chunky content unlocks (80-120). Players always have something in reach.

### Tank Stars (mobile artillery)
Sources: https://plrun.com/action/tank-stars/ ,
https://www.bluestacks.com/blog/game-guides/tank-stars/ts-tips-tricks-en.html ,
https://play.google.com/store/apps/details?id=com.playgendary.tanks
- Coins from winning battles + chests; tanks unlock at ~1,000 coins (Frost)
  and up; upgrades gated behind repeated play (cards + gold).
- A free chest every 30 minutes and daily-tournament rewards drive return visits.
- Pattern: a meaningful unlock costs several days of casual play; small free
  drips (timer chest, daily rewards) build a daily habit.

### Economy design principles
Source: https://solana.garden/guides/game-economy-design-explained/
- Every source needs a sink; daily login gold with nothing to buy inflates the
  currency and kills motivation.
- Rewards per match should feel meaningful relative to match length.
- Avoid pay-to-win in PvP; sell convenience/cosmetics. In Brigagame there is
  no payment at all, so balance matters even more: coins are earned only.

## Brigagame 2.0 numbers (implemented in backend/economy.py)

### Sources
| Source | Amount | Notes |
|---|---|---|
| Welcome grant | 200 | lets a new player immediately try one item |
| Win | 100 | ~1 consumable pack per win |
| Loss | 20 | never feels punished for playing |
| Damage dealt | 1 coin / 10 damage, cap 40/match | rewards hits, anti-farm cap |
| Daily login | 50, +10 per streak day, cap 150 | habit loop (Tank Stars pattern) |

A casual day (login + 3 games, 1-2 wins) yields roughly 250-400 coins.

### Sinks
| Item | Type | Price |
|---|---|---|
| Double Bomb (3 shots) | consumable | 90 |
| Homing Missile (3 shots) | consumable | 150 |
| Cluster Shell (3 shots) | consumable | 180 |
| Armor L1-L5 | upgrade | 200 / 400 / 800 / 1400 / 2200 |
| Reinforced Tower L1-L5 | upgrade | 200 / 400 / 800 / 1400 / 2200 |
| Skins (3 standard) | cosmetic | 250 |
| Gold skin | cosmetic | 600 |

### Balance reasoning
- Consumable pack = about one win, mirroring ShellShock's cheap power-ups.
  Consumables are recurring sinks, which keeps demand for coins alive.
- First upgrade = ~2 wins; full upgrade track = 4,800 coins ≈ 2-3 weeks of
  casual play (Tank Stars-style long goal).
- Skins at 250 (~1 day) and 600 (~2-3 days) are pure cosmetics - no power is
  sold, upgrades are mild (4%/level armor, 10%/level HP, capped at 5) so
  veterans never become untouchable.
- Upgrades come from coins only, which are earned only - so time, not money,
  drives power, and nothing purchasable decides a match by itself.

### Anti-abuse
- Hit coins capped per match to stop stalling/farming.
- All coin math server-side; client cannot inject amounts (see README security).
- Rate limits on fire/store/auth endpoints.
- Daily bonus is once per UTC day, streak resets on a gap.
