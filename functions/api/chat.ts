import type { ChatRequest } from "../../src/contracts/api";
import { complete, type Env } from "../_lib/router";
import { body, json } from "../_lib/http";
import { loadFacts, type Facts } from "../_lib/facts";
import { answerSchool, dataBlock } from "../_lib/answer";

const SALES = `You are Crystal, the cheerful robot assistant on the landing page of "Crystal", a personal productivity and task management app with a StarCraft-style space cockpit theme. Features: top priorities, to-do list with natural language ("remind me Friday to pay the water bill"), weather, calendar, an AI co-pilot robot, a cockpit HUD with pilot view, radar, ability grid and Red Alert, on-device OCR scanning. Modules: Health (steps, glucose, meds), Communications (mail/email/drive follow-ups), Education (grades, check-ins with handout upload, school calendar, bell schedules), Finance (bills, credit score tracking, stock quotes), Shopping (shopping and wish lists). Bank/credit-bureau/Gmail auto-sync is not yet connected. It's a free proof of concept; sign up with Google or an email code. Be fun, brief (under 80 words), and honest; never invent pricing or features.`;
const PILOT = `You are Crystal, a cute, upbeat robot co-pilot inside a space-cockpit productivity app. Keep answers short (under 120 words).
STRICT RULES: For anything about the user's student, school, grades, classes, teachers, assignments, sync status, or the user's tasks, answer ONLY from the DATA block below. If the DATA block does not contain it, say "I don't have that in your synced data." Never invent or estimate grades, classes, teachers, names, scores or dates. When you state a grade, cite the class name and the "as of" sync time. If DATA says demo, say it is demo data.
General productivity advice that needs no personal data is fine. To create things, suggest the command bar, e.g. "add milk to shopping list".`;

type Req = ChatRequest & { demoFacts?: Facts };
export const onRequestPost: PagesFunction<Env & { SUPABASE_ANON_KEY?: string }> = async ({ request, env }) => {
  const b = await body<Req>(request);
  if (!b || !Array.isArray(b.messages) || !b.messages.length) return json({ error: "messages required" }, 400);
  if (b.mode !== "pilot") return json(await complete(env, SALES, b.messages));
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const anon = env.SUPABASE_ANON_KEY || request.headers.get("x-supabase-anon") || undefined;
  const facts: Facts = b.demoFacts && !token ? { ...sanitizeDemo(b.demoFacts), demo: true, signedIn: false } : await loadFacts(token, anon);
  const q = b.messages[b.messages.length - 1]?.content || "";
  const direct = answerSchool(q, facts);
  if (direct) return json({ reply: direct, model: "grounded-db", provider: "fallback", grounded: true });
  const res = await complete(env, `${PILOT}\n\n${dataBlock(facts)}`, b.messages);
  return json({ ...res, grounded: false });
};
function sanitizeDemo(f: Facts): Facts { // demo payload comes from the client; cap sizes
  return { demo: true, signedIn: false, student: f.student ? { name: String(f.student.name).slice(0, 60), grade: f.student.grade, school: f.student.school } : null, grades: (f.grades || []).slice(0, 200), assignments: (f.assignments || []).slice(0, 100), lastSync: f.lastSync, lastRun: f.lastRun, alerts: (f.alerts || []).slice(0, 5), tasks: (f.tasks || []).slice(0, 40) };
}
