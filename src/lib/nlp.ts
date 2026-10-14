// Deterministic natural-language parser. Used as the fast path and as a fallback
// when the model is unavailable or returns malformed JSON.
import type { AppId, CommandIntent } from "@/contracts/api";

const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
const APPS: Record<string, AppId> = { home:"home", tasks:"tasks", todo:"tasks", weather:"weather", calendar:"calendar", health:"health", meds:"health", steps:"health", glucose:"health", mail:"comms", email:"comms", drive:"comms", comms:"comms", communications:"comms", school:"education", education:"education", grades:"education", bells:"school", bell:"school", "check-ins":"school", checkins:"school", finance:"finance", bills:"finance", stocks:"finance", credit:"finance", shopping:"shopping", wishlist:"shopping", ocr:"ocr", scan:"ocr", scanner:"ocr", crystal:"crystal", chat:"crystal" };
const DATE_RX = /\b(on |by |next |due )?(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/gi;

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clean = (s: string) => s.replace(DATE_RX, "").replace(/\s{2,}/g, " ").replace(/^[\s:,-]+|[\s:,.-]+$/g, "").trim();

export function parseDate(text: string, now: Date): string | null {
  const t = text.toLowerCase();
  if (/\b(today|tonight)\b/.test(t)) return ymd(now);
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

function parseItem(t: string, now: Date): CommandIntent | null {
  const low = t.toLowerCase(); const today = ymd(now); let m: RegExpMatchArray | null;
  // Health
  if ((m = low.match(/^(?:log\s+|walked\s+|i walked\s+)?([\d,]+)\s*(?:k\s+)?steps?\b/)) || (m = low.match(/^(?:log\s+)?steps?:?\s*([\d,]+)/))) {
    let v = Number(m[1].replace(/,/g, "")); if (/\d\s*k\s+steps?/.test(low)) v *= 1000;
    return { kind: "create_item", table: "health_logs", app: "health", row: { kind: "steps", value: v, unit: "steps", logged_on: parseDate(t, now) ?? today }, summary: `Logged ${v.toLocaleString()} steps` };
  }
  if ((m = low.match(/\b(?:glucose|blood sugar|bg|sugar)\b\s*(?:is|was|of|at|:)?\s*(\d{2,3})/)) || (m = low.match(/^(?:log\s+)?(\d{2,3})\s*mg\/?dl/))) {
    return { kind: "create_item", table: "health_logs", app: "health", row: { kind: "glucose", value: +m[1], unit: "mg/dL", logged_on: today }, summary: `Logged glucose ${m[1]} mg/dL` };
  }
  if ((m = t.match(/^(?:add\s+)?(?:a\s+)?(?:med|meds|medication|medicine|prescription):?\s+(.+)$/i))) {
    const dose = m[1].match(/\b\d+(?:\.\d+)?\s?(?:mg|mcg|ml|g|units?|iu)\b/i)?.[0] ?? null;
    const sched = m[1].match(/\b(?:at\s+)?(\d{1,2}(?::\d2)?\s?(?:am|pm)|morning|evening|night|daily|twice daily|bedtime)\b/i)?.[0] ?? null;
    const name = m[1].replace(dose ?? "\u0000", "").replace(sched ?? "\u0000", "").replace(/\s{2,}/g, " ").trim();
    return { kind: "create_item", table: "meds", app: "health", row: { name: cap(name), dose, schedule: sched }, summary: `Medication added: ${cap(name)}` };
  }
  // Shopping / wish list
  if ((m = t.match(/^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+|the\s+)?(shopping|grocery|groceries|wish)\s*(?:list)?$/i)) || (m = t.match(/^(shopping|grocery|wish)\s*list:?\s+(.+)$/i))) {
    const [item, list] = /^(shopping|grocery|wish)/i.test(m[1]) && m[2] && !/list/i.test(m[1]) && t.toLowerCase().startsWith(m[1].toLowerCase()) ? [m[2], m[1]] : [m[1], m[2]];
    const wish = /wish/i.test(list); const q = item.match(/^(\d+)\s+(.+)$/);
    const name = cap((q ? q[2] : item).trim());
    return { kind: "create_item", table: "shop_items", app: "shopping", row: { list: wish ? "wish" : "shopping", name, qty: q ? +q[1] : 1 }, summary: `Added to ${wish ? "wish" : "shopping"} list: ${name}` };
  }
  if ((m = t.match(/^(?:buy|get|pick up)\s+(.+)$/i)) && !/\bshares?\b|\bstock\b/i.test(t)) {
    const name = cap(clean(m[1])); return { kind: "create_item", table: "shop_items", app: "shopping", row: { list: "shopping", name, qty: 1 }, summary: `Added to shopping list: ${name}` };
  }
  if ((m = t.match(/^i (?:want|wish for)\s+(?:a |an |some )?(.+)$/i))) {
    const name = cap(m[1].trim()); return { kind: "create_item", table: "shop_items", app: "shopping", row: { list: "wish", name, qty: 1 }, summary: `Added to wish list: ${name}` };
  }
  // Finance
  if ((m = t.match(/^(?:add\s+)?(?:a\s+)?bill:?\s+(.+)$/i)) || (m = t.match(/^(.+?\bbill\b.*\$\s?\d.*)$/i))) {
    const amt = m[1].match(/\$\s?([\d,]+(?:\.\d{1,2})?)|\b([\d,]+\.\d{2})\b/); const due = parseDate(m[1], now);
    const name = cap(clean(m[1].replace(/\$\s?[\d,]+(\.\d{1,2})?|\b[\d,]+\.\d{2}\b/, "").replace(/^pay\s+(the\s+)?/i, "").replace(/\bdue\b/i, "")));
    return { kind: "create_item", table: "bills", app: "finance", row: { name, amount: amt ? Number((amt[1] || amt[2]).replace(/,/g, "")) : null, due_date: due }, summary: `Bill added: ${name}${amt ? ` $${amt[1] || amt[2]}` : ""}${due ? ` due ${due}` : ""}` };
  }
  if ((m = t.match(/^(?:track|watch|follow|add stock|stock)\s+(?:(\d+(?:\.\d+)?)\s+(?:shares?\s+(?:of\s+)?)?)?\$?([A-Za-z.^]{1,8})(?:\s+(\d+(?:\.\d+)?)\s+shares?)?$/i))) {
    const sym = m[2].toUpperCase(); const sh = Number(m[1] || m[3] || 0);
    return { kind: "create_item", table: "stocks", app: "finance", row: { symbol: sym, shares: sh }, summary: `Tracking ${sym}${sh ? ` (${sh} sh)` : ""}` };
  }
  if ((m = low.match(/credit score\s*(?:is|was|of|:)?\s*(\d{3})/))) {
    return { kind: "create_item", table: "credit_scores", app: "finance", row: { score: +m[1], bureau: "manual", checked_on: today }, summary: `Credit score logged: ${m[1]}` };
  }
  // Communications
  if ((m = t.match(/^(e-?mail|mail|letter|drive|doc|file)(?:\s+note)?:\s*(.+)$/i)) || (m = t.match(/^(?:follow up|reply|respond)\s+(?:on |to )?(e-?mail|mail)?\s*(.+)$/i))) {
    const kw = (m[1] || "email").toLowerCase(); const ch = /drive|doc|file/.test(kw) ? "drive" : /^(mail|letter)$/.test(kw) ? "mail" : "email";
    const title = cap(clean(/^(follow|reply|respond)/i.test(t) ? t : m[2])); const url = m[2].match(/https?:\/\/\S+/)?.[0] ?? null;
    return { kind: "create_item", table: "comms_notes", app: "comms", row: { channel: ch, title: title.replace(url ?? "\u0000", "").trim(), url, due_date: parseDate(t, now) }, summary: `${cap(ch)} item: ${title}` };
  }
  // Education check-in
  if ((m = t.match(/^check-?in:?\s+(.+)$/i))) {
    const title = cap(m[1].trim()); return { kind: "create_item", table: "edu_checkins", app: "school", row: { title, checkin_on: today }, summary: `Check-in saved: ${title}` };
  }
  return null;
}

export function parseCommand(text: string, now = new Date()): CommandIntent | null {
  const t = text.trim();
  const open = t.match(/^(open|show|go to|launch)\s+(?:my\s+|the\s+)?([\w-]+)/i);
  if (open && APPS[open[2].toLowerCase()]) return { kind: "open_app", app: APPS[open[2].toLowerCase()] };
  const item = parseItem(t, now); if (item) return item;
  const task = t.match(/^(remind me( to)?|add( a)?( task)?( to)?|todo:?|task:?|i need to)\s+(.+)$/i);
  if (task) {
    let body = task[6];
    const dueDate = parseDate(body, now);
    body = body.replace(DATE_RX, "").replace(/^\s*to\s+/i, "").replace(/\s+(to|on|by)\s*$/i, "").replace(/\s{2,}/g, " ").trim();
    const priority = /\b(urgent|asap|important)\b/i.test(t) ? 1 : 2;
    body = body.replace(/\b(urgent|asap|important)\b/gi, "").trim();
    return { kind: "create_task", title: cap(body), dueDate, priority };
  }
  return null;
}
