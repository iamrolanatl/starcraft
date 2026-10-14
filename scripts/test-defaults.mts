import { DEFAULTS, upgradeDefaults } from "../src/lib/settings";
let f = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) f++; console.log(`${ok ? "PASS" : "FAIL"} ${n}: ${JSON.stringify(a)}`); };
eq("new defaults", [DEFAULTS.bgSpeed, DEFAULTS.uiMotion], [0.5, "reduced"]);
const m = (s: object) => ({ ...DEFAULTS, ...upgradeDefaults(s) });
eq("old untouched → new", [m({ bgSpeed: 1, uiMotion: "system" }).bgSpeed, m({ bgSpeed: 1, uiMotion: "system" }).uiMotion], [0.5, "reduced"]);
eq("explicit kept", [m({ bgSpeed: 1.5, uiMotion: "full" }).bgSpeed, m({ bgSpeed: 1.5, uiMotion: "full" }).uiMotion], [1.5, "full"]);
eq("v2 respected", m({ dv: 2, bgSpeed: 1, uiMotion: "system" }).bgSpeed, 1);
process.exit(f ? 1 : 0);
