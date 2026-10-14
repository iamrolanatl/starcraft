import type { AppId, CommandRequest, CommandResponse, CommandIntent } from "../../src/contracts/api";
import { parseCommand, parseDate } from "../../src/lib/nlp";
import { complete, type Env } from "../_lib/router";
import { body, json } from "../_lib/http";
import { isSchoolQ } from "../_lib/answer";

const ITEM: Record<string, string[]> = { shop_items: ["list", "name", "qty"], bills: ["name", "amount", "due_date"], health_logs: ["kind", "value"], comms_notes: ["channel", "title"] };
const ITEM_APP: Record<string, AppId> = { shop_items: "shopping", bills: "finance", health_logs: "health", comms_notes: "comms" };
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await body<CommandRequest>(request);
  if (!b?.text) return json({ error: "text required" }, 400);
  const now = new Date(new Date(b.nowIso).getTime() - b.tzOffsetMinutes * 60000);
  const localNoon = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12);
  const fast = parseCommand(b.text, localNoon);
  if (fast) return json({ intent: fast, provider: "fallback" } satisfies CommandResponse);
  // Questions (esp. about school data) go to the grounded /api/chat path; never let the classifier answer them.
  if (isSchoolQ(b.text) || /\?\s*$/.test(b.text) || /^(what|who|when|where|why|how|which|is|are|does|do|did|can)\b/i.test(b.text)) return json({ intent: { kind: "chat", reply: "" }, provider: "fallback" } satisfies CommandResponse);
  const sys = `Today is ${now.toISOString().slice(0,10)} (${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][now.getUTCDay()]}). Classify the user's command. Questions or requests for advice are "chat". Only use create_task when the user clearly wants something remembered or done. Reply ONLY with JSON, one of:
{"kind":"create_task","title":"...","dueDate":"YYYY-MM-DD"|null,"priority":1|2|3}
{"kind":"open_app","app":"home|tasks|weather|calendar|health|comms|education|school|finance|shopping|ocr"}
{"kind":"create_item","table":"shop_items","row":{"list":"shopping"|"wish","name":"..."}}
{"kind":"create_item","table":"bills","row":{"name":"...","amount":number|null,"due_date":"YYYY-MM-DD"|null}}
{"kind":"create_item","table":"health_logs","row":{"kind":"steps"|"glucose","value":number}}
{"kind":"create_item","table":"comms_notes","row":{"channel":"mail"|"email"|"drive","title":"..."}}
{"kind":"chat","reply":"short friendly answer"}`;
  const r = await complete(env, sys, [{ role: "user", content: b.text }], 200);
  let intent: CommandIntent = { kind: "chat", reply: r.reply };
  try { const m = r.reply.match(/\{[\s\S]*\}/); if (m) { const p = JSON.parse(m[0]); if (p.kind === "create_task" && typeof p.title === "string" && p.title) { const d = parseDate(b.text, localNoon); intent = { kind: "create_task", title: p.title.slice(0, 300), dueDate: d ?? (/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : null), priority: [1,2,3].includes(p.priority) ? p.priority : 2 }; } else if (p.kind === "create_item" && ITEM[p.table as string] && p.row && typeof p.row === "object") { const row: Record<string, string | number | boolean | null> = {}; for (const [k, v] of Object.entries(p.row as Record<string, unknown>)) if (ITEM[p.table].includes(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)) row[k] = typeof v === "string" ? v.slice(0, 300) : v; if (Object.keys(row).length) intent = { kind: "create_item", table: p.table, row, app: ITEM_APP[p.table], summary: `Added to ${p.table.replace("_", " ")}` }; } else if (p.kind === "open_app" && typeof p.app === "string") intent = p; else if (p.kind === "chat" && typeof p.reply === "string") intent = p; } } catch {}
  return json({ intent, provider: r.provider } satisfies CommandResponse);
};
