"use client";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/tasks";
import { addTask, deleteTask, updateTask, restoreTask } from "@/lib/tasks";
import { toast, undoableDelete, TrashBtn, Empty } from "@/components/ui/kit";
import { sfx } from "@/lib/synth";
import { SrcBadge } from "./ExtSync";
import { useExt, extDays, extTime, SRC } from "@/lib/ext";

export interface TaskProps { tasks: Task[]; reload: () => Promise<void>; log: (s: string, tone?: "info" | "ok" | "warn") => void }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = (d: string | null) => d ? new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
const PRI = ["", "text-alert", "text-cyan", "text-slate"];

/** Optimistic task delete with undo; deletes hit Supabase (RLS) and roll back on error. */
export function delTasks(gone: Task[], label: string, reload: () => Promise<void>, hide: (ids: string[] | null) => void) {
  const ids = gone.map(t => t.id);
  return undoableDelete(gone, { label, hide: () => hide(ids), rollback: () => hide(null), commit: t => deleteTask(t.id), restore: t => restoreTask(t), after: () => { reload().finally(() => hide(null)); } });
}
function useHidden() { const [h, setH] = useState<Set<string>>(new Set()); return [h, (ids: string[] | null) => setH(ids ? new Set(ids) : new Set())] as const; }

export function Priorities({ tasks, reload }: { tasks: Task[]; reload?: () => Promise<void> }) {
  const [hidden, hide] = useHidden();
  const top = tasks.filter(t => !t.done && !hidden.has(t.id)).sort((a, b) => a.priority - b.priority || (a.due_date || "9").localeCompare(b.due_date || "9")).slice(0, 3);
  if (!top.length) return <Empty title="No open missions" hint='Try "remind me Friday to pay the water bill" in the command bar ↑' mood="happy" />;
  return (<ol className="space-y-2">{top.map((t, i) => (
    <li key={t.id} data-swipe className="group flex items-center gap-3 rounded-lg border border-cyan/15 bg-navy-2/50 px-3 py-2">
      <span className="neon font-mono text-lg">{i + 1}</span>
      <span className="flex-1 text-[#E8F4FF]">{t.title}</span>
      {t.due_date && <span className={`text-xs ${t.due_date < today() ? "text-alert" : "text-ash"}`}>{fmt(t.due_date)}</span>}
      {reload && <><button data-done onClick={() => { sfx("success"); updateTask(t.id, { done: true }).then(reload).catch(e => toast((e as Error).message, "warn")); }} aria-label={`Complete ${t.title}`} className="tap grid h-7 w-7 place-items-center rounded-md text-mint hover:bg-mint/15">✓</button>
        <TrashBtn onClick={() => delTasks([t], `Deleted "${t.title}"`, reload, hide)} label={t.title} /></>}
    </li>))}</ol>);
}

export function TaskList({ tasks, reload, log }: TaskProps) {
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [pri, setPri] = useState(2);
  const [edit, setEdit] = useState<string | null>(null); const [editText, setEditText] = useState("");
  const [hidden, hide] = useHidden(); const [sel, setSel] = useState<Set<string> | null>(null); const [doneOv, setDoneOv] = useState<Record<string, boolean>>({});
  const view = tasks.filter(t => !hidden.has(t.id)).map(t => t.id in doneOv ? { ...t, done: doneOv[t.id] } : t);
  useEffect(() => { setDoneOv({}); }, [tasks]);
  const wrap = async (fn: () => Promise<void>, ok: string) => { try { await fn(); await reload(); log(ok, "ok"); } catch (e) { log(`Error: ${(e as Error).message}`, "warn"); toast((e as Error).message, "warn"); sfx("error"); } };
  const toggle = (t: Task) => { sfx(t.done ? "click" : "success"); setDoneOv(o => ({ ...o, [t.id]: !t.done })); updateTask(t.id, { done: !t.done }).then(() => { log(t.done ? `Reopened: ${t.title}` : `Mission complete: ${t.title}`, "ok"); return reload(); }).catch(e => { setDoneOv(o => { const n = { ...o }; delete n[t.id]; return n; }); toast(`Couldn't update: ${(e as Error).message}`, "warn"); }); };
  const del = (gone: Task[], label: string) => { if (!gone.length) return; setSel(null); delTasks(gone, label, reload, hide); log(label, "info"); };
  const completed = view.filter(t => t.done);
  return (<div className="space-y-3">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!title.trim()) return; const t = title.trim(); wrap(() => addTask({ title: t, due_date: due || null, priority: pri }), `Task added: ${t}`); setTitle(""); setDue(""); sfx("success"); }}>
      <input className="input min-w-[10rem] flex-1 text-sm" placeholder="Quick add a task…" value={title} onChange={e => setTitle(e.target.value)} aria-label="Task title" />
      <input type="date" className="input w-auto text-sm" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" />
      <select className="input w-auto text-sm" value={pri} onChange={e => setPri(+e.target.value)} aria-label="Priority"><option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option></select>
      <button className="btn btn-primary text-sm">Add</button>
    </form>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button className="btn btn-ghost !py-1 text-xs" aria-pressed={!!sel} onClick={() => setSel(s => s ? null : new Set())}>{sel ? "Cancel select" : "☐ Select"}</button>
      {sel && <><button className="btn btn-ghost !py-1 text-xs" onClick={() => setSel(new Set(view.map(t => t.id)))}>Select All</button>
        <button className="btn !py-1 text-xs border border-alert/60 text-alert disabled:opacity-40" disabled={!sel.size} onClick={() => del(view.filter(t => sel.has(t.id)), `Deleted ${sel.size} task${sel.size > 1 ? "s" : ""}`)}>🗑 Delete Selected ({sel.size})</button></>}
      {completed.length > 0 && <button className="btn btn-ghost !py-1 text-xs ml-auto" onClick={() => del(completed, `Cleared ${completed.length} completed`)}>🧹 Clear Completed ({completed.length})</button>}
    </div>
    <ul className="space-y-1" aria-label="To-do list">{view.map(t => (
      <li key={t.id} data-swipe className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cyan/5">
        {sel ? <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel(s => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} aria-label={`Select ${t.title}`} className="h-4 w-4 accent-[#ff3b5c]" />
          : <input type="checkbox" data-done checked={t.done} onChange={() => toggle(t)} aria-label={`Mark ${t.title} done`} className="h-4 w-4 accent-[#3ef2e0]" />}
        <span className={`font-mono text-xs ${PRI[t.priority]}`}>{"!".repeat(4 - t.priority)}</span>
        {edit === t.id ? (
          <form className="flex-1" onSubmit={e => { e.preventDefault(); wrap(() => updateTask(t.id, { title: editText.trim() || t.title }), "Task updated"); setEdit(null); }}>
            <input autoFocus className="input py-1 text-sm" value={editText} onChange={e => setEditText(e.target.value)} onBlur={() => setEdit(null)} aria-label="Edit task" />
          </form>
        ) : (<button className={`flex-1 text-left ${t.done ? "text-[var(--text-muted)] line-through" : "text-[#E8F4FF]"}`} onDoubleClick={() => { setEdit(t.id); setEditText(t.title); }} title="Double-Click to Edit">{t.title}</button>)}
        {t.due_date && <span className={`text-xs ${!t.done && t.due_date < today() ? "text-alert" : "text-ash"}`}>{fmt(t.due_date)}</span>}
        <button onClick={() => { setEdit(t.id); setEditText(t.title); }} aria-label={`Edit ${t.title}`} className="del-btn tap grid h-7 w-7 place-items-center rounded-md text-[var(--text-muted)] hover:text-cyan">✎</button>
        <SrcBadge src="local" />
        <TrashBtn onClick={() => del([t], `Deleted "${t.title}"`)} label={t.title} />
      </li>))}
      {!view.length && <li><Empty title="No tasks yet" hint="Add one above, or say “remind me tomorrow to…”" /></li>}
    </ul>
    <p className="text-[11px] text-[var(--text-muted)] sm:hidden">Tip: swipe left to delete, right to complete.</p>
  </div>);
}

const WMO: Record<number, [string, string]> = { 0: ["☀", "Clear"], 1: ["🌤", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁", "Overcast"], 45: ["🌫", "Fog"], 48: ["🌫", "Fog"], 51: ["🌦", "Drizzle"], 53: ["🌦", "Drizzle"], 55: ["🌦", "Drizzle"], 61: ["🌧", "Rain"], 63: ["🌧", "Rain"], 65: ["🌧", "Heavy rain"], 71: ["🌨", "Snow"], 73: ["🌨", "Snow"], 75: ["❄", "Heavy snow"], 80: ["🌦", "Showers"], 81: ["🌧", "Showers"], 82: ["⛈", "Heavy showers"], 95: ["⛈", "Thunderstorm"], 96: ["⛈", "Thunderstorm"], 99: ["⛈", "Thunderstorm"] };
interface Wx { current: { temperature_2m: number; weather_code: number; wind_speed_10m: number }; daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } }
export function Weather() {
  const [wx, setWx] = useState<Wx | null>(null); const [place, setPlace] = useState("Marietta, GA"); const [err, setErr] = useState("");
  useEffect(() => {
    const load = (lat: number, lon: number) => fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5`).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(j => { if (j?.current) setWx(j); else setErr("Weather data unavailable."); }).catch(() => setErr("Weather uplink failed. Retry when online."));
    load(33.9526, -84.5499);
    navigator.geolocation?.getCurrentPosition(p => { setPlace("Your location"); load(p.coords.latitude, p.coords.longitude); }, () => {}, { timeout: 5000, maximumAge: 3600000 });
  }, []);
  if (err) return <p className="text-sm text-alert">{err}</p>;
  if (!wx) return <p className="text-sm text-ash">Scanning atmosphere…</p>;
  const [ic, label] = WMO[wx.current.weather_code] || ["·", "—"];
  return (<div>
    <div className="flex items-center gap-4"><span className="text-5xl">{ic}</span><div><div className="text-3xl font-semibold text-snow">{Math.round(wx.current.temperature_2m)}°F</div><div className="text-xs text-ash">{label} · wind {Math.round(wx.current.wind_speed_10m)} mph · {place}</div></div></div>
    <div className="mt-3 grid grid-cols-5 gap-1 text-center text-xs">{wx.daily.time.map((d, i) => (
      <div key={d} className="rounded-lg bg-navy-2/50 py-2"><div className="text-slate">{new Date(d + "T12:00").toLocaleDateString([], { weekday: "short" })}</div><div className="text-lg">{(WMO[wx.daily.weather_code[i]] || ["·"])[0]}</div><div className="text-snow">{Math.round(wx.daily.temperature_2m_max[i])}°</div><div className="text-slate">{Math.round(wx.daily.temperature_2m_min[i])}°</div><div className="text-cyan">{wx.daily.precipitation_probability_max[i]}%</div></div>
    ))}</div>
    <p className="mt-2 text-[10px] text-slate">Weather data by Open-Meteo.com</p>
  </div>);
}

export function Calendar({ tasks }: { tasks: Task[] }) {
  const [off, setOff] = useState(0); const [ext] = useExt(); const [sel, setSel] = useState<string | null>(null);
  type C = { id: string; title: string; color: string; done: boolean; time: string; src: string };
  const byDay = useMemo(() => { const m = new Map<string, C[]>(); const add = (k: string, c: C) => { const a = m.get(k) ?? []; a.push(c); m.set(k, a); };
    tasks.forEach(t => t.due_date && add(t.due_date, { id: t.id, title: t.title, color: SRC.local.color, done: t.done, time: "", src: SRC.local.label }));
    ext.forEach(x => extDays(x).forEach(k => add(k, { id: x.id + k, title: x.title, color: SRC[x.source].color, done: x.kind === "task" && (x.pending_action ? x.pending_action === "complete" : x.done), time: extTime(x), src: SRC[x.source].label + (x.kind === "task" ? " to-do" : "") })));
    return m; }, [tasks, ext]);
  const { cells, label } = useMemo(() => {
    const n = new Date(); const first = new Date(n.getFullYear(), n.getMonth() + off, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return { d, k, inMonth: d.getMonth() === first.getMonth(), items: byDay.get(k) ?? [] }; });
    return { cells, label: first.toLocaleDateString([], { month: "long", year: "numeric" }) };
  }, [off, byDay]);
  const t0 = today(); const detail = sel ? byDay.get(sel) ?? [] : [];
  return (<div>
    <div className="mb-2 flex items-center justify-between"><button onClick={() => setOff(o => o - 1)} className="btn btn-ghost !py-1 text-xs" aria-label="Previous Month">‹</button><span className="font-semibold text-snow">{label}</span><button onClick={() => setOff(o => o + 1)} className="btn btn-ghost !py-1 text-xs" aria-label="Next Month">›</button></div>
    <div className="grid grid-cols-7 gap-px text-[10px]">
      {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1 text-center text-slate">{d}</div>)}
      {cells.map(c => (<button type="button" key={c.k} onClick={() => setSel(c.k)} aria-label={`${c.k}: ${c.items.length} items`} className={`min-h-[52px] rounded p-1 text-left ${c.inMonth ? "bg-navy-2/50" : "opacity-40"} ${c.k === t0 ? "neon-border" : ""} ${sel === c.k ? "ring-1 ring-cyan" : ""}`}>
        <div className={c.k === t0 ? "text-cyan" : "text-ash"}>{c.d.getDate()}</div>
        {c.items.slice(0, 2).map(t => <div key={t.id} data-tip={t.title} className={`cal-chip rounded px-0.5 ${t.done ? "line-through opacity-60" : ""}`} style={{ color: t.color, background: t.color + "22" }} title={`${t.title} (${t.src})`}>{t.title}</div>)}
        {c.items.length > 2 && <div className="text-slate">+{c.items.length - 2}</div>}
      </button>))}
    </div>
    {sel && <div className="mt-2 rounded-lg bg-[#060b18] p-2 text-sm"><div className="font-semibold">{new Date(sel + "T12:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</div>
      {detail.length ? <ul className="mt-1 space-y-0.5">{detail.map(x => <li key={x.id} className="flex items-start gap-2"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: x.color }} /><span className={x.done ? "line-through opacity-60" : ""}>{x.time && <span className="text-ash">{x.time} </span>}{x.title} <span className="text-xs" style={{ color: x.color }}>({x.src})</span></span></li>)}</ul> : <p className="text-ash">Nothing scheduled.</p>}</div>}
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{(Object.keys(SRC) as (keyof typeof SRC)[]).map(k => <li key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SRC[k].color }} />{SRC[k].label}</li>)}</ul>
  </div>);
}

export function ComingSoon({ name, items }: { name: string; items: string[] }) {
  return (<div className="text-center"><div className="hud-label mb-2">Module offline</div><p className="text-lg text-snow">{name} is coming soon</p><ul className="mt-3 flex flex-wrap justify-center gap-2">{items.map(i => <li key={i} className="rounded-full border border-slate/50 px-3 py-1 text-xs text-ash">{i}</li>)}</ul></div>);
}
