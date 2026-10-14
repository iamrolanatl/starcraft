"use client";
import { useEffect, useMemo, useState } from "react";
import type { Task } from "@/lib/tasks";
import { addTask, deleteTask, updateTask } from "@/lib/tasks";
import { sfx } from "@/lib/synth";

export interface TaskProps { tasks: Task[]; reload: () => Promise<void>; log: (s: string, tone?: "info" | "ok" | "warn") => void }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmt = (d: string | null) => d ? new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
const PRI = ["", "text-alert", "text-cyan", "text-slate"];

export function Priorities({ tasks }: { tasks: Task[] }) {
  const top = tasks.filter(t => !t.done).sort((a, b) => a.priority - b.priority || (a.due_date || "9").localeCompare(b.due_date || "9")).slice(0, 3);
  if (!top.length) return <p className="text-sm text-ash">No open missions. Add one in the command bar ↑</p>;
  return (<ol className="space-y-2">{top.map((t, i) => (
    <li key={t.id} className="flex items-center gap-3 rounded-lg border border-cyan/15 bg-navy-2/50 px-3 py-2">
      <span className="neon font-mono text-lg">{i + 1}</span>
      <span className="flex-1 text-snow">{t.title}</span>
      {t.due_date && <span className={`text-xs ${t.due_date < today() ? "text-alert" : "text-ash"}`}>{fmt(t.due_date)}</span>}
    </li>))}</ol>);
}

export function TaskList({ tasks, reload, log }: TaskProps) {
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [pri, setPri] = useState(2);
  const [edit, setEdit] = useState<string | null>(null); const [editText, setEditText] = useState("");
  const wrap = async (fn: () => Promise<void>, ok: string) => { try { await fn(); await reload(); log(ok, "ok"); } catch (e) { log(`Error: ${(e as Error).message}`, "warn"); sfx("error"); } };
  return (<div className="space-y-3">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (!title.trim()) return; const t = title.trim(); wrap(() => addTask({ title: t, due_date: due || null, priority: pri }), `Task added: ${t}`); setTitle(""); setDue(""); sfx("success"); }}>
      <input className="input min-w-[10rem] flex-1 text-sm" placeholder="New task" value={title} onChange={e => setTitle(e.target.value)} aria-label="Task title" />
      <input type="date" className="input w-auto text-sm" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" />
      <select className="input w-auto text-sm" value={pri} onChange={e => setPri(+e.target.value)} aria-label="Priority"><option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option></select>
      <button className="btn btn-primary text-sm">Add</button>
    </form>
    <ul className="space-y-1">{tasks.map(t => (
      <li key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cyan/5">
        <input type="checkbox" checked={t.done} onChange={() => { sfx(t.done ? "click" : "success"); wrap(() => updateTask(t.id, { done: !t.done }), t.done ? `Reopened: ${t.title}` : `Mission complete: ${t.title}`); }} aria-label={`Mark ${t.title} done`} className="h-4 w-4 accent-[#3ef2e0]" />
        <span className={`font-mono text-xs ${PRI[t.priority]}`}>{"!".repeat(4 - t.priority)}</span>
        {edit === t.id ? (
          <form className="flex-1" onSubmit={e => { e.preventDefault(); wrap(() => updateTask(t.id, { title: editText.trim() || t.title }), "Task updated"); setEdit(null); }}>
            <input autoFocus className="input py-1 text-sm" value={editText} onChange={e => setEditText(e.target.value)} onBlur={() => setEdit(null)} aria-label="Edit task" />
          </form>
        ) : (<button className={`flex-1 text-left text-sm ${t.done ? "text-slate line-through" : "text-snow"}`} onDoubleClick={() => { setEdit(t.id); setEditText(t.title); }} title="Double-click to edit">{t.title}</button>)}
        {t.due_date && <span className={`text-xs ${!t.done && t.due_date < today() ? "text-alert" : "text-ash"}`}>{fmt(t.due_date)}</span>}
        <button onClick={() => { setEdit(t.id); setEditText(t.title); }} aria-label={`Edit ${t.title}`} className="text-xs text-slate opacity-60 hover:text-cyan group-hover:opacity-100">✎</button>
        <button onClick={() => { sfx("close"); wrap(() => deleteTask(t.id), `Deleted: ${t.title}`); }} aria-label={`Delete ${t.title}`} className="text-xs text-slate opacity-60 hover:text-alert group-hover:opacity-100">✕</button>
      </li>))}
      {!tasks.length && <li className="text-sm text-ash">No tasks yet.</li>}
    </ul>
  </div>);
}

const WMO: Record<number, [string, string]> = { 0: ["☀", "Clear"], 1: ["🌤", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁", "Overcast"], 45: ["🌫", "Fog"], 48: ["🌫", "Fog"], 51: ["🌦", "Drizzle"], 53: ["🌦", "Drizzle"], 55: ["🌦", "Drizzle"], 61: ["🌧", "Rain"], 63: ["🌧", "Rain"], 65: ["🌧", "Heavy rain"], 71: ["🌨", "Snow"], 73: ["🌨", "Snow"], 75: ["❄", "Heavy snow"], 80: ["🌦", "Showers"], 81: ["🌧", "Showers"], 82: ["⛈", "Heavy showers"], 95: ["⛈", "Thunderstorm"], 96: ["⛈", "Thunderstorm"], 99: ["⛈", "Thunderstorm"] };
interface Wx { current: { temperature_2m: number; weather_code: number; wind_speed_10m: number }; daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } }
export function Weather() {
  const [wx, setWx] = useState<Wx | null>(null); const [place, setPlace] = useState("Marietta, GA"); const [err, setErr] = useState("");
  useEffect(() => {
    const load = (lat: number, lon: number) => fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=5`).then(r => r.json()).then(setWx).catch(() => setErr("Weather uplink failed."));
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
  const [off, setOff] = useState(0);
  const { cells, label } = useMemo(() => {
    const n = new Date(); const first = new Date(n.getFullYear(), n.getMonth() + off, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return { d, k, inMonth: d.getMonth() === first.getMonth(), items: tasks.filter(t => t.due_date === k) }; });
    return { cells, label: first.toLocaleDateString([], { month: "long", year: "numeric" }) };
  }, [off, tasks]);
  const t0 = today();
  return (<div>
    <div className="mb-2 flex items-center justify-between"><button onClick={() => setOff(o => o - 1)} className="btn btn-ghost !py-1 text-xs" aria-label="Previous month">‹</button><span className="font-semibold text-snow">{label}</span><button onClick={() => setOff(o => o + 1)} className="btn btn-ghost !py-1 text-xs" aria-label="Next month">›</button></div>
    <div className="grid grid-cols-7 gap-px text-[10px]">
      {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1 text-center text-slate">{d}</div>)}
      {cells.map(c => (<div key={c.k} className={`min-h-[52px] rounded p-1 ${c.inMonth ? "bg-navy-2/50" : "opacity-40"} ${c.k === t0 ? "neon-border" : ""}`}>
        <div className={c.k === t0 ? "text-cyan" : "text-ash"}>{c.d.getDate()}</div>
        {c.items.slice(0, 2).map(t => <div key={t.id} className={`truncate rounded px-0.5 ${t.done ? "text-slate line-through" : "bg-cyan/15 text-ice"}`} title={t.title}>{t.title}</div>)}
        {c.items.length > 2 && <div className="text-slate">+{c.items.length - 2}</div>}
      </div>))}
    </div>
  </div>);
}

export function ComingSoon({ name, items }: { name: string; items: string[] }) {
  return (<div className="text-center"><div className="hud-label mb-2">Module offline</div><p className="text-lg text-snow">{name} is coming soon</p><ul className="mt-3 flex flex-wrap justify-center gap-2">{items.map(i => <li key={i} className="rounded-full border border-slate/50 px-3 py-1 text-xs text-ash">{i}</li>)}</ul></div>);
}
