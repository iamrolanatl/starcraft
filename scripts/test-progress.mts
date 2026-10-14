import { kidMsg, gapText } from "../src/lib/progress";
let f = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = a === b; if (!ok) f++; console.log(`${ok ? "PASS" : "FAIL"} ${n}: ${a}`); };
eq("80", kidMsg(80), "Your grade is 80. You're only 10 points from 90!");
eq("89", kidMsg(89), "Your grade is 89. You're only 1 point from 90!");
eq("76.8", kidMsg(76.8), "Your grade is 76.8. You're only 13.2 points from 90!");
eq("94", kidMsg(94), "You hit your 90% goal! Keep it up!");
eq("gap", gapText(84), "6 pts to 90%"); eq("met", gapText(90), "GOAL MET ✓");
process.exit(f ? 1 : 0);
