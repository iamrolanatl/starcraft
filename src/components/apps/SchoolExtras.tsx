"use client";
import { useEffect, useState } from "react";
import { loadSchedule, loadAbsences, type Sched, type AbsP } from "@/lib/schoolx";
import { bellFor, hm, fmt12, BELL_SOURCE } from "@/lib/bell";
import { DISTRICT } from "@/lib/school";
import { eventsOn, isNoSchool } from "@/lib/district";

const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fd = (d: string) => new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const Missing = () => <p className="text-xs text-ash">Not set up yet (migration 014 needs to be run).</p>;

export function Schedule({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<Sched[] | "missing" | null>(null); const [now, setNow] = useState(() => new Date());
  useEffect(() => { loadSchedule(demo).then(setRows).catch(() => setRows([])); }, [demo]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  if (rows === null) return <p className="text-xs text-ash">Loading schedule…</p>;
  if (rows === "missing") return <Missing />;
  const term = rows[0]?.term; const cur = rows.filter(r => r.term === term).sort((a, b) => a.period - b.period);
  const day = ymdLocal(now); const off = isNoSchool(day, DISTRICT.events); const early = eventsOn(day, DISTRICT.events).some(e => e.cat === "early_release");
  const bell = bellFor(now, early); const t = hm(now);
  const live = off ? null : bell.slots.find(s => t >= s.start && t < s.end) ?? null;
  const next = off ? null : bell.slots.find(s => s.start > t) ?? null;
  return (<div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan/20 bg-navy-2/60 px-2 py-1.5 text-xs">
      <span className="text-cyan">{off ? "No school today" : live ? `Now: ${live.label}` : next ? `Next: ${next.label} at ${fmt12(next.start)}` : "School day over"}</span>
      {!off && <span className="text-ash">· {bell.name} bell schedule</span>}
      <a className="ml-auto text-[10px] text-slate underline" href={BELL_SOURCE} target="_blank" rel="noreferrer">bell times: Dickerson site</a>
    </div>
    {!cur.length ? <p className="text-xs text-ash">No schedule in the latest pull yet.</p> :
    <ul className="space-y-1" aria-label={`Class schedule ${term}`}>{cur.map(c => {
      const slot = bell.slots.find(s => s.period === c.period); const isNow = !!live && live.period === c.period;
      return <li key={c.period + c.course} aria-current={isNow ? "true" : undefined} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isNow ? "border border-cyan bg-cyan/15 shadow-[0_0_12px_rgba(0,255,255,.35)]" : "bg-navy-2/50"}`}>
        <span className="w-5 font-mono text-xs text-cyan">{c.period}</span>
        <div className="min-w-0 flex-1"><div className="break-words text-snow">{c.course}{isNow && <span className="ml-2 rounded bg-cyan/30 px-1 text-[10px] text-snow">NOW</span>}</div>
          <div className="text-[10px] text-ash">{c.teacher}{c.teacher_email && <> · <a className="underline" href={`mailto:${c.teacher_email}`}>{c.teacher_email}</a></>}</div></div>
        <div className="shrink-0 text-right text-[10px]"><div className="text-snow">Room {c.room ?? "—"}</div>{slot && !off && <div className="font-mono text-slate">{fmt12(slot.start)}–{fmt12(slot.end)}</div>}</div>
      </li>; })}</ul>}
    {term && <p className="text-[10px] text-slate">Term {term} · from ParentVUE.</p>}
  </div>);
}

export function AttendanceTab({ demo, totals }: { demo: boolean; totals: Record<string, number> }) {
  const [rows, setRows] = useState<AbsP[] | "missing" | null>(null);
  useEffect(() => { loadAbsences(demo).then(setRows).catch(() => setRows([])); }, [demo]);
  const T = [["Excused", totals.excused], ["Unexcused", totals.unexcused], ["Tardies", totals.tardies], ["Activities", totals.activities]] as const;
  return (<div className="space-y-2">
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{T.map(([k, v]) => <div key={k} className="rounded-lg bg-navy-2/60 py-1.5 text-center"><div className="hud-label">{k}</div><div className="font-mono text-lg text-snow">{v ?? "—"}</div></div>)}</div>
    {rows === null ? <p className="text-xs text-ash">Loading…</p> : rows === "missing" ? <Missing /> : !rows.length ? <p className="text-xs text-ash">No absences recorded in ParentVUE.</p> :
      <ul className="space-y-1.5">{[...new Set(rows.map(r => r.date))].map(day => { const rs = rows.filter(r => r.date === day).sort((a, b) => a.period - b.period); return <li key={day} className="rounded-lg border border-cyan/10 bg-navy-2/50 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-snow">{fd(day)}</span><span className="rounded bg-amber-300/15 px-1.5 text-amber-200">{rs[0].reason || rs[0].code}</span><span className="text-ash">{rs.length} period{rs.length > 1 ? "s" : ""}</span></div>
        {rs[0].note && <div className="text-[11px] italic text-ice">“{rs[0].note}”</div>}
        <div className="mt-1 flex flex-wrap gap-1">{rs.map(r => <span key={r.period} title={`${r.course ?? ""} · ${r.teacher ?? ""}`} className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-ash">P{r.period} {r.course}</span>)}</div>
      </li>; })}</ul>}
    <p className="text-[10px] text-slate">Source: ParentVUE attendance.</p>
  </div>);
}

const BLOCKED: [string, string, string][] = [
  ["Tests & scores", "MAP, Georgia Milestones, CogAT", "StudentTestInfo returns an error for Cobb"],
  ["Discipline", "Incidents and actions", "Cobb has the Discipline module turned off"],
  ["Documents", "School-posted documents", "\"Documents not available for this school\""],
  ["Fees & lunch", "Fees, lunch balance", "StudentFeeInfo returns an error; lunch is on MySchoolBucks"],
  ["School contacts", "Counselor, homeroom, locker, emergency contacts", "StudentInfo returns an error for Cobb"],
  ["School info", "Principal, phone", "Cobb has the School Information module turned off"],
];
export function Unavailable() {
  return (<div><div className="hud-label mb-1">Not available from Cobb</div><ul className="grid gap-1.5 sm:grid-cols-2">{BLOCKED.map(([t, what, why]) =>
    <li key={t} className="rounded-lg border border-slate/30 bg-navy-2/40 px-2 py-1.5 opacity-80"><div className="flex items-center gap-1.5 text-snow"><span aria-hidden className="text-slate">⊘</span>{t}</div>
      <div className="text-[10px] text-ash">{what}</div><div className="text-[10px] text-slate">{why}</div></li>)}</ul>
    <p className="mt-1 text-[10px] text-slate">Dickerson MS: 770-578-2710 · Principal Bradley Blackman (from cobbk12.org/dickerson).</p></div>);
}
