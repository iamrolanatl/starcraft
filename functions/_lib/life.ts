// Grounding for every non-school module: tasks, calendar, health, meds, bills, credit, stocks (+live quotes), shopping/wish,
// comms, check-ins, weather. Loaded with the caller's JWT (RLS). Deterministic handlers for common questions; DATA block for the LLM.
export interface Life {
  fetchedAt: string; missing: string[];
  tasks: { title: string; due_date: string | null; done: boolean; priority?: number | null }[];
  health: { kind: string; value: number | null; unit: string | null; note: string | null; logged_on: string; created_at: string; source?: string | null }[];
  meds: { name: string; dose: string | null; schedule: string | null; last_taken: string | null; active: boolean }[];
  bills: { name: string; amount: number | null; due_date: string | null; autopay: boolean; paid: boolean }[];
  credit: { bureau: string; score: number | null; checked_on: string }[];
  stocks: { symbol: string; shares: number | null; cost_basis: number | null }[];
  quotes: { symbol: string; price: number | null; changePct: number | null; at: string }[];
  shop: { list: string; name: string; qty: number | null; price: number | null; done: boolean }[];
  comms: { channel: string; title: string; due_date: string | null; done: boolean }[];
  checkins: { title: string; note: string | null; checkin_on: string }[];
  mail: { from: string | null; subject: string | null; date: string | null; snippet: string | null; is_read: boolean; school_tag: string | null }[];
  weather: { tempF: number; code: number; windMph: number; hiF?: number; loF?: number; rainPct?: number; at: string } | null;
}
export const emptyLife = (): Life => ({ fetchedAt: new Date().toISOString(), missing: [], tasks: [], health: [], meds: [], bills: [], credit: [], stocks: [], quotes: [], shop: [], comms: [], checkins: [], mail: [], weather: null });
const SYM = /^[A-Z0-9.\-^=]{1,12}$/;
export async function fetchQuotes(syms: string[]): Promise<Life["quotes"]> {
  const at = new Date().toISOString();
  return Promise.all([...new Set(syms.map(s => s.toUpperCase()).filter(s => SYM.test(s)))].slice(0, 12).map(async symbol => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 (Crystal)" }, signal: AbortSignal.timeout(6000), cf: { cacheTtl: 60 } } as RequestInit);
      const j = await r.json() as { chart?: { result?: { meta: { regularMarketPrice?: number; chartPreviousClose?: number; regularMarketTime?: number } }[] } };
      const m = j.chart?.result?.[0]?.meta; if (!m?.regularMarketPrice) return { symbol, price: null, changePct: null, at };
      return { symbol, price: m.regularMarketPrice, changePct: m.chartPreviousClose ? (m.regularMarketPrice / m.chartPreviousClose - 1) * 100 : null, at: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : at };
    } catch { return { symbol, price: null, changePct: null, at }; }
  }));
}
export async function fetchWeather(lat: number, lon: number): Promise<Life["weather"]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json() as { current?: { temperature_2m: number; weather_code: number; wind_speed_10m: number; time: string }; daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } };
    if (!j.current) return null;
    return { tempF: j.current.temperature_2m, code: j.current.weather_code, windMph: j.current.wind_speed_10m, hiF: j.daily?.temperature_2m_max?.[0], loF: j.daily?.temperature_2m_min?.[0], rainPct: j.daily?.precipitation_probability_max?.[0], at: new Date().toISOString() };
  } catch { return null; }
}
/** Load every module table through PostgREST with the user's token (RLS). Missing tables are recorded, not fatal. */
export async function loadLife(q: <T>(path: string) => Promise<T[] | null>, extraSyms: string[] = []): Promise<Life> {
  const L = emptyLife();
  const get = async <T>(name: string, path: string): Promise<T[]> => { const r = await q<T>(path); if (r == null) { L.missing.push(name); return []; } return r; };
  [L.tasks, L.health, L.meds, L.bills, L.credit, L.stocks, L.shop, L.comms, L.checkins] = await Promise.all([
    get<Life["tasks"][number]>("tasks", "tasks?select=title,due_date,done,priority&order=done,due_date&limit=60"),
    get<Life["health"][number]>("health_logs", "health_logs?select=kind,value,unit,note,logged_on,created_at,source&order=logged_on.desc,created_at.desc&limit=120"),
    get<Life["meds"][number]>("meds", "meds?select=name,dose,schedule,last_taken,active&order=name&limit=40"),
    get<Life["bills"][number]>("bills", "bills?select=name,amount,due_date,autopay,paid&order=due_date&limit=60"),
    get<Life["credit"][number]>("credit_scores", "credit_scores?select=bureau,score,checked_on&order=checked_on.desc&limit=10"),
    get<Life["stocks"][number]>("stocks", "stocks?select=symbol,shares,cost_basis&order=symbol&limit=30"),
    get<Life["shop"][number]>("shop_items", "shop_items?select=list,name,qty,price,done&order=created_at.desc&limit=100"),
    get<Life["comms"][number]>("comms_notes", "comms_notes?select=channel,title,due_date,done&order=done,due_date&limit=40"),
    get<Life["checkins"][number]>("edu_checkins", "edu_checkins?select=title,note,checkin_on&order=checkin_on.desc&limit=10"),
  ]);
  L.mail = await get<Life["mail"][number]>("mail_messages", "mail_messages?select=from,subject,date,snippet,is_read,school_tag&order=date.desc&limit=40");
  L.quotes = await fetchQuotes([...L.stocks.map(s => s.symbol), ...extraSyms]);
  return L;
}
export function sanitizeLife(x: Partial<Life> | undefined): Life {
  const L = emptyLife(); if (!x || typeof x !== "object") return L; const arr = <T>(v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []) as T[];
  return { ...L, tasks: arr(x.tasks, 60), health: arr(x.health, 120), meds: arr(x.meds, 40), bills: arr(x.bills, 60), credit: arr(x.credit, 10), stocks: arr(x.stocks, 30), shop: arr(x.shop, 100), comms: arr(x.comms, 40), checkins: arr(x.checkins, 10), mail: arr<Life["mail"][number]>(x.mail, 40).map(m => ({ from: String(m?.from ?? "").slice(0, 120), subject: String(m?.subject ?? "").slice(0, 200), date: typeof m?.date === "string" ? m.date : null, snippet: String(m?.snippet ?? "").slice(0, 200), is_read: !!m?.is_read, school_tag: typeof m?.school_tag === "string" ? m.school_tag : null })), fetchedAt: typeof x.fetchedAt === "string" ? x.fetchedAt : L.fetchedAt };
}

/* ---------- deterministic answers ---------- */
const ET = "America/New_York";
export const todayET = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: ET });
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T12:00Z") + n * 864e5).toISOString().slice(0, 10);
const fmtT = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "unknown";
const dday = (d: string | null) => d ? new Date(d.slice(0, 10) + "T12:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "no date";
const money = (n: number | null | undefined) => n == null ? "amount not set" : `$${Number(n).toFixed(2)}`;
const WX: Record<number, string> = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog", 51: "drizzle", 53: "drizzle", 55: "drizzle", 61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers", 95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms" };
const cite = (src: string, at: string, demo: boolean) => ` [source: ${src}${demo ? ", DEMO DATA" : ""}; as of ${fmtT(at)}]`;
const need = (L: Life, t: string, label: string) => L.missing.includes(t) ? `I can't read your ${label} yet: the ${t} table isn't set up in the database (migration 004 pending). ` : "";
export function tickerIn(q: string): string | null {
  const m = q.match(/\$([A-Za-z.]{1,6})\b/) || q.match(/\b(?:price of|quote for|quote on|how(?:'s| is) )\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/) || q.match(/\b([A-Z]{1,5})\s+(?:stock|shares|price|quote)\b/);
  const t = m ? m[1].toUpperCase() : null; return t && !["PE", "LA", "ELA", "SS", "ART", "I", "A", "IT", "ELI", "GPA"].includes(t) ? t : null;
}
export type Assign = { course: string | null; name: string; due_date: string | null; missing: boolean };
/** Returns a grounded answer or null. `assignments` lets "what's due today" include schoolwork. */
export function answerLife(q: string, L: Life, demo: boolean, assignments: Assign[] = [], now = new Date()): string | null {
  const t0 = todayET(now), at = L.fetchedAt;
  // what's due today / tomorrow / this week
  const when = /\btomorrow\b/i.test(q) ? 1 : /\bthis week|next 7|week\b/i.test(q) ? 7 : /\btoday|tonight\b/i.test(q) ? 0 : -1;
  if (when >= 0 && /\b(due|agenda|on my plate|to ?do|have to do|what'?s up|anything)\b/i.test(q) && !/\bbill|med|grade|stock\b/i.test(q)) {
    const end = addDays(t0, when), start = when === 1 ? end : t0, inR = (d: string | null) => !!d && d.slice(0, 10) >= start && d.slice(0, 10) <= end;
    const overdue = when === 0 ? L.tasks.filter(t => !t.done && t.due_date && t.due_date.slice(0, 10) < t0) : [];
    const items = [...L.tasks.filter(t => !t.done && inR(t.due_date)).map(t => `task "${t.title}"`), ...L.bills.filter(b => !b.paid && inR(b.due_date)).map(b => `bill ${b.name} ${money(b.amount)}`),
      ...L.comms.filter(c => !c.done && inR(c.due_date)).map(c => `${c.channel} follow-up "${c.title}"`), ...assignments.filter(a => !a.missing && inR(a.due_date)).map(a => `${a.course ?? "class"}: ${a.name}`)];
    const label = when === 0 ? "today" : when === 1 ? "tomorrow" : "in the next 7 days";
    return `${items.length ? `Due ${label}: ${items.join("; ")}.` : `Nothing in your data is due ${label}.`}${overdue.length ? ` Overdue: ${overdue.map(t => t.title).join("; ")}.` : ""}${cite("tasks, bills, comms, school", at, demo)}`;
  }
  if (/\bbills?\b/i.test(q)) {
    const pre = need(L, "bills", "bills"); if (pre) return pre.trim();
    const open = L.bills.filter(b => !b.paid).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
    if (!open.length) return `No unpaid bills in your data.${cite("bills", at, demo)}`;
    const late = open.filter(b => b.due_date && b.due_date < t0);
    return `Unpaid bills: ${open.slice(0, 10).map(b => `${b.name} ${money(b.amount)} due ${dday(b.due_date)}${b.autopay ? " (autopay)" : ""}${b.due_date && b.due_date < t0 ? " OVERDUE" : ""}`).join("; ")}. Total ${money(open.reduce((s, b) => s + (Number(b.amount) || 0), 0))}${late.length ? `, ${late.length} overdue` : ""}.${cite("bills", at, demo)}`;
  }
  if (/\b(meds?|medications?|medicine|pills?|dose|doses)\b/i.test(q)) {
    const pre = need(L, "meds", "medications"); if (pre) return pre.trim();
    const m = L.meds.filter(x => x.active !== false);
    return m.length ? `Med schedule: ${m.map(x => `${x.name}${x.dose ? ` ${x.dose}` : ""}: ${x.schedule || "no schedule set"}${x.last_taken ? `, last taken ${fmtT(x.last_taken)}` : ", not logged as taken"}`).join("; ")}.${cite("meds", at, demo)}` : `You have no active medications in your data.${cite("meds", at, demo)}`;
  }
  const hk = /\b(glucose|blood sugar|bg)\b/i.test(q) ? "glucose" : (/\b(my steps|step count|steps? (today|yesterday|this week|walked|taken|did i)|how many steps|steps? (have|did) i)\b/i.test(q) && !/step[- ]by[- ]step|steps to\b/i.test(q)) ? "steps" : /\b(weight|weigh)\b/i.test(q) ? "weight" : null;
  if (hk) {
    const pre = need(L, "health_logs", "health logs"); if (pre) return pre.trim();
    const r = L.health.filter(h => h.kind === hk).sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (hk === "steps" && r.length) return stepsAnswer(r, q) + cite("health_logs", r[0].created_at, demo);
    if (!r.length) return `I don't have any ${hk} readings in your data.${cite("health_logs", at, demo)}`;
    const u = r[0].unit || (hk === "glucose" ? "mg/dL" : hk === "weight" ? "lb" : "steps");
    return `Latest ${hk}: ${r[0].value ?? "?"} ${u} on ${dday(r[0].logged_on)} (logged ${fmtT(r[0].created_at)})${r.length > 1 ? `. Previous: ${r.slice(1, 4).map(x => `${x.value} ${x.unit || u} (${dday(x.logged_on)})`).join(", ")}` : ""}.${cite("health_logs", r[0].created_at, demo)}`;
  }
  const sym = tickerIn(q);
  if (sym || /\b(stocks?|portfolio|holdings|shares)\b/i.test(q)) {
    if (sym) { const qt = L.quotes.find(x => x.symbol === sym); if (!qt || qt.price == null) return `I couldn't get a live quote for ${sym} right now, so I won't guess a price.`;
      const h = L.stocks.find(s => s.symbol.toUpperCase() === sym);
      return `${sym}: $${qt.price.toFixed(2)}${qt.changePct != null ? ` (${qt.changePct >= 0 ? "+" : ""}${qt.changePct.toFixed(2)}% today)` : ""}${h?.shares ? `. You hold ${h.shares} shares, worth $${(h.shares * qt.price).toFixed(2)}` : ""}.${cite("Yahoo Finance delayed quote", qt.at, false)}`; }
    const pre = need(L, "stocks", "stock watchlist"); if (pre) return pre.trim();
    if (!L.stocks.length) return `Your stock watchlist is empty.${cite("stocks", at, demo)}`;
    let tot = 0; const parts = L.stocks.map(s => { const qt = L.quotes.find(x => x.symbol === s.symbol.toUpperCase()); if (qt?.price != null && s.shares) tot += s.shares * qt.price; return `${s.symbol.toUpperCase()} ${qt?.price != null ? `$${qt.price.toFixed(2)}${qt.changePct != null ? ` (${qt.changePct >= 0 ? "+" : ""}${qt.changePct.toFixed(2)}%)` : ""}` : "quote unavailable"}${s.shares ? ` x${s.shares}` : ""}`; });
    return `Portfolio: ${parts.join("; ")}${tot ? `. Holdings value $${tot.toFixed(2)}` : ""}.${cite("stocks + Yahoo delayed quotes", L.quotes[0]?.at ?? at, demo)}`;
  }
  if (/\b(shopping|grocery|groceries|wish ?list|buy list)\b/i.test(q)) {
    const pre = need(L, "shop_items", "shopping list"); if (pre) return pre.trim();
    const list = /wish/i.test(q) ? "wish" : "shopping"; const it = L.shop.filter(s => s.list === list && !s.done);
    return it.length ? `Your ${list} list (${it.length}): ${it.map(s => `${s.name}${s.qty && s.qty > 1 ? ` x${s.qty}` : ""}${s.price != null ? ` ${money(s.price)}` : ""}`).join(", ")}.${cite("shop_items", at, demo)}` : `Your ${list} list is empty.${cite("shop_items", at, demo)}`;
  }
  if (/\bcredit (score|report)\b/i.test(q)) {
    const pre = need(L, "credit_scores", "credit scores"); if (pre) return pre.trim();
    const c = L.credit[0]; return c ? `Latest credit score: ${c.score} (${c.bureau}, checked ${dday(c.checked_on)}).${cite("credit_scores", at, demo)}` : `No credit scores logged yet.${cite("credit_scores", at, demo)}`;
  }
  const mailA = answerMail(q, L, demo); if (mailA) return mailA;
  if (/\b(follow[- ]?ups?|comms|emails? to (send|answer)|mail)\b/i.test(q)) {
    const pre = need(L, "comms_notes", "comms notes"); if (pre) return pre.trim();
    const c = L.comms.filter(x => !x.done); return c.length ? `Open follow-ups: ${c.map(x => `${x.channel}: ${x.title}${x.due_date ? ` (due ${dday(x.due_date)})` : ""}`).join("; ")}.${cite("comms_notes", at, demo)}` : `No open comms follow-ups.${cite("comms_notes", at, demo)}`;
  }
  if (/\bcheck[- ]?ins?\b/i.test(q)) {
    const c = L.checkins; return c.length ? `Recent check-ins: ${c.slice(0, 5).map(x => `${dday(x.checkin_on)}: ${x.title}`).join("; ")}.${cite("edu_checkins", at, demo)}` : `No check-ins logged.${cite("edu_checkins", at, demo)}`;
  }
  if (/\b(weather|temperature|rain|umbrella|jacket|forecast|outside)\b/i.test(q)) {
    const w = L.weather; if (!w) return "I don't have your location's weather right now (location not shared or the weather service is unreachable), so I won't guess.";
    return `Now ${Math.round(w.tempF)}°F, ${WX[w.code] ?? "conditions unknown"}, wind ${Math.round(w.windMph)} mph${w.hiF != null ? `. Today high ${Math.round(w.hiF)}°F / low ${Math.round(w.loF ?? 0)}°F` : ""}${w.rainPct != null ? `, ${w.rainPct}% chance of rain` : ""}.${cite("Open-Meteo", w.at, false)}`;
  }
  if (/\b(my )?(tasks?|to-?dos?|missions?)\b/i.test(q) && /\b(what|list|show|open|how many|my)\b/i.test(q)) {
    const o = L.tasks.filter(t => !t.done); return o.length ? `${o.length} open task${o.length > 1 ? "s" : ""}: ${o.slice(0, 12).map(t => `${t.title}${t.due_date ? ` (due ${dday(t.due_date)})` : ""}`).join("; ")}.${cite("tasks", at, demo)}` : `No open tasks.${cite("tasks", at, demo)}`;
  }
  if (/\b(calendar|events?|appointments?)\b/i.test(q)) {
    const up = L.tasks.filter(t => !t.done && t.due_date && t.due_date.slice(0, 10) >= t0).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 10);
    return up.length ? `Upcoming on your calendar: ${up.map(t => `${dday(t.due_date)}: ${t.title}`).join("; ")}.${cite("tasks (calendar view)", at, demo)}` : `Nothing upcoming on your calendar.${cite("tasks", at, demo)}`;
  }
  return null;
}
/** "any new emails from Ms. Sparks?", "unread school email", "emails from teachers" -> from the mirrored school inbox. */
export function answerMail(q: string, L: Life, demo: boolean): string | null {
  if (!/\b(e-?mails?|inbox|messages? from)\b/i.test(q) || /\bemails? to (send|answer)\b/i.test(q)) return null;
  if (L.missing.includes("mail_messages")) return "I can't read your school email yet: the mail tables aren't set up (migration 012_mail.sql pending).";
  const who = q.match(/\bfrom\s+(?:(?:mr|mrs|ms|miss|dr|coach)\.?\s+)?([a-z][a-z'\-]+(?:\s+[a-z][a-z'\-]+)?)/i)?.[1]?.replace(/\b(today|yesterday|this|recently|lately)\b.*$/i, "").trim();
  let ms = L.mail;
  if (who && !/^(school|teachers?|the school|district|ctls)$/i.test(who)) ms = ms.filter(m => (m.from || "").toLowerCase().includes(who.toLowerCase().split(" ").pop()!));
  else if (/teacher/i.test(q)) ms = ms.filter(m => m.school_tag === "teacher"); else if (/district/i.test(q)) ms = ms.filter(m => m.school_tag === "district"); else if (/ctls/i.test(q)) ms = ms.filter(m => m.school_tag === "CTLS");
  if (/\b(new|unread)\b/i.test(q)) ms = ms.filter(m => !m.is_read);
  const name = (f: string | null) => (f || "").replace(/<[^>]+>/, "").replace(/"/g, "").trim();
  const src = cite("school email (Gmail mirror)", L.fetchedAt, demo);
  if (!ms.length) return `${who ? `No ${/new|unread/i.test(q) ? "new " : ""}school emails from ${who} in your inbox.` : /new|unread/i.test(q) ? "No unread school email." : "No matching school email."}${src}`;
  return `${ms.length} ${/new|unread/i.test(q) ? "unread " : ""}school email${ms.length > 1 ? "s" : ""}${who ? ` from ${who}` : ""}: ${ms.slice(0, 6).map(m => `"${m.subject || "(no subject)"}" from ${name(m.from)} on ${dday(m.date)}${m.is_read ? "" : " (unread)"}`).join("; ")}.${src}`;
}
export function lifeBlock(L: Life, demo: boolean): string {
  const t0 = todayET(); const j = (a: string[]) => a.join(" | ") || "none";
  return [`LIFE DATA${demo ? " (DEMO, fake sample data)" : ""} fetched ${fmtT(L.fetchedAt)}; today is ${t0}${L.missing.length ? `; tables not set up: ${L.missing.join(", ")}` : ""}`,
    `tasks: ${j(L.tasks.filter(t => !t.done).slice(0, 20).map(t => `${t.title}${t.due_date ? ` due ${t.due_date.slice(0, 10)}` : ""}`))}`,
    `bills unpaid: ${j(L.bills.filter(b => !b.paid).map(b => `${b.name} ${money(b.amount)} due ${b.due_date ?? "?"}${b.autopay ? " autopay" : ""}`))}`,
    `meds: ${j(L.meds.filter(m => m.active !== false).map(m => `${m.name} ${m.dose ?? ""} ${m.schedule ?? ""} last ${m.last_taken ? fmtT(m.last_taken) : "never"}`))}`,
    `health latest: ${j(["glucose", "steps", "weight"].map(k => L.health.find(h => h.kind === k)).filter(Boolean).map(h => `${h!.kind} ${h!.value} ${h!.unit ?? ""} on ${h!.logged_on}`))}`,
    `credit: ${L.credit[0] ? `${L.credit[0].score} (${L.credit[0].checked_on})` : "none"}`,
    `stocks: ${j(L.stocks.map(s => { const q = L.quotes.find(x => x.symbol === s.symbol.toUpperCase()); return `${s.symbol} x${s.shares ?? 0} ${q?.price != null ? `$${q.price.toFixed(2)}` : "no quote"}`; }))}`,
    `shopping: ${j(L.shop.filter(s => s.list === "shopping" && !s.done).map(s => s.name))}`, `wish list: ${j(L.shop.filter(s => s.list === "wish" && !s.done).map(s => s.name))}`,
    `comms follow-ups: ${j(L.comms.filter(c => !c.done).map(c => `${c.channel}: ${c.title}`))}`, `check-ins: ${j(L.checkins.slice(0, 5).map(c => `${c.checkin_on}: ${c.title}`))}`,
    `school email (newest first): ${j(L.mail.slice(0, 15).map(m => `${m.date?.slice(0, 10) ?? "?"} ${m.is_read ? "" : "UNREAD "}[${m.school_tag ?? "school"}] from ${m.from}: ${m.subject}`))}`,
    `weather: ${L.weather ? `${Math.round(L.weather.tempF)}F code ${L.weather.code}` : "unavailable"}`].join("\n");
}

/** Steps from real rows only: per day the iPhone value wins, else manual entries summed. */
export function stepsAnswer(rows: Life["health"], q: string): string {
  const by = new Map<string, number>(), ip = new Set<string>();
  for (const h of rows) { const v = Number(h.value || 0); if (h.source === "iphone") { by.set(h.logged_on, Math.max(v, ip.has(h.logged_on) ? by.get(h.logged_on) ?? 0 : 0)); ip.add(h.logged_on); } }
  for (const h of rows) if (h.source !== "iphone" && !ip.has(h.logged_on)) by.set(h.logged_on, (by.get(h.logged_on) ?? 0) + Number(h.value || 0));
  const d = (n: number) => { const x = new Date(Date.now() - 4 * 3600e3 - n * 864e5); return x.toISOString().slice(0, 10); };
  const f = (n: number) => n.toLocaleString("en-US");
  const days = [...by.keys()].sort().reverse();
  if (/yesterday/i.test(q)) return by.has(d(1)) ? `Yesterday (${d(1)}): ${f(by.get(d(1))!)} steps.` : `I don't have steps for yesterday (${d(1)}) in your data.`;
  if (/week|7 ?days|average/i.test(q)) { const w = Array.from({ length: 7 }, (_, i) => d(i)); const have = w.filter(x => by.has(x)); if (!have.length) return "I don't have any steps for the last 7 days in your data.";
    const tot = have.reduce((s, x) => s + by.get(x)!, 0); return `Last 7 days: ${f(tot)} steps total across ${have.length} day(s) with data, average ${f(Math.round(tot / have.length))}/day. ${w.map(x => `${x.slice(5)}: ${by.has(x) ? f(by.get(x)!) : "no data"}`).join(", ")}.`; }
  const t = d(0); if (by.has(t)) return `Today (${t}): ${f(by.get(t)!)} steps${ip.has(t) ? " from your iPhone" : ""}.`;
  return `I don't have steps for today yet. Most recent: ${f(by.get(days[0])!)} on ${days[0]}.`;
}
