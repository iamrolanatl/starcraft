// Regression: Crystal must answer school questions exactly from DB data, never invent.
// Unit: npx tsx scripts/test-grounding.mts   Live: BASE=https://crystal-7ot.pages.dev npx tsx scripts/test-grounding.mts
import { answerSchool, courseTable } from "../functions/_lib/answer.ts";
import type { Facts } from "../functions/_lib/facts.ts";
import { answerLife, emptyLife, todayET, tickerIn, type Life } from "../functions/_lib/life.ts";
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
  lastSync: { ran_at: ago(2), fetched_at: ago(2) }, lastRun: { ran_at: ago(2), status: "ok", error: null }, alerts: [], tasks: [], life: emptyLife() };
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
// ---- every other module ----
const T = todayET(); const dd = (n: number) => new Date(Date.parse(T + "T12:00Z") + n * 864e5).toISOString().slice(0, 10);
const LIFE: Life = { ...emptyLife(), fetchedAt: ago(0),
  tasks: [{ title: "Pay water bill", due_date: T, done: false }, { title: "Return library books", due_date: dd(-2), done: false }, { title: "Done thing", due_date: T, done: true }, { title: "Dentist", due_date: dd(3), done: false }],
  bills: [{ name: "Georgia Power", amount: 142.37, due_date: dd(4), autopay: false, paid: false }, { name: "Netflix", amount: 15.49, due_date: T, autopay: true, paid: false }, { name: "Old", amount: 9, due_date: dd(-5), autopay: false, paid: true }],
  meds: [{ name: "Metformin", dose: "500mg", schedule: "8am & 8pm", last_taken: ago(3), active: true }, { name: "Stopped med", dose: null, schedule: null, last_taken: null, active: false }],
  health: [{ kind: "glucose", value: 118, unit: "mg/dL", note: null, logged_on: T, created_at: ago(1) }, { kind: "glucose", value: 131, unit: "mg/dL", note: null, logged_on: dd(-1), created_at: ago(26) }, { kind: "steps", value: 6421, unit: "steps", note: null, logged_on: T, created_at: ago(2) }],
  credit: [{ bureau: "manual", score: 742, checked_on: dd(-10) }],
  stocks: [{ symbol: "AAPL", shares: 10, cost_basis: 150 }], quotes: [{ symbol: "AAPL", price: 231.5, changePct: 1.25, at: ago(0) }],
  shop: [{ list: "shopping", name: "Milk", qty: 2, price: null, done: false }, { list: "shopping", name: "Eggs", qty: 1, price: null, done: true }, { list: "wish", name: "Telescope", qty: 1, price: 299, done: false }],
  comms: [{ channel: "email", title: "Reply to coach", due_date: dd(1), done: false }], checkins: [{ title: "Met Ms. Hyden", note: null, checkin_on: dd(-3) }],
  weather: { tempF: 71.6, code: 2, windMph: 6, hiF: 78, loF: 60, rainPct: 10, at: ago(0) } };
const A = (q: string, L = LIFE, demo = false) => answerLife(q, L, demo, [{ course: "Science 7", name: "Worksheet", due_date: T, missing: false }]);
check("due today (tasks+bills+school, overdue)", A("what's due today?"), ["Pay water bill", "Netflix", "Science 7: Worksheet", "Overdue: Return library books", "as of"], ["Done thing", "Dentist", "Georgia Power"]);
check("bills due", A("what bills do I have?"), ["Georgia Power $142.37", "Netflix $15.49", "Total $157.86", "source: bills"], ["Old"]);
check("med schedule", A("what's my med schedule"), ["Metformin 500mg: 8am & 8pm", "last taken"], ["Stopped med"]);
check("latest glucose", A("what was my latest glucose"), ["Latest glucose: 118 mg/dL", "Previous: 131", "source: health_logs"]);
check("steps", A("how many steps today"), ["6421"]);
check("stock price (live quote cited)", A("what's the price of AAPL"), ["AAPL: $231.50", "+1.25%", "10 shares", "Yahoo Finance"]);
check("unknown ticker → no guess", A("price of ZZZZ"), ["won't guess"], [/\$\d/]);
check("portfolio", A("how are my stocks"), ["AAPL $231.50", "Holdings value $2315.00"]);
check("shopping list", A("what's on my shopping list"), ["Milk x2"], ["Eggs", "Telescope"]);
check("wish list", A("show my wish list"), ["Telescope $299.00"]);
check("credit", A("what's my credit score"), ["742"]);
check("comms", A("any follow-ups?"), ["Reply to coach"]);
check("check-ins", A("recent check-ins"), ["Met Ms. Hyden"]);
check("weather", A("what's the weather"), ["72°F", "partly cloudy", "Open-Meteo"]);
check("weather unavailable → no guess", A("do I need an umbrella", { ...LIFE, weather: null }), ["won't guess"], [/°F/]);
check("tasks list", A("what are my tasks"), ["3 open tasks", "Dentist"], ["Done thing"]);
check("missing table → honest", A("what bills do I have", { ...LIFE, bills: [], missing: ["bills"] }), ["isn't set up"], ["$"]);
check("empty meds → none", A("what meds do I take", { ...LIFE, meds: [] }), ["no active medications"]);
check("demo labelled", A("what bills do I have", LIFE, true), ["DEMO DATA"]);
check("school q not hijacked", A("what is Eli's math grade") === null ? "null" : "hijacked", ["null"]);
check("PE not a ticker", String(tickerIn("how is PE going")), ["null"]);
const BASE = process.env.BASE;
if (BASE) {
  const ask = async (q: string) => { const r = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "pilot", messages: [{ role: "user", content: q }], demoFacts: SEED }) }); return ((await r.json()) as { reply: string }).reply; };
  check("LIVE math grade (seed via demo path)", await ask("what is Eli's math grade"), ["Math 7 Advanced", "79%", "[DEMO DATA]"], [/\b(8\d|9\d)%/]);
  check("LIVE class list", await ask("what classes does he take"), ["takes 4 classes", "Chorus"]);
  check("LIVE unknown → don't have", await ask("What is Eli's locker combination?"), [/don't have|do not have|not in (your|the) (synced )?data/i]);
  const askD = async (q: string) => { const r = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "pilot", messages: [{ role: "user", content: q }], demoFacts: { ...SEED, life: LIFE } }) }); return ((await r.json()) as { reply: string }).reply; };
  check("LIVE bills", await askD("what bills are due"), ["Georgia Power", "DEMO DATA"]);
  check("LIVE glucose", await askD("latest glucose?"), ["118 mg/dL"]);
  check("LIVE real quote AAPL", await askD("price of AAPL"), [/AAPL: \$\d+\.\d\d/, "Yahoo"]);
  check("LIVE shopping", await askD("what's on my shopping list"), ["Milk"]);
  check("LIVE unknown life fact → don't know", await askD("what is my car's oil change date?"), [/don't know|don't have|do not have/i]);
  check("LIVE no session (no token, no demo)", await (async () => { const r = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "pilot", messages: [{ role: "user", content: "what is Eli's math grade" }] }) }); return ((await r.json()) as { reply: string }).reply; })(), ["not signed in"]);
}
console.log(fail ? `${fail} FAILED` : "ALL PASS"); if (fail) process.exit(1);
