import type { CommandRequest, CommandResponse, CommandIntent } from "../../src/contracts/api";
import { parseCommand, parseDate } from "../../src/lib/nlp";
import { complete, type Env } from "../_lib/router";
import { body, json } from "../_lib/http";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await body<CommandRequest>(request);
  if (!b?.text) return json({ error: "text required" }, 400);
  const now = new Date(new Date(b.nowIso).getTime() - b.tzOffsetMinutes * 60000);
  const localNoon = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  const fast = parseCommand(b.text, localNoon);
  if (fast) return json({ intent: fast, provider: "fallback" } satisfies CommandResponse);
  const sys = `Today is ${now.toISOString().slice(0,10)} (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getUTCDay()]}). Classify the user's command. Questions or requests for advice are "chat". Only use create_task when the user clearly wants something remembered or done. Reply ONLY with JSON, one of:
{"kind":"create_task","title":"...","dueDate":"YYYY-MM-DD"|null,"priority":1|2|3}
{"kind":"open_app","app":"home|tasks|weather|calendar|health|comms|education|finance|shopping"}
{"kind":"chat","reply":"short friendly answer"}`;
  const r = await complete(env, sys, [{ role: "user", content: b.text }], 200);
  let intent: CommandIntent = { kind: "chat", reply: r.reply };
  try { const m = r.reply.match(/\{[\s\S]*\}/); if (m) { const p = JSON.parse(m[0]); if (p.kind === "create_task" && typeof p.title === "string" && p.title) { const d = parseDate(b.text, localNoon); intent = { kind: "create_task", title: p.title.slice(0, 300), dueDate: d ?? (/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : null), priority: [1,2,3].includes(p.priority) ? p.priority : 2 }; } else if (p.kind === "open_app" && typeof p.app === "string") intent = p; else if (p.kind === "chat" && typeof p.reply === "string") intent = p; } } catch {}
  return json({ intent, provider: r.provider } satisfies CommandResponse);
};
