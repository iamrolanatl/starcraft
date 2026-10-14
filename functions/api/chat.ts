import type { ChatRequest } from "../../src/contracts/api";
import { complete, type Env } from "../_lib/router";
import { body, json } from "../_lib/http";
import { loadFacts, type Facts } from "../_lib/facts";
import { answerSchool, dataBlock } from "../_lib/answer";
import { answerDistrict } from "../_lib/district-answer";
import { districtCalendar } from "./district-calendar";
import { escalate, hardUpfront, hardAfter, type QueueBinding } from "../_lib/escalate";
import { answerLife, lifeBlock, sanitizeLife, fetchQuotes, fetchWeather, tickerIn } from "../_lib/life";

const SALES = `You are Crystal, the cheerful robot assistant on the landing page of "Crystal", a personal productivity and task management app with a StarCraft-style space cockpit theme. Features: top priorities, to-do list with natural language ("remind me Friday to pay the water bill"), weather, calendar, an AI co-pilot robot, a cockpit HUD with pilot view, radar, ability grid and Red Alert, on-device OCR scanning. Modules: Health (steps, glucose, meds), Communications (mail/email/drive follow-ups), Education (grades, check-ins with handout upload, school calendar, bell schedules), Finance (bills, credit score tracking, stock quotes), Shopping (shopping and wish lists). Bank/credit-bureau/Gmail auto-sync is not yet connected. It's a free proof of concept; sign up with Google or an email code. Be fun, brief (under 80 words), and honest; never invent pricing or features.`;
const PILOT = `You are Crystal, a cute, upbeat robot co-pilot inside a space-cockpit productivity app. Keep answers short (under 120 words).
STRICT RULES: For anything about the user's student, school, grades, classes, teachers, assignments, sync status, tasks, calendar, health, glucose, meds, bills, money, credit, stocks/prices, shopping or wish lists, comms, check-ins, or weather, answer ONLY from the DATA and LIFE DATA blocks below. If they do not contain it, say "I don't know; I don't have that in your data." Never invent numbers, prices, readings, amounts or dates. Cite the source (e.g. "from your bills") and the "as of" time. Never invent or estimate grades, classes, teachers, names, scores or dates. When you state a grade, cite the class name and the "as of" sync time. If DATA says demo, say it is demo data.
General productivity advice that needs no personal data is fine. To create things, suggest the command bar, e.g. "add milk to shopping list".`;

type Req = ChatRequest & { demoFacts?: Facts; coords?: { lat: number; lon: number } | null };
export const onRequestPost: PagesFunction<Env & { SUPABASE_ANON_KEY?: string; ESCALATIONS?: QueueBinding }> = async ({ request, env }) => {
  const b = await body<Req>(request);
  if (!b || !Array.isArray(b.messages) || !b.messages.length) return json({ error: "messages required" }, 400);
  if (b.mode !== "pilot") return json(await complete(env, SALES, b.messages));
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const anon = env.SUPABASE_ANON_KEY || request.headers.get("x-supabase-anon") || undefined;
  const q = String(b.messages[b.messages.length - 1]?.content || "").slice(0, 2000);
  const coords = b.coords && Number.isFinite(b.coords.lat) && Number.isFinite(b.coords.lon) ? { lat: b.coords.lat, lon: b.coords.lon } : null;
  const tk = tickerIn(q); const syms = tk ? [tk] : [];
  let facts: Facts;
  if (b.demoFacts && !token) {
    facts = { ...sanitizeDemo(b.demoFacts), demo: true, signedIn: false };
    const [qs, wx] = await Promise.all([fetchQuotes([...facts.life.stocks.map(s => String(s.symbol)), ...syms]), coords ? fetchWeather(coords.lat, coords.lon) : null]); facts.life.quotes = qs; facts.life.weather = wx;
  } else facts = await loadFacts(token, anon, { syms, coords });
  const cal = await districtCalendar(); const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const direct = answerDistrict(q, cal, todayStr) ?? answerLife(q, facts.life, facts.demo, facts.assignments) ?? answerSchool(q, facts);
  if (direct) return json({ reply: direct, model: "grounded-db", provider: "fallback", grounded: true });
  const ctx = `${dataBlock(facts)}\n\n${lifeBlock(facts.life, facts.demo)}\n\nCCSD DISTRICT CALENDAR 2026-27 (official, cobbk12.org): ${cal.events.filter(e => e.cat !== "board").map(e => `${e.title} ${e.start}${e.end !== e.start ? `..${e.end}` : ""}`).join(" | ")}`;
  // Escalation needs a signed-in user (the row is owner-only under RLS); demo / signed-out stays on the small model.
  const canEsc = !!(token && anon && facts.signedIn && !facts.demo);
  const esc = async (reason: string) => canEsc ? escalate({ token: token!, anon: anon!, queue: env.ESCALATIONS, question: q, history: b.messages, context: ctx, reason }) : null;
  const pending = (id: string, reason: string) => json({ reply: "That one needs deeper thought, so I've escalated it. The answer will appear here shortly. 🛰️", model: "escalated", provider: "fallback", grounded: false, escalation: { id, status: "queued", reason } });
  const up = canEsc ? hardUpfront(q) : null;
  if (up) { const e = await esc(up); if (e) return pending(e.id, up); }
  const res = await complete(env, `${PILOT}\n\n${ctx}`, b.messages);
  const after = canEsc ? hardAfter(q, res.reply, res.provider) : null;
  if (after) { const e = await esc(after); if (e) return pending(e.id, after); }
  return json({ ...res, grounded: false });
};
function sanitizeDemo(f: Facts): Facts { // demo payload comes from the client; cap sizes
  return { demo: true, signedIn: false, student: f.student ? { name: String(f.student.name).slice(0, 60), grade: f.student.grade, school: f.student.school } : null, grades: (f.grades || []).slice(0, 200), assignments: (f.assignments || []).slice(0, 100), lastSync: f.lastSync, lastRun: f.lastRun, alerts: (f.alerts || []).slice(0, 5), tasks: (f.tasks || []).slice(0, 40), life: sanitizeLife({ ...(f.life || {}), tasks: f.life?.tasks ?? f.tasks }) };
}
