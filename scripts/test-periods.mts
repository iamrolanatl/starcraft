import { periods, span, schoolDays } from "../src/lib/periods";
let fail = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}: ${JSON.stringify(a)}`); };
const p = periods({ name: "Progress Period 2", start: "2026-09-03", end: "2026-11-11" }), T = "2026-10-14";
eq("Q2 dates (ParentVUE)", [p.quarters[1].start, p.quarters[1].end], ["2026-10-12", "2026-12-18"]);
eq("S1 derived", [p.semesters[0].start, p.semesters[0].end], ["2026-08-03", "2026-12-18"]);
eq("S2 derived", [p.semesters[1].start, p.semesters[1].end], ["2027-01-05", "2027-05-19"]);
const q2 = span(p.quarters[1], T); eq("Q2 current", q2.current, true); eq("Q2 days left", q2.daysLeft, 65);
eq("Thanksgiving week has 0 school days", schoolDays("2026-11-23", "2026-11-27"), 0);
eq("year from district", [p.year.start, p.year.end], ["2026-08-03", "2027-05-19"]);
const none = periods({ periods: [{ name: "Quarter 1", start: "2026-08-03", end: "2026-10-09" }] });
eq("missing quarter → not available", [none.quarters[2].start, none.quarters[2].source], [null, "date not available"]);
for (const x of [...p.quarters, ...p.semesters, ...p.terms]) { const s = span(x, T); console.log("  ", s.id, s.start, s.end, s.current ? "NOW" : "", s.daysLeft, s.schoolDaysLeft, s.pct + "%"); }
{ const q = periods({ name: "Quarter 2", start: "2026-10-12", end: "2026-12-13" }); eq("live sync overrides Q2", [q.quarters[1].end, q.quarters[1].source], ["2026-12-13", "ParentVUE (live sync)"]); }
process.exit(fail ? 1 : 0);
