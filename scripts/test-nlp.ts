// NL command regression test: npx tsx scripts/test-nlp.ts
import { parseCommand } from "../src/lib/nlp";
const n = new Date(2026, 9, 14, 12);
const cases: [string, string, string?][] = [
  ["log 8,500 steps", "health_logs"], ["glucose 112", "health_logs"], ["add med metformin 500 mg at 8am", "meds"],
  ["add milk to shopping list", "shop_items"], ["add lego set to wish list", "shop_items"], ["buy batteries", "shop_items"],
  ["bill: water $45.20 due friday", "bills"], ["track 10 shares of msft", "stocks"], ["credit score is 742", "credit_scores"],
  ["email: reply to coach friday", "comms_notes"], ["check-in: math unit 3 review", "edu_checkins"],
  ["remind me friday to pay the water bill", "create_task"], ["open bells", "open_app"],
];
let fail = 0;
for (const [s, want] of cases) { const r = parseCommand(s, n); const got = r ? (r.kind === "create_item" ? r.table : r.kind) : "null"; if (got !== want) { fail++; console.error(`FAIL ${s}: ${got} != ${want}`); } }
console.log(`${cases.length - fail}/${cases.length} NL cases pass`); if (fail) process.exit(1);
