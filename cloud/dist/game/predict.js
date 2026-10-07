import { fireWeapon } from "./game_logic.js";
export function predict(state, side, angle, power, weapon, mega, now) {
    const copy = JSON.parse(JSON.stringify(state));
    return fireWeapon(copy, side, angle, Math.min(100, power * (mega ? 1.2 : 1)), weapon, () => 0.5, now)[0].filter(e => e.type === "shot");
}
//# sourceMappingURL=predict.js.map