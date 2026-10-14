"use client";
import { useMemo, useState } from "react";
import { periods, span, type Span } from "@/lib/periods";
const fmt = (d: string | null) => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "date not available";
const ymd = () => new Date().toLocaleDateString("en-CA");
function Countdown({ label, s }: { label: string; s: Span | undefined }) {
  if (!s || s.daysLeft == null) return <div className="rounded-lg bg-navy-2/60 p-2" data-countdown={label}><div className="hud-label">{label}</div><div className="text-xs text-ash">date not available</div></div>;
  return (<div className="rounded-lg bg-navy-2/60 p-2" data-countdown={label} title={`${s.name}: ${fmt(s.start)} – ${fmt(s.end)} · source: ${s.source}`}>
    <div className="hud-label truncate">{label} · {s.id}</div>
    <div className="font-mono text-base text-snow">{s.daysLeft}<span className="ml-1 text-xs text-ash">calendar days left</span></div>
    {s.schoolDaysLeft != null && <div className="text-xs text-cyan">{s.schoolDaysLeft} school days left</div>}
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cyan/10" role="progressbar" aria-label={`${s.name} progress`} aria-valuenow={s.pct ?? 0} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-cyan" style={{ width: `${s.pct ?? 0}%` }} /></div>
    <div className="mt-0.5 text-[10px] text-slate">{s.pct}% · ends {fmt(s.end)}</div>
  </div>);
}
export default function GradingPeriods({ rp }: { rp: { name?: string; start?: string; end?: string; periods?: { name: string; start: string; end: string }[] } | null | undefined }) {
  const [open, setOpen] = useState(false); const today = ymd();
  const p = useMemo(() => periods(rp), [rp]);
  const Q = p.quarters.map(x => span(x, today)), S = p.semesters.map(x => span(x, today)), T = p.terms.map(x => span(x, today));
  const term = T.find(t => p.currentTerm ? t.name === p.currentTerm && t.current : t.current) ?? T.find(t => t.current);
  return (<div className="space-y-2" aria-label="Grading periods">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Countdown label="Grading period" s={Q.find(q => q.current)} />
      <Countdown label="Current term" s={term} />
      <Countdown label="Semester" s={S.find(s => s.current)} />
    </div>
    <button className="text-xs text-cyan hover:underline" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? "Hide" : "Show"}  All Period Dates</button>
    {open && <table className="w-full text-xs" aria-label="Period dates"><tbody>
      {[...Q, ...S].map(s => <tr key={s.id} data-current={s.current || undefined} className={s.current ? "bg-cyan/10 text-snow" : "text-ash"}>
        <td className="px-1 py-0.5 font-mono">{s.id}{s.current && <span className="ml-1 rounded bg-cyan/25 px-1 text-[10px] text-cyan">now</span>}</td>
        <td className="px-1">{fmt(s.start)} – {fmt(s.end)}</td></tr>)}
    </tbody></table>}
    <div className="text-[10px] text-slate">Quarters: {p.quarters[0].source}. Semesters derived from quarter dates. School days exclude weekends and closures in the Cobb County 2026–27 district calendar.</div>
  </div>);
}
