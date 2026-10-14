"use client";
import { gradeText, gradeHex } from "@/lib/letter";
import { useEffect, useMemo, useState } from "react";
import { loadGraded, calcView, qOf, COBB_SCALE_URL, type GA, type GradedData } from "@/lib/graded";

const fd = (d: string | null) => d ? new Date(d + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
const tone = (p: number | null) => gradeText(p);
const LOW = 70;
type F = "missing" | "low" | string;

export default function GradedAssignments({ courseKey, demo }: { courseKey: string; demo: boolean }) {
  const [d, setD] = useState<GradedData | null>(null); const [open, setOpen] = useState(false);
  const [f, setF] = useState<Set<F>>(new Set()); const [ungraded, setUngraded] = useState(false);
  useEffect(() => { loadGraded(demo).then(setD).catch(() => setD({ rows: [], calc: [] })); }, [demo]);
  const all = useMemo(() => {
    const rs = (d?.rows ?? []).filter(r => r.course_key === courseKey);
    const byId = new Map<string, GA & { q: string | null }>();   // one row per assignment; quarter rows win over progress-period rows
    for (const r of rs) { const q = qOf(r.period_name); const ex = byId.get(r.gradebook_id); if (!ex || (!ex.q && q)) byId.set(r.gradebook_id, { ...r, q: q ?? ex?.q ?? null }); }
    return [...byId.values()].sort((a, b) => (b.due_date ?? b.assigned_date ?? "").localeCompare(a.due_date ?? a.assigned_date ?? ""));
  }, [d, courseKey]);
  const cv = useMemo(() => d ? calcView(d.calc, d.rows, courseKey) : null, [d, courseKey]);
  if (!d) return null;
  const graded = all.filter(a => a.graded); const miss = all.filter(a => a.missing).length;
  const latest = graded[0]; const qs = [...new Set(all.map(a => a.q).filter(Boolean))].sort() as string[];
  const tog = (x: F) => setF(s => { const n = new Set(s); if (n.has(x)) n.delete(x); else n.add(x); return n; });
  const quarters = qs.filter(q => f.has(q));
  const shown = all.filter(a => (ungraded || a.graded) && (!f.has("missing") || a.missing) && (!f.has("low") || (a.percent != null && a.percent < LOW)) && (!quarters.length || (a.q && quarters.includes(a.q))));
  const maxImp = Math.max(1, ...(cv?.cats.map(c => Math.abs(c.impact ?? 0)) ?? [1]));
  return (<div className="mt-1 basis-full" onClick={e => e.stopPropagation()}>
    <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-cyan/10 bg-navy-2/40 px-2 py-1 text-left text-[11px] text-ash hover:border-cyan/40">
      <span className="text-cyan">{open ? "▾" : "▸"} Graded assignments</span>
      <span><b className="font-mono text-snow">{graded.length}</b> graded</span>
      <span>latest {latest ? <b className={`font-mono ${tone(latest.percent)}`}>{latest.percent != null ? `${latest.percent}%` : latest.score_display}</b> : "—"}</span>
      <span className={miss ? "text-alert" : ""}><b className="font-mono">{miss}</b> missing</span>
    </button>
    {open && <div className="mt-1 space-y-2 rounded-md border border-cyan/15 bg-black/30 p-2 text-xs">
      {d.missing && <p className="text-ash">Assignment history isn&apos;t set up yet (run migration 013).</p>}
      {/* Category weights from ParentVUE GradeCalculationSummary */}
      <div><div className="hud-label mb-1">Category weights {cv && <span className="normal-case text-slate">· {cv.period} · ParentVUE</span>}</div>
        {!cv ? <p className="text-ash">Weights not published for this class (ParentVUE shows no category breakdown).</p> : <div className="space-y-1">
          {cv.cats.map(c => <div key={c.category} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2">
            <span className="truncate text-snow" title={c.category}>{c.category}</span>
            <div className="relative h-3 rounded bg-navy-2/80" aria-label={`${c.category}: weight ${c.weight}%, score ${c.pct == null ? "none yet" : c.pct.toFixed(1) + "%"}`}>
              <div className="absolute inset-y-0 left-0 rounded bg-cyan/25" style={{ width: `${c.weight}%` }} />
              {c.pct != null && <div className={`absolute inset-y-[3px] left-0 rounded ${c.pct < 74 ? "grade-low grade-low-bar" : ""}`} style={{ width: `${c.weight * c.pct / 100}%`, background: gradeHex(c.pct), boxShadow: "0 0 6px currentColor" }} />}
            </div>
            <span className="whitespace-nowrap font-mono text-[11px]"><span className="text-cyan">{c.weight}%</span> · <span className={tone(c.pct)}>{c.pct == null ? "no grades" : `${c.pct.toFixed(1)}%`}</span></span>
          </div>)}
          {cv.overall != null && <>
            <div className="hud-label mt-2">Impact on overall ({cv.overall.toFixed(1)}%)</div>
            {cv.cats.filter(c => c.impact != null).map(c => <div key={c.category} className="grid grid-cols-[minmax(0,7rem)_1fr_3.5rem] items-center gap-2">
              <span className="truncate text-ash">{c.category}</span>
              <div className="relative h-2.5"><div className="absolute inset-y-0 left-1/2 w-px bg-cyan/40" />
                <div className="absolute inset-y-0 rounded" style={{ [c.impact! >= 0 ? "left" : "right"]: "50%", width: `${Math.abs(c.impact!) / maxImp * 50}%`, background: c.impact! >= 0 ? "#7dffc8" : "#ff3b5c", boxShadow: "0 0 6px currentColor" }} /></div>
              <span className={`text-right font-mono ${c.impact! >= 0 ? "text-mint" : "text-alert"}`}>{c.impact! >= 0 ? "+" : ""}{c.impact!.toFixed(1)}</span></div>)}
            {cv.whatIf && <p className="rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-amber-100">⚑ What if: {cv.whatIf}</p>}
          </>}
          <p className="text-[10px] text-slate">Source: ParentVUE grade calculation. Letter scale: <a className="underline" href={COBB_SCALE_URL} target="_blank" rel="noreferrer">Cobb Admin Rule IHA-R</a> (A 90, B 80, C 74, D 70). Cobb publishes no district-wide middle-school category weights.</p>
        </div>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {(["missing", "low", ...qs] as F[]).map(x => <button key={x} onClick={() => tog(x)} aria-pressed={f.has(x)} className={`rounded-full border px-2 py-0.5 ${f.has(x) ? "border-cyan bg-cyan/20 text-cyan" : "border-cyan/20 text-ash"}`}>{x === "missing" ? "Missing" : x === "low" ? `Low (<${LOW})` : x}</button>)}
        <label className="ml-auto flex items-center gap-1 text-ash"><input type="checkbox" checked={ungraded} onChange={e => setUngraded(e.target.checked)} /> show ungraded</label>
      </div>
      <ul className="space-y-1">{shown.map(a => <li key={a.gradebook_id} className="rounded bg-navy-2/50 px-2 py-1">
        <div className="flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-snow">{a.name}</span>
          <span className={`shrink-0 font-mono ${a.missing ? "text-alert" : tone(a.percent)}`}>{a.missing ? "Missing" : a.percent != null ? `${a.percent}%` : a.score_display ?? "—"}</span></div>
        <div className="flex flex-wrap gap-x-2 text-[10px] text-ash"><span className="text-cyan/80">{a.category ?? "—"}</span><span>assigned {fd(a.assigned_date)}</span><span>due {fd(a.due_date)}</span>{a.points_display && <span>{a.points_display}</span>}{a.q && <span>{a.q}</span>}</div>
        {a.notes && <div className="mt-0.5 text-[10px] italic text-ice">“{a.notes}”</div>}
      </li>)}{!shown.length && <li className="text-ash">{all.length ? "Nothing matches these filters." : "No assignments pulled for this class yet."}</li>}</ul>
    </div>}
  </div>);
}
