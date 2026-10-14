"use client";
// School Hub month view: official CCSD 2026-27 district calendar + Eli's ParentVUE calendar items + assignment due dates.
import { useEffect, useMemo, useState } from "react";
import { CAT_LABEL, eventsOn, type DCat, type DEvent, type DistrictCal } from "@/lib/district";
import { loadEducation, type CalItem, type Assignment } from "@/lib/education";
import { isDemo } from "@/lib/store";
import { useExt, extDays, extTime, SRC } from "@/lib/ext";
import { SrcLegend } from "./ExtSync";
import { cleanPv, catFor, CHIP, scoreColor, type ChipCat } from "@/lib/calclean";
import snap from "../../../public/data/ccsd-2026-27.json";
// High-contrast colors on the opaque navy panel (#0a1122): every color ≥ 4.5:1 for chip text.
const COLOR: Record<DCat | "pv" | "due", string> = { first_last: "#7dffc8", holiday: "#ff8fa3", student_holiday: "#ffb86b", early_release: "#ffe36e", digital: "#8fd3ff", testing: "#d7a8ff", report_card: "#b6f36a", board: "#c9d3e3", other: "#c9d3e3", pv: "#5ef0e0", due: "#ff9ad5" };
type Item = { title: string; color: string; kind: string; src: string; cat: ChipCat; score?: number | null; tip?: string };
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export default function SchoolCalendar() {
  const [cal, setCal] = useState<DistrictCal>(snap as DistrictCal); const [live, setLive] = useState(false);
  const [pv, setPv] = useState<CalItem[]>([]); const [due, setDue] = useState<Assignment[]>([]);
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [sel, setSel] = useState<string>(ymd(new Date())); const [view, setView] = useState<"month" | "list">(() => typeof window !== "undefined" && innerWidth < 640 ? "list" : "month");
  useEffect(() => { const ac = new AbortController(); fetch("/api/district-calendar", { signal: ac.signal }).then(r => r.ok ? r.json() : null).then((j: (DistrictCal & { live?: boolean }) | null) => { if (j?.events?.length) { setCal(j); setLive(!!j.live); } }).catch(() => {});
    loadEducation(isDemo()).then(e => { setPv(e?.calendar ?? []); setDue((e?.assignments ?? []).filter(a => a.due_date)); }).catch(() => {}); return () => ac.abort(); }, []);
  const [ext] = useExt();
  const extOn = useMemo(() => { const m = new Map<string, Item[]>(); ext.forEach(x => extDays(x).forEach(k => { const a = m.get(k) ?? []; a.push({ title: `${extTime(x) ? extTime(x) + " " : ""}${x.title}`, color: SRC[x.source].color, kind: x.kind === "task" ? `${SRC[x.source].short} to-do` : SRC[x.source].short, src: SRC[x.source].label, cat: "personal" }); m.set(k, a); })); return m; }, [ext]);
  const itemsOn = useMemo(() => (d: string): Item[] => [
    ...eventsOn(d, cal.events).map((e: DEvent) => ({ title: e.title, color: COLOR[e.cat], kind: CAT_LABEL[e.cat], src: e.source === "ics" ? "CCSD calendar feed" : "CCSD year-at-a-glance PDF", cat: catFor({ district: e.cat, title: e.title }) })),
    ...pv.filter(p => p.date?.slice(0, 10) === d).map(p => { const c = cleanPv(p.title); return { title: c.title, score: c.score, tip: `${p.title}`, color: COLOR.pv, kind: "ParentVUE", src: "ParentVUE sync", cat: catFor({ pv: true, title: c.title, score: c.score }) }; }),
    ...due.filter(a => a.due_date?.slice(0, 10) === d).map(a => { const t = `${a.course ? cleanPv(a.course + " : x").course + ": " : ""}${a.name}`; return { title: t, tip: `${a.course ?? ""} · ${a.name}`, color: COLOR.due, kind: a.missing ? "Assignment due (MISSING)" : "Assignment due", src: "ParentVUE sync", cat: catFor({ due: true, title: t }) }; }),
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
    <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-1.5">{(Object.keys(CHIP) as ChipCat[]).map(k => <li key={k} className="rounded-md border px-2 py-0.5 text-[13px] font-medium text-[#f1f3f9]" style={{ background: CHIP[k].bg, borderColor: CHIP[k].border }}>{CHIP[k].label}</li>)}<li className="flex items-center gap-1 text-[13px] text-[#a9afc0]">Score: <span className="rounded px-1 font-bold" style={{ background: "#22c55e", color: "#04140a" }}>90+</span><span className="rounded px-1 font-bold" style={{ background: "#facc15", color: "#1a1400" }}>80–89</span><span className="rounded px-1 font-bold" style={{ background: "#ef4444", color: "#fff" }}>&lt;80</span></li></ul>
    {view === "month" ? (<>
      <div role="grid" aria-label="Month view" className="cal-grid grid grid-cols-7 gap-1" style={{ gridAutoRows: "minmax(104px, 1fr)", gridTemplateRows: "auto" }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => <div key={d} role="columnheader" className={`py-1 text-center text-xs font-semibold uppercase tracking-wide ${i === 0 || i === 6 ? "text-[#7d8699]" : "text-[#a9afc0]"}`}>{d}</div>)}
        {cells.map((d, i) => { if (!d) return <div key={`e${i}`} aria-hidden />; const it = itemsOn(d); const isT = d === today, isS = d === sel; const dow = new Date(d + "T12:00").getDay(); const wk = dow === 0 || dow === 6;
          return <div key={d} role="gridcell" aria-selected={isS} tabIndex={0} aria-label={`${d}${it.length ? `: ${it.map(x => x.title).join(", ")}` : ""}`} onClick={() => setSel(d)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(d); } }}
            className={`cal-cell flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border p-1.5 text-left ${wk ? "cal-weekend" : ""} ${isT ? "cal-today" : ""} ${isS ? "cal-sel" : ""}`}>
            <span className={`text-base font-bold leading-none ${isT ? "text-[#3ef2e0]" : wk ? "text-[#a9afc0]" : "text-[#e6e8ef]"}`}>{Number(d.slice(8))}</span>
            {it.slice(0, 3).map((x, k) => <Chip key={k} x={x} />)}
            {it.length > 3 && <button type="button" className="self-start rounded px-1 text-[13px] font-semibold text-[#c7d2fe] underline-offset-2 hover:underline" onClick={e => { e.stopPropagation(); setSel(d); document.getElementById("cal-day-detail")?.scrollIntoView({ block: "nearest" }); }}>+{it.length - 3} More</button>}
          </div>; })}
      </div>
      <div id="cal-day-detail" className="mt-2 rounded-lg bg-[#060b18] p-2" aria-live="polite">
        <div className="text-sm font-semibold">{new Date(sel + "T12:00").toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        {detail.length ? <ul className="mt-1 space-y-1">{detail.map((x, k) => <li key={k} className="flex items-center gap-2 text-[15px] leading-normal"><Chip x={x} full /><span className="shrink-0 text-xs text-[#a9afc0]">{CHIP[x.cat].label} · {x.src}</span></li>)}</ul> : <p className="text-[15px] text-[#a9b7cc]">No events.</p>}
      </div></>) : (
      <ul className="space-y-1">{listDays.map(d => <li key={d} className="rounded-lg bg-[#060b18] p-2"><div className="text-xs font-semibold text-[#a9b7cc]">{new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>
        <div className="mt-1 space-y-1">{itemsOn(d).map((x, k) => <Chip key={k} x={x} full />)}</div></li>)}</ul>)}

    <p className="mt-2 text-xs text-[#a9b7cc]">District dates: <a className="underline" href="https://www.cobbk12.org/backtoschool/calendars" target="_blank" rel="noopener noreferrer">cobbk12.org calendar feed</a>{live ? " (live)" : " (snapshot)"} · as of {new Date(cal.asOf).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · <a className="underline" href={cal.pdf} target="_blank" rel="noopener noreferrer">PDF</a>. Dickerson MS has no separate public feed; school events come via ParentVUE.</p>
  </div>);
}

function Chip({ x, full }: { x: Item; full?: boolean }) {
  const c = CHIP[x.cat]; const sc = x.score != null ? scoreColor(x.score) : null;
  return <span data-tip={`${x.tip ?? x.title} · ${x.kind} (${x.src})`} className={`cal-chip2 flex min-w-0 items-center gap-1 rounded-md border-l-[3px] px-1.5 py-0.5 text-[13px] leading-snug text-[#f1f3f9] ${full ? "flex-1 sm:text-sm" : ""}`} style={{ background: c.bg, borderLeftColor: c.border }}>
    <span className={full ? "min-w-0 flex-1" : "min-w-0 flex-1 truncate"}>{x.title}</span>
    {sc && <span className="shrink-0 rounded px-1 text-[11px] font-bold tabular-nums" style={{ background: sc.bg, color: sc.fg }}>{x.score}</span>}
  </span>;
}
