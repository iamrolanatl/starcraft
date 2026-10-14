"use client";
// School Hub month view: official CCSD 2026-27 district calendar + Eli's ParentVUE calendar items + assignment due dates.
import { useEffect, useMemo, useState } from "react";
import { CAT_LABEL, eventsOn, type DCat, type DEvent, type DistrictCal } from "@/lib/district";
import { loadEducation, type CalItem, type Assignment } from "@/lib/education";
import { isDemo } from "@/lib/store";
import { useExt, extDays, extTime, SRC } from "@/lib/ext";
import { SrcLegend } from "./ExtSync";
import snap from "../../../public/data/ccsd-2026-27.json";
// High-contrast colors on the opaque navy panel (#0a1122): every color ≥ 4.5:1 for chip text.
const COLOR: Record<DCat | "pv" | "due", string> = { first_last: "#7dffc8", holiday: "#ff8fa3", student_holiday: "#ffb86b", early_release: "#ffe36e", digital: "#8fd3ff", testing: "#d7a8ff", report_card: "#b6f36a", board: "#c9d3e3", other: "#c9d3e3", pv: "#5ef0e0", due: "#ff9ad5" };
type Item = { title: string; color: string; kind: string; src: string };
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export default function SchoolCalendar() {
  const [cal, setCal] = useState<DistrictCal>(snap as DistrictCal); const [live, setLive] = useState(false);
  const [pv, setPv] = useState<CalItem[]>([]); const [due, setDue] = useState<Assignment[]>([]);
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState<string>(ymd(new Date())); const [view, setView] = useState<"month" | "list">("month");
  useEffect(() => { const ac = new AbortController(); fetch("/api/district-calendar", { signal: ac.signal }).then(r => r.ok ? r.json() : null).then((j: (DistrictCal & { live?: boolean }) | null) => { if (j?.events?.length) { setCal(j); setLive(!!j.live); } }).catch(() => {});
    loadEducation(isDemo()).then(e => { setPv(e?.calendar ?? []); setDue((e?.assignments ?? []).filter(a => a.due_date)); }).catch(() => {}); return () => ac.abort(); }, []);
  const [ext] = useExt();
  const extOn = useMemo(() => { const m = new Map<string, Item[]>(); ext.forEach(x => extDays(x).forEach(k => { const a = m.get(k) ?? []; a.push({ title: `${extTime(x) ? extTime(x) + " " : ""}${x.title}`, color: SRC[x.source].color, kind: x.kind === "task" ? `${SRC[x.source].short} to-do` : SRC[x.source].short, src: SRC[x.source].label }); m.set(k, a); })); return m; }, [ext]);
  const itemsOn = useMemo(() => (d: string): Item[] => [
    ...eventsOn(d, cal.events).map((e: DEvent) => ({ title: e.title, color: COLOR[e.cat], kind: CAT_LABEL[e.cat], src: e.source === "ics" ? "CCSD calendar feed" : "CCSD year-at-a-glance PDF" })),
    ...pv.filter(p => p.date?.slice(0, 10) === d).map(p => ({ title: p.title, color: COLOR.pv, kind: "ParentVUE", src: "ParentVUE sync" })),
    ...due.filter(a => a.due_date?.slice(0, 10) === d).map(a => ({ title: `${a.course ? a.course + ": " : ""}${a.name}`, color: COLOR.due, kind: a.missing ? "Assignment due (MISSING)" : "Assignment due", src: "ParentVUE sync" })),
    ...(extOn.get(d) ?? []),
  ], [cal, pv, due, extOn]);
  const today = ymd(new Date());
  const first = new Date(cur); const startDow = first.getDay(); const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(cur.getFullYear(), cur.getMonth(), i + 1)))];
  const mv = (n: number) => setCur(c => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const listDays = useMemo(() => { const set = new Set<string>(); cal.events.forEach(e => { if (e.end >= today) set.add(e.start < today ? today : e.start); }); pv.forEach(p => p.date >= today && set.add(p.date.slice(0, 10))); due.forEach(a => a.due_date! >= today && set.add(a.due_date!.slice(0, 10))); extOn.forEach((_, k) => k >= today && set.add(k)); return [...set].sort().slice(0, 40); }, [cal, pv, due, today, extOn]);
  const detail = itemsOn(sel);
  return (<div className="cal-solid rounded-xl p-2 text-[#E8F4FF]">
    <div className="mb-2 flex flex-wrap items-center gap-1">
      <button className="btn btn-ghost min-h-[44px] min-w-[44px] !px-2" onClick={() => mv(-1)} aria-label="Previous Month">‹</button>
      <h3 className="min-w-[9rem] flex-1 text-center text-base font-semibold" aria-live="polite">{cur.toLocaleDateString([], { month: "long", year: "numeric" })}</h3>
      <button className="btn btn-ghost min-h-[44px] min-w-[44px] !px-2" onClick={() => mv(1)} aria-label="Next Month">›</button>
      <button className="btn btn-ghost min-h-[44px] !px-3 text-sm" onClick={() => { const d = new Date(); setCur(new Date(d.getFullYear(), d.getMonth(), 1)); setSel(today); }}>Today</button>
      <button className="btn btn-ghost min-h-[44px] !px-3 text-sm" aria-pressed={view === "list"} onClick={() => setView(v => v === "month" ? "list" : "month")}>{view === "month" ? "☰ List" : "▦ Month"}</button>
    </div>
    {view === "month" ? (<>
      <div role="grid" aria-label="Month view" className="grid grid-cols-7 gap-px text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} role="columnheader" className="py-1 text-xs font-semibold text-[#a9b7cc]">{d}</div>)}
        {cells.map((d, i) => { if (!d) return <div key={`e${i}`} />; const it = itemsOn(d); const isT = d === today, isS = d === sel;
          return <button key={d} role="gridcell" aria-selected={isS} aria-label={`${d}${it.length ? `: ${it.map(x => x.title).join(", ")}` : ""}`} onClick={() => setSel(d)}
            className={`relative flex min-h-[48px] flex-col items-center rounded-md p-0.5 text-sm ${isS ? "bg-cyan/20 ring-2 ring-cyan" : "hover:bg-white/5"} ${isT ? "font-bold" : ""}`}>
            <span className={isT ? "grid h-6 w-6 place-items-center rounded-full bg-[#3ef2e0] text-[#04121a]" : ""}>{Number(d.slice(8))}</span>
            <span className="mt-0.5 flex flex-wrap justify-center gap-0.5" aria-hidden>{it.slice(0, 4).map((x, k) => <span key={k} className="h-1.5 w-1.5 rounded-full sm:h-2 sm:w-2" style={{ background: x.color }} />)}</span>
            {it[0] && <span data-tip={it[0].title} className="cal-chip hidden w-full rounded px-0.5 text-[11px] leading-tight sm:block" style={{ color: it[0].color }}>{it[0].title}</span>}
          </button>; })}
      </div>
      <div className="mt-2 rounded-lg bg-[#060b18] p-2" aria-live="polite">
        <div className="text-sm font-semibold">{new Date(sel + "T12:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        {detail.length ? <ul className="mt-1 space-y-1">{detail.map((x, k) => <li key={k} className="flex items-start gap-2 text-[15px] leading-normal"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} /><span><span style={{ color: x.color }}>{x.kind}</span>: {x.title} <span className="text-xs text-[#a9b7cc]">({x.src})</span></span></li>)}</ul> : <p className="text-[15px] text-[#a9b7cc]">No events.</p>}
      </div></>) : (
      <ul className="space-y-1">{listDays.map(d => <li key={d} className="rounded-lg bg-[#060b18] p-2"><div className="text-xs font-semibold text-[#a9b7cc]">{new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>
        {itemsOn(d).map((x, k) => <div key={k} className="flex items-center gap-2 text-[15px]"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />{x.title}<span className="ml-auto text-xs" style={{ color: x.color }}>{x.kind}</span></div>)}</li>)}</ul>)}
    <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold">Legend</summary>
      <ul className="mt-1 grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">{([...Object.keys(CAT_LABEL), "pv", "due"] as (DCat | "pv" | "due")[]).map(k => <li key={k} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: COLOR[k] }} />{k === "pv" ? "ParentVUE calendar" : k === "due" ? "Assignment due" : CAT_LABEL[k as DCat]}</li>)}<SrcLegend /></ul></details>
    <p className="mt-2 text-xs text-[#a9b7cc]">District dates: <a className="underline" href="https://www.cobbk12.org/backtoschool/calendars" target="_blank" rel="noopener noreferrer">cobbk12.org calendar feed</a>{live ? " (live)" : " (snapshot)"} · as of {new Date(cal.asOf).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · <a className="underline" href={cal.pdf} target="_blank" rel="noopener noreferrer">PDF</a>. Dickerson MS has no separate public feed; school events come via ParentVUE.</p>
  </div>);
}
