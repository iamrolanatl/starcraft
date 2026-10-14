"use client";
import { useEffect, useMemo, useState } from "react";
import { loadEducation, type EduData, type GradeRow } from "@/lib/education";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => d ? new Date(d.length === 10 ? d + "T12:00" : d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—";
const tone = (p: number | null) => p == null ? "text-slate" : p >= 90 ? "text-mint" : p >= 80 ? "text-cyan" : p >= 70 ? "text-amber-300" : "text-alert";
const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
type Tab = "grades" | "work" | "comms" | "calendar";

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return <span className="inline-block w-16 text-[10px] text-slate">no trend</span>;
  const lo = Math.min(...pts) - 2, hi = Math.max(...pts) + 2, w = 64, h = 18;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - lo) / (hi - lo || 1)) * h}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return <svg width={w} height={h} aria-hidden className="overflow-visible"><polyline points={d} fill="none" stroke={up ? "#7dffc8" : "#ff3b5c"} strokeWidth="1.6" style={{ filter: "drop-shadow(0 0 3px currentColor)" }} /></svg>;
}

export default function Education({ demo, log }: { demo: boolean; log: (s: string, t?: "info" | "ok" | "warn") => void }) {
  const [data, setData] = useState<EduData | null | undefined>(undefined); const [err, setErr] = useState(""); const [tab, setTab] = useState<Tab>("grades");
  useEffect(() => { loadEducation(demo).then(d => { setData(d); if (d) log(`Education uplink: ${d.student.name}, synced ${ago(d.student.last_synced_at)}.`, "ok"); }).catch(e => { setErr((e as Error).message); log(`Education: ${(e as Error).message}`, "warn"); }); }, [demo, log]);

  const rows = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, GradeRow[]>(); data.grades.forEach(g => by.set(g.course_key, [...(by.get(g.course_key) || []), g]));
    return [...by.values()].map(gs => {
      const cur = [...gs].reverse().find(g => !g.is_final && g.term === data.student.reporting_period?.name) || gs[gs.length - 1];
      const fin = [...gs].reverse().find(g => g.is_final);
      const pts = gs.filter(g => g.percent != null).map(g => Number(g.percent));
      return { cur, fin, pts };
    }).sort((a, b) => Number(a.cur.period ?? 9) - Number(b.cur.period ?? 9));
  }, [data]);

  if (err) return <p className="text-sm text-alert">{err}</p>;
  if (data === undefined) return <p className="text-sm text-ash">Linking to school uplink…</p>;
  if (data === null) return <p className="text-sm text-ash">No school data yet. The box sync fills this after your next ParentVUE pull.</p>;
  const missing = data.assignments.filter(a => a.missing || a.zero);
  const upcoming = data.assignments.filter(a => !a.missing && a.due_date && a.due_date >= today()).slice(0, 12);
  const cal = data.calendar.filter(c => c.date >= today()).slice(0, 14);
  const at = data.student.attendance_totals || {};
  const TABS: [Tab, string, number?][] = [["grades", "Grades"], ["work", "Work", missing.length], ["comms", "Messages", data.messages.filter(m => m.unread).length], ["calendar", "Calendar"]];

  return (<div className="space-y-3 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ash">
      <span className="font-semibold text-snow">{data.student.name}</span><span>Gr {Number(data.student.grade) || data.student.grade}</span><span className="truncate">{data.student.school}</span>
      <span className="text-cyan">{data.student.reporting_period?.name}</span>
      <span className="ml-auto" title={data.student.last_fetched_at ?? ""}>⟳ {ago(data.student.last_fetched_at)}</span>
      {data.demo && <span className="rounded bg-amber-300/15 px-1.5 text-amber-200">demo data</span>}
    </div>
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-navy-2/60 py-1.5"><div className="hud-label">Missing</div><div className={`font-mono text-lg ${missing.length ? "text-alert" : "text-mint"}`}>{missing.length}</div></div>
      <div className="rounded-lg bg-navy-2/60 py-1.5"><div className="hud-label">Due soon</div><div className="font-mono text-lg text-cyan">{upcoming.length}</div></div>
      <div className="rounded-lg bg-navy-2/60 py-1.5"><div className="hud-label">Absent / tardy</div><div className="font-mono text-lg text-snow">{(at.excused ?? 0) + (at.unexcused ?? 0)} / {at.tardies ?? 0}</div></div>
    </div>
    <div role="tablist" className="flex gap-1 border-b border-cyan/15">
      {TABS.map(([id, label, n]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-2 py-1 text-xs ${tab === id ? "border-cyan text-cyan" : "border-transparent text-ash hover:text-snow"}`}>{label}{n ? <span className="ml-1 rounded-full bg-alert/30 px-1.5 text-[10px] text-snow">{n}</span> : null}</button>)}
    </div>
    {tab === "grades" && <ul className="space-y-1">{rows.map(({ cur, fin, pts }) => (
      <li key={cur.course_key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cyan/5">
        <span className="w-4 font-mono text-[10px] text-slate">{cur.period}</span>
        <div className="min-w-0 flex-1"><div className="truncate text-snow">{cur.course}</div><div className="truncate text-[10px] text-slate">{cur.teacher}{fin && fin !== cur ? ` · ${fin.term} final ${fin.mark}` : ""}</div></div>
        <Spark pts={pts} />
        <span className={`w-12 text-right font-mono ${tone(cur.percent)}`}>{cur.percent != null ? `${Number(cur.percent).toFixed(cur.percent % 1 ? 1 : 0)}` : (cur.mark ?? "—")}</span>
      </li>))}</ul>}
    {tab === "work" && <div className="space-y-2">
      {missing.length > 0 && <div><div className="hud-label mb-1 text-alert">Missing / zero</div><ul className="space-y-1">{missing.map(a => <li key={a.source + a.ext_id} className="rounded-lg border border-alert/30 bg-alert/10 px-2 py-1"><div className="text-snow">{a.name}</div><div className="text-[10px] text-ash">{a.course} · due {fmt(a.due_date)} · {a.score_display}</div></li>)}</ul></div>}
      <div><div className="hud-label mb-1">Upcoming</div><ul className="space-y-1">{upcoming.map(a => <li key={a.source + a.ext_id} className="flex items-center gap-2 rounded-lg bg-navy-2/50 px-2 py-1"><div className="min-w-0 flex-1"><div className="truncate text-snow">{a.name}</div><div className="truncate text-[10px] text-ash">{a.course} · {a.source}</div></div><span className="text-xs text-cyan">{fmt(a.due_date)}</span></li>)}{!upcoming.length && <li className="text-xs text-ash">Nothing due.</li>}</ul></div>
    </div>}
    {tab === "comms" && <ul className="space-y-1">{data.messages.slice(0, 25).map(m => <li key={m.source + m.ext_id} className="rounded-lg bg-navy-2/50 px-2 py-1">
      <div className="flex items-center gap-2"><span className="rounded bg-cyan/10 px-1 text-[9px] uppercase text-cyan">{m.source}</span><span className={`flex-1 truncate ${m.unread ? "font-semibold text-snow" : "text-ice"}`}>{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.subject}</a> : m.subject}</span><span className="text-[10px] text-slate">{fmt(m.sent_at)}</span></div>
      <div className="truncate text-[10px] text-ash">{m.sender}{m.body ? ` — ${m.body}` : ""}</div></li>)}{!data.messages.length && <li className="text-xs text-ash">No messages.</li>}</ul>}
    {tab === "calendar" && <ul className="space-y-1">{cal.map(c => <li key={c.date + c.title} className="flex gap-2 rounded-lg bg-navy-2/50 px-2 py-1"><span className="w-20 shrink-0 font-mono text-xs text-cyan">{fmt(c.date)}</span><span className="text-snow">{c.title.replace(/\s+-\s+Score:\s*-?$/, "")}</span></li>)}{!cal.length && <li className="text-xs text-ash">No upcoming school events.</li>}</ul>}
  </div>);
}
