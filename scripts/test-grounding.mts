// Regression: Crystal must answer school questions exactly from DB data, never invent.
// Unit: npx tsx scripts/test-grounding.mts   Live: BASE=https://crystal-7ot.pages.dev npx tsx scripts/test-grounding.mts
import { answerSchool, courseTable } from "../functions/_lib/answer.ts";
import type { Facts } from "../functions/_lib/facts.ts";
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const SEED: Facts = { demo: false, signedIn: true, student: { name: "Eli Chowdhury", grade: "07", school: "Dickerson MS" },
  grades: [
    { course: "Math 7 Advanced", course_key: "MATH", teacher: "J. Hyden", period: "2", percent: null, mark: null, term: "Quarter 2", captured_at: ago(1), is_final: false },
    { course: "Math 7 Advanced", course_key: "MATH", teacher: "J. Hyden", period: "2", percent: 79, mark: "79", term: "Quarter 1", captured_at: ago(200), is_final: true },
    { course: "Science 7", course_key: "SCI", teacher: "K. Sullivan", period: "3", percent: 74, mark: "74", term: "Quarter 1", captured_at: ago(200), is_final: true },
    { course: "Reading 7", course_key: "READ", teacher: "M. L'Esperance", period: "1", percent: 80, mark: "80", term: "Quarter 1", captured_at: ago(200), is_final: true },
    { course: "Chorus", course_key: "CHOR", teacher: null, period: "6", percent: 93, mark: "93", term: "Quarter 1", captured_at: ago(200), is_final: true },
  ],
  assignments: [{ course: "Science 7", name: "Lab report", due_date: "2026-10-09", missing: true, score_display: "Missing" }],
  lastSync: { ran_at: ago(2), fetched_at: ago(2) }, lastRun: { ran_at: ago(2), status: "ok", error: null }, alerts: [], tasks: [] };
let fail = 0; const check = (name: string, got: string | null, must: (string | RegExp)[], mustNot: (string | RegExp)[] = []) => {
  const ok = !!got && must.every(m => typeof m === "string" ? got.includes(m) : m.test(got)) && mustNot.every(m => typeof m === "string" ? !got.includes(m) : !m.test(got));
  if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}\n   → ${got}`); };
const rows = courseTable(SEED.grades);
check("math grade", answerSchool("what is Eli's math grade", SEED), ["Math 7 Advanced", "J. Hyden", "Quarter 2: no grade posted yet", "79% (Quarter 1 final)", "as of last sync"], [/\b(8\d|9\d)%/]);
check("class list exact", answerSchool("what classes does he take", SEED), ["takes 4 classes", ...rows.map(r => r.cur.course)], ["Social Studies", "PLTW"]);
check("missing work", answerSchool("any missing assignments?", SEED), ["Science 7: Lab report"]);
check("last sync", answerSchool("when was the last sync", SEED), ["Last successful sync"]);
check("unknown class", answerSchool("what is his spanish grade", SEED), ["I don't have a class matching"]);
check("no session", answerSchool("what is Eli's math grade", { ...SEED, signedIn: false, student: null, grades: [], reason: "not signed in" }), ["not signed in"], ["79"]);
check("no data yet", answerSchool("what classes does he take", { ...SEED, student: null, grades: [], reason: "no school sync has loaded data yet" }), ["can't see any school data yet"]);
const BASE = process.env.BASE;
if (BASE) {
  const ask = async (q: string) => { const r = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "pilot", messages: [{ role: "user", content: q }], demoFacts: SEED }) }); return ((await r.json()) as { reply: string }).reply; };
  check("LIVE math grade (seed via demo path)", await ask("what is Eli's math grade"), ["Math 7 Advanced", "79%", "[DEMO DATA]"], [/\b(8\d|9\d)%/]);
  check("LIVE class list", await ask("what classes does he take"), ["takes 4 classes", "Chorus"]);
  check("LIVE unknown → don't have", await ask("What is Eli's locker combination?"), [/don't have|do not have|not in (your|the) (synced )?data/i]);
  check("LIVE no session (no token, no demo)", await (async () => { const r = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "pilot", messages: [{ role: "user", content: "what is Eli's math grade" }] }) }); return ((await r.json()) as { reply: string }).reply; })(), ["not signed in"]);
}
console.log(fail ? `${fail} FAILED` : "ALL PASS"); if (fail) process.exit(1);
