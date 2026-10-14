import { cleanPv, catFor } from "../src/lib/calclean";
let f = 0; const eq = (n: string, a: unknown, b: unknown) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) f++; console.log(`${ok ? "PASS" : "FAIL"} ${n}: ${JSON.stringify(a)}`); };
eq("clean", cleanPv("Hyden, N /Isbell Math 7 Q1(6) : U2P1 Study Guide - Score: 100"), { title: "Math: U2P1 Study Guide", score: 100, teacher: "Hyden, N /Isbell", course: "Math" });
eq("no score", cleanPv("Vega, M Reading 7 Q1(2) : Chapter 4 Quiz").title, "Reading: Chapter 4 Quiz");
eq("plain", cleanPv("Picture Day").title, "Picture Day");
eq("cat test", catFor({ pv: true, title: "Reading: Chapter 4 Quiz" }), "test");
eq("cat graded", catFor({ pv: true, title: "x", score: 90 }), "graded");
eq("cat holiday", catFor({ district: "holiday", title: "Winter" }), "holiday");
process.exit(f ? 1 : 0);
