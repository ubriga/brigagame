import { validatePersona, personaToProfile } from "../dist/game/persona.js";
import { DEFAULT_GAMEPLAY_CONTROLS as C } from "../dist/game/catalog.js";
console.log(JSON.stringify(validatePersona({aggression:100,accuracy:100,boldness:100})));
console.log(JSON.stringify(validatePersona({aggression:60,accuracy:60,boldness:60})));
console.log(JSON.stringify(validatePersona({aggression:-1,accuracy:5,boldness:5})));
for (const p of [{aggression:0,accuracy:0,boldness:0},{aggression:90,accuracy:30,boldness:60},{aggression:30,accuracy:90,boldness:20}])
  console.log(JSON.stringify(p), JSON.stringify(personaToProfile(C,p)));
