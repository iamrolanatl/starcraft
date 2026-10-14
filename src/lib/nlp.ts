// Deterministic natural-language parser. Used as the fast path and as a fallback
// when the model is unavailable or returns malformed JSON.
import type { AppId, CommandIntent } from "@/contracts/api";

const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const APPS: Record<string, AppId> = { home:"home", tasks:"tasks", todo:"tasks", weather:"weather", calendar:"calendar", health:"health", mail:"comms", email:"comms", comms:"comms", communications:"comms", school:"education", education:"education", finance:"finance", bills:"finance", shopping:"shopping" };

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export function parseDate(text: string, now: Date): string | null {
  const t = text.toLowerCase();
  if (/\btoday|tonight\b/.test(t)) return ymd(now);
  if (/\btomorrow\b/.test(t)) { const d = new Date(now); d.setDate(d.getDate()+1); return ymd(d); }
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (iso) return iso[0];
  const md = t.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) { const d = new Date(now.getFullYear(), +md[1]-1, +md[2]); if (d < now) d.setFullYear(d.getFullYear()+1); return ymd(d); }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b(next )?${DAYS[i]}\\b`).test(t)) {
      const d = new Date(now); let diff = (i - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
      d.setDate(d.getDate()+diff); return ymd(d);
    }
  }
  return null;
}

export function parseCommand(text: string, now = new Date()): CommandIntent | null {
  const t = text.trim();
  const open = t.match(/^(open|show|go to|launch)\s+(\w+)/i);
  if (open && APPS[open[2].toLowerCase()]) return { kind: "open_app", app: APPS[open[2].toLowerCase()] };
  const task = t.match(/^(remind me( to)?|add( a)?( task)?( to)?|todo:?|task:?|i need to)\s+(.+)$/i);
  if (task) {
    let body = task[6];
    const dueDate = parseDate(body, now);
    body = body.replace(/\b(on |by |next )?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/gi, "")
      .replace(/^\s*to\s+/i, "").replace(/\s+(to|on|by)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
    const priority = /\b(urgent|asap|important)\b/i.test(t) ? 1 : 2;
    body = body.replace(/\b(urgent|asap|important)\b/gi, "").trim();
    return { kind: "create_task", title: body.charAt(0).toUpperCase() + body.slice(1), dueDate, priority };
  }
  return null;
}
