"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { list, insert, update, remove, onChange, isLocal, uploadHandout, handoutUrl, type Row, type Table } from "@/lib/store";
import { sfx } from "@/lib/synth";
import { Skeleton, Empty, ErrorNote, Gauge, Sparkline, toast } from "@/components/ui/kit";
import { haptic } from "@/lib/synth";
import { DMS, schoolDay, DMS_EVENTS, PORTALS, type Grade } from "@/lib/school";

type Log = (s: string, tone?: "info" | "ok" | "warn") => void;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtD = (d?: unknown) => d ? new Date(String(d) + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }) : "";
const money = (n: unknown) => n == null || n === "" ? "" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function useRows(t: Table, log: Log) {
  const [rows, setRows] = useState<Row[]>([]); const [loaded, setLoaded] = useState(false); const [err, setErr] = useState<{ message: string; kind?: string } | null>(null);
  const reload = useCallback(() => list(t).then(r => { setRows(r); setLoaded(true); setErr(null); }).catch(e => { setLoaded(true); setErr(e as { message: string; kind?: string }); log(`${t}: ${(e as Error).message}`, "warn"); }), [t, log]);
  useEffect(() => { reload(); return onChange(reload); }, [reload]);
  const act = async (fn: () => Promise<void>, ok?: string) => { try { await fn(); if (ok) { log(ok, "ok"); sfx("success"); haptic(12); toast(ok); } } catch (e) { setErr(e as { message: string; kind?: string }); toast((e as Error).message, "warn"); log(`Error: ${(e as Error).message}`, "warn"); sfx("error"); haptic([30, 30, 30]); } };
  return {
    rows, loaded, err, local: isLocal(t),
    add: (r: Record<string, unknown>, ok: string) => act(() => insert(t, r), ok),
    set: (id: string, p: Record<string, unknown>) => act(() => update(t, id, p)),
    del: (id: string, ok = "Deleted") => act(() => remove(t, id), ok),
  };
}

const Tabs = ({ tabs, cur, set }: { tabs: string[]; cur: string; set: (s: string) => void }) => (
  <div role="tablist" className="mb-3 flex flex-wrap gap-1">{tabs.map(t => <button key={t} role="tab" aria-selected={cur === t} onClick={() => { sfx("click"); set(t); }} className={`rounded-md px-2.5 py-1 text-xs ${cur === t ? "bg-cyan/20 text-cyan neon-border" : "text-ash hover:text-cyan"}`}>{t}</button>)}</div>
);
const LocalNote = ({ on }: { on: boolean }) => on ? <p className="mt-2 text-[10px] text-amber-200/80">Demo data on this device only. Sign in to save for real.</p> : null;
type RowsHook = { loaded: boolean; err: { message: string; kind?: string } | null };
const State = ({ r, empty, n, hint }: { r: RowsHook; empty: string; n: number; hint?: string }) => !r.loaded ? <Skeleton rows={3} /> : r.err ? <ErrorNote err={r.err} /> : n === 0 ? <Empty title={empty} hint={hint} /> : null;
const Del = ({ onClick, label }: { onClick: () => void; label: string }) => <button onClick={onClick} aria-label={`Delete ${label}`} className="text-xs text-slate hover:text-alert">✕</button>;

/* ───────── Health ───────── */
export function Health({ log }: { log: Log }) {
  const [tab, setTab] = useState("Steps");
  const h = useRows("health_logs", log); const m = useRows("meds", log);
  const [val, setVal] = useState(""); const [med, setMed] = useState({ name: "", dose: "", schedule: "" });
  const kind = tab === "Steps" ? "steps" : "glucose";
  const series = h.rows.filter(r => r.kind === kind).sort((a, b) => String(a.logged_on).localeCompare(String(b.logged_on)));
  const todaySteps = h.rows.filter(r => r.kind === "steps" && r.logged_on === today()).reduce((s, r) => s + Number(r.value || 0), 0);
  const goal = 8000;
  return (<div>
    <Tabs tabs={["Steps", "Glucose", "Meds"]} cur={tab} set={setTab} />
    {tab !== "Meds" ? (<>
      {!h.loaded || h.err ? <State r={h} empty="" n={1} /> : <div className="flex items-center gap-2">
        {tab === "Steps" ? <Gauge value={todaySteps} max={goal} label="Steps today" unit={`goal ${goal / 1000}k`} bands={[[goal * .5, "#ff9a5c"], [goal - 1, "#ffd166"], [1e9, "#7dffc8"]]} />
          : series.length ? <Gauge value={Number(series.at(-1)!.value)} min={40} max={250} label="Glucose" unit="mg/dL" bands={[[69, "#ff3b5c"], [180, "#7dffc8"], [1e9, "#ff3b5c"]]} /> : null}
        <div className="min-w-0 flex-1"><Sparkline vals={series.slice(-14).map(r => Number(r.value))} color={tab === "Steps" ? "#3ef2e0" : "#c77dff"} /><p className="text-[10px] text-slate">{tab === "Steps" ? "Last 14 entries" : "Target 70–180 mg/dL"}</p></div></div>}
      <form className="my-2 flex gap-2" onSubmit={e => { e.preventDefault(); const v = Number(val); if (!v || v < 0) return; h.add({ kind, value: v, unit: kind === "steps" ? "steps" : "mg/dL", logged_on: today() }, `Logged ${v} ${kind === "steps" ? "steps" : "mg/dL glucose"}`); setVal(""); }}>
        <input className="input text-sm" type="number" inputMode="numeric" min={0} placeholder={tab === "Steps" ? "Steps walked" : "Glucose mg/dL"} value={val} onChange={e => setVal(e.target.value)} aria-label={`${tab} value`} />
        <button className="btn btn-primary text-sm">Log</button>
      </form>
      {h.loaded && !h.err && !series.length && <Empty title={`No ${tab.toLowerCase()} logged yet`} hint={tab === "Steps" ? "Try “log 8000 steps”" : "Try “glucose 110”"} />}
      <ul className="space-y-1 text-sm">{series.slice(-8).reverse().map(r => <li key={r.id} className="flex justify-between rounded px-2 py-1 hover:bg-cyan/5"><span className="text-ash">{fmtD(r.logged_on)}</span><span className="text-snow">{Number(r.value).toLocaleString()} {String(r.unit || "")}</span><Del onClick={() => h.del(r.id)} label="entry" /></li>)}</ul>
      <p className="mt-2 text-[10px] text-slate">Manual entry. Apple Health / Google Fit / Dexcom auto-import needs account linking.</p>
      <LocalNote on={h.local} />
    </>) : (<>
      <form className="mb-2 grid grid-cols-3 gap-2" onSubmit={e => { e.preventDefault(); if (!med.name.trim()) return; m.add({ ...med, name: med.name.trim() }, `Med added: ${med.name}`); setMed({ name: "", dose: "", schedule: "" }); }}>
        <input className="input col-span-3 text-sm sm:col-span-1" placeholder="Medication" value={med.name} onChange={e => setMed({ ...med, name: e.target.value })} aria-label="Medication name" />
        <input className="input text-sm" placeholder="Dose" value={med.dose} onChange={e => setMed({ ...med, dose: e.target.value })} aria-label="Dose" />
        <input className="input text-sm" placeholder="When (e.g. 8am)" value={med.schedule} onChange={e => setMed({ ...med, schedule: e.target.value })} aria-label="Schedule" />
        <button className="btn btn-primary col-span-3 text-sm">Add medication</button>
      </form>
      <ul className="space-y-1">{m.rows.map(r => { const taken = r.last_taken && String(r.last_taken).slice(0, 10) === new Date().toISOString().slice(0, 10); return (
        <li key={r.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-cyan/5">
          <span className="flex-1 text-snow">{String(r.name)} <span className="text-xs text-ash">{String(r.dose || "")} {r.schedule ? `· ${r.schedule}` : ""}</span></span>
          <button onClick={() => m.set(r.id, { last_taken: new Date().toISOString() })} className={`rounded px-2 py-0.5 text-xs ${taken ? "bg-mint/20 text-mint" : "border border-cyan/40 text-cyan"}`}>{taken ? "✓ taken" : "Take"}</button>
          <Del onClick={() => m.del(r.id)} label={String(r.name)} /></li>); })}
</ul><State r={m} n={m.rows.length} empty="No medications yet" hint="Try “add med vitamin D 2000 IU morning”" />
      <LocalNote on={m.local} />
    </>)}
  </div>);
}

/* ───────── Communications ───────── */
const CH: Record<string, { label: string; link: string; icon: string }> = {
  mail: { label: "Mail", icon: "📬", link: "https://informeddelivery.usps.com/" },
  email: { label: "Email", icon: "✉", link: "https://mail.google.com/" },
  drive: { label: "Drive", icon: "🗂", link: "https://drive.google.com/" },
};
export function Comms({ log }: { log: Log }) {
  const [tab, setTab] = useState("Email"); const ch = tab.toLowerCase();
  const c = useRows("comms_notes", log); const [f, setF] = useState({ title: "", url: "", due_date: "" });
  const rows = c.rows.filter(r => r.channel === ch);
  return (<div>
    <Tabs tabs={["Mail", "Email", "Drive"]} cur={tab} set={setTab} />
    <div className="mb-2 flex items-center justify-between text-xs"><span className="text-ash">{ch === "mail" ? "Physical mail to handle" : ch === "email" ? "Emails to follow up" : "Docs & files to track"}</span><a href={CH[ch].link} target="_blank" rel="noopener noreferrer" className="text-cyan underline">Open {CH[ch].label} ↗</a></div>
    <form className="mb-2 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!f.title.trim()) return; c.add({ channel: ch, title: f.title.trim(), url: f.url || null, due_date: f.due_date || null }, `${CH[ch].label} item added`); setF({ title: "", url: "", due_date: "" }); }}>
      <input className="input min-w-[9rem] flex-1 text-sm" placeholder={ch === "mail" ? "e.g. Car registration renewal" : ch === "email" ? "e.g. Reply to Mr. L'Esperance" : "e.g. Tax docs folder"} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} aria-label="Item" />
      {ch !== "mail" && <input className="input w-36 text-sm" placeholder="Link (optional)" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} aria-label="Link" />}
      <input type="date" className="input w-auto text-sm" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} aria-label="Due" />
      <button className="btn btn-primary text-sm">Add</button>
    </form>
    <ul className="space-y-1">{rows.map(r => (<li key={r.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-cyan/5">
      <input type="checkbox" checked={!!r.done} onChange={() => c.set(r.id, { done: !r.done })} className="h-4 w-4 accent-[#3ef2e0]" aria-label={`Done ${r.title}`} />
      <span className={`flex-1 ${r.done ? "text-slate line-through" : "text-snow"}`}>{r.url && /^https?:\/\//.test(String(r.url)) ? <a href={String(r.url)} target="_blank" rel="noopener noreferrer" className="hover:text-cyan">{String(r.title)} ↗</a> : String(r.title)}</span>
      {r.due_date ? <span className={`text-xs ${!r.done && String(r.due_date) < today() ? "text-alert" : "text-ash"}`}>{fmtD(r.due_date)}</span> : null}
      <Del onClick={() => c.del(r.id)} label={String(r.title)} /></li>))}
</ul><State r={c} n={rows.length} empty="Nothing tracked here" hint="Try “email: reply to coach friday”" />
    <p className="mt-2 text-[10px] text-slate">Inbox and Drive sync need Gmail/Drive API consent (Google Cloud). Notes are tracked here meanwhile.</p>
    <LocalNote on={c.local} />
  </div>);
}

/* ───────── Finance ───────── */
type Quote = { symbol: string; price: number | null; changePct: number | null; error?: string };
export function Finance({ log }: { log: Log }) {
  const [tab, setTab] = useState("Bills");
  const b = useRows("bills", log); const s = useRows("stocks", log); const cr = useRows("credit_scores", log);
  const [bf, setBf] = useState({ name: "", amount: "", due_date: "" }); const [sf, setSf] = useState({ symbol: "", shares: "" }); const [score, setScore] = useState("");
  const [q, setQ] = useState<Record<string, Quote>>({});
  const [budget, setBudget] = useState(() => typeof window !== "undefined" ? Number(localStorage.getItem("crystal-budget") || 1500) : 1500);
  const ym = today().slice(0, 7); const monthSpend = b.rows.filter(r => String(r.due_date || "").startsWith(ym)).reduce((t, r) => t + Number(r.amount || 0), 0);
  const syms = useMemo(() => [...new Set(s.rows.map(r => String(r.symbol).toUpperCase()))].join(","), [s.rows]);
  useEffect(() => { if (tab !== "Stocks" || !syms) return; fetch(`/api/quote?symbols=${encodeURIComponent(syms)}`).then(r => r.json()).then((j: { quotes: Quote[] }) => setQ(Object.fromEntries(j.quotes.map(x => [x.symbol, x])))).catch(() => log("Quote uplink failed", "warn")); }, [tab, syms, log]);
  const unpaid = b.rows.filter(r => !r.paid).sort((x, y) => String(x.due_date || "9").localeCompare(String(y.due_date || "9")));
  const total = unpaid.reduce((t, r) => t + Number(r.amount || 0), 0);
  const scores = cr.rows.slice().sort((x, y) => String(x.checked_on).localeCompare(String(y.checked_on)));
  const port = s.rows.reduce((t, r) => t + (q[String(r.symbol).toUpperCase()]?.price ?? 0) * Number(r.shares || 0), 0);
  return (<div>
    <Tabs tabs={["Bills", "Credit", "Stocks"]} cur={tab} set={setTab} />
    {tab === "Bills" && (<>
      <div className="mb-2 flex items-center gap-2">
        <Gauge value={Math.max(0, budget - monthSpend)} max={budget} label="Budget left" unit="$" bands={[[budget * .25, "#ff3b5c"], [budget * .5, "#ffd166"], [1e12, "#7dffc8"]]} />
        <div className="flex-1 text-xs text-ash"><p>Unpaid: <span className="text-snow">{money(total)}</span> · {unpaid.filter(r => r.due_date && String(r.due_date) < today()).length} overdue</p>
          <label className="mt-1 flex items-center gap-1">Monthly budget $<input type="number" className="input w-24 !py-0.5 text-xs" value={budget} onChange={e => { const v = Math.max(1, Number(e.target.value) || 1); setBudget(v); localStorage.setItem("crystal-budget", String(v)); window.dispatchEvent(new Event("crystal-prefs")); }} aria-label="Monthly budget" /></label></div></div>
      <form className="mb-2 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!bf.name.trim()) return; b.add({ name: bf.name.trim(), amount: bf.amount ? Number(bf.amount) : null, due_date: bf.due_date || null }, `Bill added: ${bf.name}`); setBf({ name: "", amount: "", due_date: "" }); }}>
        <input className="input min-w-[8rem] flex-1 text-sm" placeholder="Bill" value={bf.name} onChange={e => setBf({ ...bf, name: e.target.value })} aria-label="Bill name" />
        <input className="input w-24 text-sm" type="number" step="0.01" placeholder="$" value={bf.amount} onChange={e => setBf({ ...bf, amount: e.target.value })} aria-label="Amount" />
        <input type="date" className="input w-auto text-sm" value={bf.due_date} onChange={e => setBf({ ...bf, due_date: e.target.value })} aria-label="Due date" />
        <button className="btn btn-primary text-sm">Add</button>
      </form>
      <ul className="space-y-1">{b.rows.slice().sort((x, y) => Number(x.paid) - Number(y.paid) || String(x.due_date || "9").localeCompare(String(y.due_date || "9"))).map(r => (<li key={r.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-cyan/5">
        <span className={`flex-1 ${r.paid ? "text-slate line-through" : "text-snow"}`}>{String(r.name)}</span>
        <span className="text-ash">{money(r.amount)}</span>
        {r.due_date ? <span className={`text-xs ${!r.paid && String(r.due_date) < today() ? "text-alert" : "text-ash"}`}>{fmtD(r.due_date)}</span> : null}
        <button onClick={() => b.set(r.id, { paid: !r.paid })} className={`rounded px-2 py-0.5 text-xs ${r.paid ? "bg-mint/20 text-mint" : "border border-cyan/40 text-cyan"}`}>{r.paid ? "Paid" : "Pay"}</button>
        <Del onClick={() => b.del(r.id)} label={String(r.name)} /></li>))}
</ul><State r={b} n={b.rows.length} empty="No bills yet" hint="Try “bill: water $45 due friday”" />
      <LocalNote on={b.local} />
    </>)}
    {tab === "Credit" && (<>
      {scores.length ? <div className="flex items-center gap-2"><Gauge value={Number(scores.at(-1)!.score)} min={300} max={850} label={Number(scores.at(-1)!.score) >= 740 ? "Excellent" : Number(scores.at(-1)!.score) >= 670 ? "Good" : Number(scores.at(-1)!.score) >= 580 ? "Fair" : "Poor"} bands={[[579, "#ff3b5c"], [669, "#ffd166"], [739, "#3ef2e0"], [900, "#7dffc8"]]} /><div className="min-w-0 flex-1"><Sparkline vals={scores.map(r => Number(r.score))} color="#7dffc8" /><p className="text-[10px] text-slate">Updated {fmtD(scores.at(-1)!.checked_on)}</p></div></div> : <State r={cr} n={0} empty="No score logged" hint="Try “credit score is 742”" />}
      <form className="my-2 flex gap-2" onSubmit={e => { e.preventDefault(); const v = Number(score); if (v < 300 || v > 850) return log("Score must be 300–850", "warn"); cr.add({ score: v, bureau: "manual", checked_on: today() }, `Credit score logged: ${v}`); setScore(""); }}>
        <input className="input text-sm" type="number" min={300} max={850} placeholder="Score (300–850)" value={score} onChange={e => setScore(e.target.value)} aria-label="Credit score" />
        <button className="btn btn-primary text-sm">Log</button>
      </form>
      <ul className="space-y-1 text-sm">{scores.slice().reverse().map(r => <li key={r.id} className="flex justify-between px-2"><span className="text-ash">{fmtD(r.checked_on)}</span><span className="text-snow">{String(r.score)}</span><Del onClick={() => cr.del(r.id)} label="score" /></li>)}</ul>
      <p className="mt-2 text-[10px] text-slate">Automatic bureau monitoring needs a credit-data provider account (e.g. Plaid/Array). Free reports: <a className="underline" href="https://www.annualcreditreport.com" target="_blank" rel="noopener noreferrer">annualcreditreport.com</a></p>
      <LocalNote on={cr.local} />
    </>)}
    {tab === "Stocks" && (<>
      <p className="mb-2 text-xs text-ash">Portfolio value: <span className="text-snow">{money(port)}</span></p>
      <form className="mb-2 flex gap-2" onSubmit={e => { e.preventDefault(); const sym = sf.symbol.trim().toUpperCase(); if (!/^[A-Z0-9.\-^=]{1,12}$/.test(sym)) return log("Invalid ticker", "warn"); s.add({ symbol: sym, shares: Number(sf.shares || 0) }, `Tracking ${sym}`); setSf({ symbol: "", shares: "" }); }}>
        <input className="input text-sm uppercase" placeholder="Ticker" value={sf.symbol} onChange={e => setSf({ ...sf, symbol: e.target.value })} aria-label="Ticker" />
        <input className="input w-24 text-sm" type="number" step="any" placeholder="Shares" value={sf.shares} onChange={e => setSf({ ...sf, shares: e.target.value })} aria-label="Shares" />
        <button className="btn btn-primary text-sm">Track</button>
      </form>
      <ul className="space-y-1">{s.rows.map(r => { const k = String(r.symbol).toUpperCase(); const x = q[k]; return (<li key={r.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-cyan/5">
        <span className="w-16 font-mono text-cyan">{k}</span><span className="flex-1 text-xs text-ash">{Number(r.shares || 0)} sh</span>
        <span className="text-snow">{x?.price != null ? money(x.price) : "…"}</span>
        {x?.changePct != null && <span className={`w-14 text-right text-xs ${x.changePct >= 0 ? "text-mint" : "text-alert"}`}>{x.changePct >= 0 ? "▲" : "▼"}{Math.abs(x.changePct).toFixed(2)}%</span>}
        <Del onClick={() => s.del(r.id)} label={k} /></li>); })}
</ul><State r={s} n={s.rows.length} empty="No tickers tracked" hint="Try “track 10 shares of AAPL”" />
      <p className="mt-2 text-[10px] text-slate">Quotes via Crystal&apos;s edge proxy, delayed, informational only.</p>
      <LocalNote on={s.local} />
    </>)}
  </div>);
}

/* ───────── Shopping ───────── */
export function Shopping({ log }: { log: Log }) {
  const [tab, setTab] = useState("Shopping list"); const li = tab === "Wish list" ? "wish" : "shopping";
  const s = useRows("shop_items", log); const [f, setF] = useState({ name: "", qty: "1", price: "", url: "" });
  const rows = s.rows.filter(r => r.list === li).sort((a, b) => Number(a.done) - Number(b.done));
  const est = rows.filter(r => !r.done).reduce((t, r) => t + Number(r.price || 0) * Number(r.qty || 1), 0);
  return (<div>
    <Tabs tabs={["Shopping list", "Wish list"]} cur={tab} set={setTab} />
    <form className="mb-2 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!f.name.trim()) return; s.add({ list: li, name: f.name.trim(), qty: Number(f.qty) || 1, price: f.price ? Number(f.price) : null, url: f.url || null }, `Added to ${tab.toLowerCase()}: ${f.name}`); setF({ name: "", qty: "1", price: "", url: "" }); }}>
      <input className="input min-w-[8rem] flex-1 text-sm" placeholder={li === "wish" ? "Wish item" : "Item"} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} aria-label="Item name" />
      {li === "shopping" ? <input className="input w-16 text-sm" type="number" min={1} value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} aria-label="Quantity" /> : <input className="input w-32 text-sm" placeholder="Link" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} aria-label="Link" />}
      <input className="input w-20 text-sm" type="number" step="0.01" placeholder="$" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} aria-label="Price" />
      <button className="btn btn-primary text-sm">Add</button>
    </form>
    <ul className="space-y-1">{rows.map(r => (<li key={r.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-cyan/5">
      <input type="checkbox" checked={!!r.done} onChange={() => s.set(r.id, { done: !r.done })} className="h-4 w-4 accent-[#3ef2e0]" aria-label={`Got ${r.name}`} />
      <span className={`flex-1 ${r.done ? "text-slate line-through" : "text-snow"}`}>{r.url && /^https?:\/\//.test(String(r.url)) ? <a href={String(r.url)} target="_blank" rel="noopener noreferrer" className="hover:text-cyan">{String(r.name)} ↗</a> : String(r.name)}{Number(r.qty) > 1 ? <span className="text-xs text-ash"> ×{String(r.qty)}</span> : null}</span>
      <span className="text-xs text-ash">{money(r.price)}</span>
      {li === "wish" && <button onClick={() => s.set(r.id, { list: "shopping" })} className="text-xs text-cyan" title="Move to shopping list">→🛒</button>}
      <Del onClick={() => s.del(r.id)} label={String(r.name)} /></li>))}
</ul><State r={s} n={rows.length} empty={li === "wish" ? "Wish list is empty" : "Shopping list is empty"} hint={li === "wish" ? "Try “add headphones to wish list”" : "Try “add milk to shopping list”"} />
    {est > 0 && <p className="mt-2 text-xs text-ash">Estimated: <span className="text-snow">{money(est)}</span></p>}
    <LocalNote on={s.local} />
  </div>);
}

/* ───────── School hub (portals, bells, calendar, check-ins) ───────── */
export function SchoolHub({ log }: { log: Log }) {
  const [tab, setTab] = useState("Bells");
  const [grade, setGrade] = useState<Grade>(() => (typeof window !== "undefined" && (localStorage.getItem("crystal-grade") as Grade)) || "6");
  const [now, setNow] = useState(new Date()); useEffect(() => { const i = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(i); }, []);
  const day = schoolDay(now); const sched = day.kind === "none" ? null : DMS.schedules[day.kind][grade];
  const mins = now.getHours() * 60 + now.getMinutes();
  const toM = (s: string) => { const [h, m] = s.split(":").map(Number); return (h < 7 ? h + 12 : h) * 60 + m; };
  const c = useRows("edu_checkins", log); const [cf, setCf] = useState({ title: "", note: "" }); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const upcoming = DMS_EVENTS.filter(e => e.end >= today()).slice(0, 12);
  return (<div>
    <Tabs tabs={["Bells", "Calendar", "Check-ins", "Portals"]} cur={tab} set={setTab} />
    {tab === "Bells" && (<>
      <div className="mb-2 flex items-center gap-2 text-xs"><span className="text-ash">{DMS.name} ·</span>
        <select className="input w-auto !py-0.5 text-xs" value={grade} onChange={e => { setGrade(e.target.value as Grade); localStorage.setItem("crystal-grade", e.target.value); }} aria-label="Grade">{(["6", "7", "8"] as Grade[]).map(g => <option key={g} value={g}>Grade {g}</option>)}</select>
        <span className="ml-auto text-cyan">{day.label}</span></div>
      {sched ? <table className="w-full text-sm"><tbody>{sched.map(([p, t]) => { const [a, b] = t.split("-"); const live = mins >= toM(a) && mins < toM(b); return (
        <tr key={p + t} className={live ? "bg-cyan/15 text-cyan" : "text-snow"}><td className="px-2 py-0.5">{live ? "▶ " : ""}{p}</td><td className="px-2 py-0.5 text-right font-mono text-xs text-ash">{t}</td></tr>); })}</tbody></table>
        : <p className="text-sm text-ash">No school today.</p>}
      <p className="mt-2 text-[10px] text-slate">Mon–Wed master · Thu–Fri flex block · early-release days auto-detected. Source: <a className="underline" href="https://cobbk12.org/dickerson/class-schedules" target="_blank" rel="noopener noreferrer">cobbk12.org/dickerson</a></p>
    </>)}
    {tab === "Calendar" && (<ul className="space-y-1 text-sm">{upcoming.map(e => <li key={e.start + e.title} className="flex gap-2 rounded px-2 py-1 hover:bg-cyan/5"><span className="w-28 shrink-0 text-xs text-ash">{fmtD(e.start)}{e.end !== e.start ? ` – ${fmtD(e.end)}` : ""}</span><span className={e.kind === "holiday" ? "text-mint" : e.kind === "early" ? "text-amber-200" : "text-snow"}>{e.title}</span></li>)}
      <li className="pt-1 text-[10px] text-slate">Cobb County School District 2026–27 calendar.</li></ul>)}
    {tab === "Check-ins" && (<>
      <form className="mb-2 space-y-2" onSubmit={async e => {
        e.preventDefault(); if (!cf.title.trim()) return; setBusy(true);
        try { let file_path: string | null = null; if (file) { const u = await uploadHandout(file); file_path = u.path; log(`Handout uploaded${u.local ? " (on-device)" : ""}: ${file.name}`, "ok"); }
          await c.add({ title: cf.title.trim(), note: cf.note || null, file_path, checkin_on: today() }, `Check-in saved: ${cf.title}`); setCf({ title: "", note: "" }); setFile(null); (e.target as HTMLFormElement).reset();
        } catch (err) { log(`Upload failed: ${(err as Error).message}`, "warn"); sfx("error"); } finally { setBusy(false); }
      }}>
        <input className="input text-sm" placeholder="Check-in title (e.g. Math unit 3 review)" value={cf.title} onChange={e => setCf({ ...cf, title: e.target.value })} aria-label="Check-in title" />
        <textarea className="input text-sm" rows={2} placeholder="Notes" value={cf.note} onChange={e => setCf({ ...cf, note: e.target.value })} aria-label="Notes" />
        <div className="flex items-center gap-2"><input type="file" accept="image/*,application/pdf,.doc,.docx" onChange={e => setFile(e.target.files?.[0] || null)} className="flex-1 text-xs text-ash file:mr-2 file:rounded file:border-0 file:bg-cyan/20 file:px-2 file:py-1 file:text-cyan" aria-label="Handout file" />
          <button className="btn btn-primary text-sm" disabled={busy}>{busy ? "…" : "Save"}</button></div>
      </form>
      <ul className="space-y-1">{c.rows.map(r => (<li key={r.id} className="rounded px-2 py-1 text-sm hover:bg-cyan/5"><div className="flex items-center gap-2">
        <span className="text-xs text-ash">{fmtD(r.checkin_on)}</span><span className="flex-1 text-snow">{String(r.title)}</span>
        {r.file_path ? <button className="text-xs text-cyan underline" onClick={() => handoutUrl(String(r.file_path)).then(u => window.open(u, "_blank", "noopener")).catch(e => log(String(e.message), "warn"))}>📎 handout</button> : null}
        <Del onClick={() => c.del(r.id)} label={String(r.title)} /></div>{r.note ? <p className="pl-14 text-xs text-ash">{String(r.note)}</p> : null}</li>))}
</ul><State r={c} n={c.rows.length} empty="No check-ins yet" hint="Snap a handout and save it here" />
      <LocalNote on={c.local} />
    </>)}
    {tab === "Portals" && (<ul className="grid grid-cols-2 gap-2">{PORTALS.map(p => <li key={p.name}><a href={p.url} target="_blank" rel="noopener noreferrer" className="glass block rounded-lg p-2 hover:border-cyan/50"><div className="text-sm font-semibold text-snow">{p.name} ↗</div><div className="text-[10px] text-ash">{p.note}</div></a></li>)}</ul>)}
  </div>);
}
