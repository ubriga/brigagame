/** Match-local territory rules. Never mutate global controls or courtyard personas. */
export function applyTerritoryBotRules(state: any, rarity: number): void {
  const r = Math.max(1, Math.min(4, Math.trunc(rarity)));
  state.territory_bot_rarity = r;
  state.cooldowns = { ...state.cooldowns, shot_clock: 6 };
  state.bot_controls = { ...state.bot_controls, infinite_ammo: false };
  state.ai_profile = { ...state.ai_profile };
  if (r <= 2) {
    state.bot_controls.deep_aim = false;
    state.bot_controls.tactical_mega = false;
    state.ai_profile.mega_chance = 0;
    if (state.abilities?.p2) state.abilities.p2.mega = 0;
  }
  // One special use TOTAL at one star. No homing/cluster at this entry tier.
  state.bot_ammo = r === 1 ? { double_bomb: 0, homing_missile: 0, cluster_shell: 0 }
    : r === 2 ? { double_bomb: state.bot_controls.double_bomb === false ? 0 : 1, homing_missile: 0, cluster_shell: 0 }
    : Object.fromEntries(Object.entries(state.bot_ammo ?? {}).map(([k, n]) => [k, Math.max(0, Math.min(r, Math.trunc(Number(n) || 0)))]));
  if (r === 1) state.bot_controls.special_weapons = false;
}
