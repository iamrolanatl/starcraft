"use client";
import ChildSwitcher from "@/components/ChildSwitcher"; import { selectedChild, restricted } from "@/lib/family";
import { useEffect, useMemo, useState } from "react";
import { gradeView, type GRow } from "@/lib/gradeview";
import GradingPeriods from "./GradingPeriods";
import GradeCell from "@/components/ui/GradeCell";
import ReportCards from "./ReportCards";
import MsgHub from "./MsgHub";
import Learn from "./Learn";
import GradingRules from "./GradingRules";
import GradedAssignments from "./GradedAssignments";
import { Schedule, AttendanceTab, Unavailable } from "./SchoolExtras";
import { loadEducation, loadSyncStatus, requestSync, jobStatus, type EduData, type GradeRow, type SyncStatus } from "@/lib/education";
import { sfx } from "@/lib/synth";
import { SyncLights } from "@/components/CrystalSync";
import { loadAbsences, type AbsP } from "@/lib/schoolx";
import type { Assignment } from "@/lib/education";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => d ? new Date(d.length === 10 ? d + "T12:00" : d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—";
const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
type Tab = "grades" | "work" | "comms" | "calendar" | "sync" | "reportcards" | "msg" | "schedule" | "attendance" | "more" | "learn" | "rules";

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return <span className="inline-block w-16 text-[10px] text-slate">no trend</span>;
  const lo = Math.min(...pts) - 2, hi = Math.max(...pts) + 2, w = 64, h = 18;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - lo) / (hi - lo || 1)) * h}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return <svg width={w} height={h} aria-hidden className="overflow-visible"><polyline points={d} fill="none" stroke={up ? "#7dffc8" : "#ff3b5c"} strokeWidth="1.6" style={{ filter: "drop-shadow(0 0 3px currentColor)" }} /></svg>;
}

type AP = Assignment & { points_possible?: number | null; url?: string | null };
const daysLeft = (d: string) => { const n = Math.round((new Date(d.slice(0, 10) + "T12:00").getTime() - new Date(today() + "T12:00").getTime()) / 864e5); return n <= 0 ? "due today" : n === 1 ? "1 day left" : `${n} days left`; };
const fmtDT = (d: string | null) => !d ? "no due date" : d.length > 10 && !/T00:00/.test(d) ? new Date(d).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : fmt(d.slice(0, 10));
function SummaryPeek({ kind, missing, upcoming, demo, onClose }: { kind: "missing" | "due" | "att"; missing: AP[]; upcoming: AP[]; demo: boolean; onClose: () => void }) {
  const [abs, setAbs] = useState<AbsP[] | "missing" | null>(null);
  useEffect(() => { if (kind === "att") loadAbsences(demo).then(setAbs).catch(() => setAbs([])); }, [kind, demo]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  const title = kind === "missing" ? "Missing assignments" : kind === "due" ? "Due soon (not turned in yet)" : "Absences and late arrivals";
  const row = "rounded-lg bg-navy-2/50 px-2 py-1.5";
  const due = upcoming.slice(0, 4);
  return <section id="edu-peek" aria-label={title} className="rounded-xl border border-cyan/25 bg-black/40 p-2 backdrop-blur">
    <div className="mb-1.5 flex items-center"><h3 className="hud-label text-ice">{title}</h3><button onClick={onClose} className="btn btn-ghost ml-auto !px-2 !py-0 text-[11px]" aria-label="Close list">✕ Close</button></div>
    {kind === "missing" && (!missing.length ? <p className="text-xs text-mint">Nothing missing. Great job staying on top of it! 🎉</p> :
      <ul className="space-y-1">{missing.map(a => <li key={a.source + a.ext_id} className={row}><div className="flex gap-2"><span className="flex-1 text-snow">{a.url ? <a className="underline" href={a.url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</span><span className="font-mono text-xs text-alert">{a.score_display ?? "Missing"}{a.points_possible ? ` of ${a.points_possible} points` : ""}</span></div><div className="text-[11px] text-ash">{a.course} · due {fmtDT(a.due_date)}</div></li>)}</ul>)}
    {kind === "due" && (!due.length ? <p className="text-xs text-mint">Nothing due right now. Enjoy the breather! 🌴</p> :
      <ul className="space-y-1">{due.map(a => <li key={a.source + a.ext_id} className={`${row} flex items-center gap-2`}><div className="min-w-0 flex-1"><div className="text-snow">{a.url ? <a className="underline" href={a.url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</div><div className="text-[11px] text-ash">{a.course} · due {fmtDT(a.due_date)}</div></div><span className="shrink-0 text-xs text-cyan">{a.due_date ? daysLeft(a.due_date) : ""}</span></li>)}</ul>)}
    {kind === "att" && (abs === null ? <p className="text-xs text-ash">Loading…</p> : abs === "missing" || !abs.length ? <p className="text-xs text-mint">No absences or late arrivals recorded. Perfect attendance! ⭐</p> :
      <ul className="space-y-1">{[...abs].sort((x, y) => x.date === y.date ? x.period - y.period : y.date.localeCompare(x.date)).map(r => { const t = r.kind === "tardy" ? "Late arrival (tardy)" : r.status === "activity" ? "School activity" : "Absent"; const ex = r.status === "activity" ? "approved" : r.status === "unexcused" ? "unexcused" : r.status === "excused" ? "excused" : "not explained yet";
        return <li key={r.date + r.period + r.kind} className={row}><div className="flex flex-wrap gap-x-2 text-xs"><span className="font-semibold text-snow">{fmt(r.date)}</span><span className="text-ash">Period {r.period}{r.course ? ` · ${r.course}` : ""}</span><span className={`ml-auto rounded px-1.5 text-[11px] ${ex === "unexcused" ? "bg-alert/25 text-snow" : ex === "approved" ? "bg-cyan/15 text-cyan" : "bg-mint/20 text-mint"}`}>{t} · {ex}</span></div>{r.note && <div className="text-[11px] italic text-ice">School note: “{r.note}”</div>}</li>; })}</ul>)}
  </section>;
}

function EducationInner({ demo, log }: { demo: boolean; log: (s: string, t?: "info" | "ok" | "warn") => void }) {
  const [data, setData] = useState<EduData | null | undefined>(undefined); const [err, setErr] = useState(""); const [tab, setTab] = useState<Tab>("grades");
  const [sync, setSync] = useState<SyncStatus | null>(null); const [busy, setBusy] = useState(""); const [tick, setTick] = useState(0);
  useEffect(() => { loadSyncStatus(demo).then(st => { setSync(st); const day = Date.now() - 864e5; st.alerts.filter(a => new Date(a.created_at).getTime() > day).forEach(a => log(`⚠ School sync: ${a.message}`, "warn")); }).catch(() => {}); }, [demo, log, tick]);
  async function doSync() {
    if (busy) return; sfx("click"); setBusy("requesting…");
    try {
      const j = await requestSync(demo); log(`School sync #${j.id} requested — waiting for the laptop.`, "info");
      if (demo) { setBusy(""); log("Demo: sync simulated.", "ok"); return; }
      const t0 = Date.now();
      while (Date.now() - t0 < 6 * 60000) {
        await new Promise(r => setTimeout(r, 5000)); const s = await jobStatus(j.id); if (!s) break;
        setBusy(s.status === "pending" ? "waiting for laptop…" : s.status === "running" ? "laptop pulling…" : s.status === "processing" ? "box processing…" : s.status);
        if (s.status === "done") { sfx("success"); log(`School sync #${j.id} complete.`, "ok"); break; }
        if (s.status === "failed") { sfx("error"); log(`School sync #${j.id} failed: ${(s.message || "").split(" | ").pop()}`, "warn"); break; }
      }
      setTick(t => t + 1); loadEducation(demo).then(setData).catch(() => {});
    } catch (e) { log(`Sync request failed: ${(e as Error).message}`, "warn"); sfx("error"); }
    finally { setBusy(""); }
  }
  useEffect(() => { loadEducation(demo).then(d => { setData(d); if (d) log(`Education uplink: ${d.student.name}, synced ${ago(d.student.last_synced_at)}.`, "ok"); }).catch(e => { setErr((e as Error).message); log(`Education: ${(e as Error).message}`, "warn"); }); }, [demo, log]);

  const gv = useMemo(() => gradeView((data?.grades ?? []) as GRow[]), [data]);
  const [qv, setQv] = useState<"final" | "live">("final");
  const [peek, setPeek] = useState<"missing" | "due" | "att" | null>(null);

  if (err) return <p className="text-sm text-alert">{err}</p>;
  if (data === undefined) return <p className="text-sm text-ash">Linking to school uplink…</p>;
  if (data === null) return <p className="text-sm text-ash">No school data yet. The box sync fills this after your next ParentVUE pull.</p>;
  const missing = data.assignments.filter(a => a.missing || a.zero);
  const upcoming = data.assignments.filter(a => !a.missing && a.due_date && a.due_date >= today()).slice(0, 12);
  const cal = data.calendar.filter(c => c.date >= today()).slice(0, 14);
  const at = data.student.attendance_totals || {};
  const TABS: [Tab, string, number?][] = [["grades", "Grades"], ["rules", "Grading Rules"], ["learn", "Learn"], ["work", "Work", missing.length], ["comms", "Messages", data.messages.filter(m => m.unread).length], ["calendar", "Calendar"], ["schedule", "Schedule"], ["attendance", "Attendance"], ["reportcards", "Report Cards"], ["msg", "School Inboxes"], ["more", "More School Data"], ["sync", "Sync Log", sync?.alerts.filter(a => Date.now() - new Date(a.created_at).getTime() < 864e5).length]];

  return (<div className="space-y-3 text-sm">
    {!demo && <SyncLights compact />}
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ash">
      <span className="font-semibold text-snow">{data.student.name}</span><span>Gr {Number(data.student.grade) || data.student.grade}</span><span className="truncate">{data.student.school}</span>
      <span className="text-cyan">{data.student.reporting_period?.name}</span>
      <span className="ml-auto" title={data.student.last_fetched_at ?? ""}>⟳ {ago(data.student.last_fetched_at)}</span>
      {!restricted() && <button onClick={doSync} disabled={!!busy} className="btn btn-ghost !px-2 !py-0.5 text-[11px]" aria-label="Sync School Data Now">{busy || "⟳ Sync"}</button>}
      {data.demo && <span className="rounded bg-amber-300/15 px-1.5 text-amber-200">demo data</span>}
    </div>
    <div className="grid grid-cols-3 gap-2 text-center">
      {([["missing", "Missing", <span key="m" className={missing.length ? "text-alert" : "text-mint"}>{missing.length}</span>, "#ff3b5c"], ["due", "Due soon", <span key="d" className="text-cyan">{upcoming.length}</span>, "#22d3ee"], ["att", "Absent / tardy", <span key="a" className="text-snow">{(at.excused ?? 0) + (at.unexcused ?? 0)} / {at.tardies ?? 0}</span>, "#fcd34d"]] as const).map(([id, label, val, c]) =>
        <button key={id} type="button" aria-expanded={peek === id} aria-controls="edu-peek" onClick={() => setPeek(peek === id ? null : id)} style={{ "--glow": c } as React.CSSProperties}
          className={`rounded-lg border py-1.5 transition-shadow hover:shadow-[0_0_12px_var(--glow)] focus-visible:shadow-[0_0_12px_var(--glow)] focus-visible:outline-none ${peek === id ? "border-[color:var(--glow)] bg-navy-2/80 shadow-[0_0_12px_var(--glow)]" : "border-transparent bg-navy-2/60"}`}>
          <div className="hud-label">{label} <span aria-hidden>{peek === id ? "▴" : "▾"}</span></div><div className="font-mono text-lg">{val}</div></button>)}
    </div>
    {peek && <SummaryPeek kind={peek} missing={missing} upcoming={upcoming} demo={demo} onClose={() => setPeek(null)} />}
    <div role="tablist" aria-label="Education sections" data-sticky-tabs className="pill-tabs">
      {TABS.map(([id, label, n], i) => <button key={id} role="tab" style={{ "--i": i } as React.CSSProperties} aria-selected={tab === id} onClick={() => setTab(id)} className="pill-tab">{label}{n ? <span className="ml-1.5 rounded-full bg-alert/40 px-1.5 text-[11px] text-snow">{n}</span> : null}</button>)}
    </div>
    {tab === "grades" && <div className="space-y-2">
      <GradingPeriods rp={data.student.reporting_period as Parameters<typeof GradingPeriods>[0]["rp"]} />
      <div className="flex items-center gap-1 text-xs" role="radiogroup" aria-label="Quarter view">
        {(["final", "live"] as const).map(v => { const lbl = v === "final" ? (gv.current.find(c => c.final)?.final?.term.replace(/^Quarter\s*/i, "Q") ?? "Q1") : (gv.term?.replace(/^Quarter\s*/i, "Q").replace(/^Progress Period\s*/i, "Q") ?? "Q2");
          return <button key={v} role="radio" aria-checked={qv === v} onClick={() => setQv(v)} className={`rounded px-2 py-0.5 ${qv === v ? "bg-cyan/20 text-cyan" : "text-ash hover:text-snow"}`}>{lbl}</button>; })}
      </div>
      <ul className="space-y-1" aria-label="Current classes">{gv.current.map(c => {
        const fq = c.final ? c.final.term.replace(/^Quarter\s*/i, "Q") : "Q1";
        const lq = c.term.replace(/^Quarter\s*/i, "Q").replace(/^Progress Period\s*/i, "Q");
        const fp = c.final?.percent != null ? Number(c.final.percent) : null;
        const lp = c.posted && c.term !== c.final?.term ? Number(c.percent) : null;
        const fmt = (n: number) => n.toFixed(n % 1 ? 1 : 0);
        const delta = lp != null && fp != null ? lp - fp : null;
        const liveTxt = lp != null ? `${lq}: ${fmt(lp)}%${delta != null ? ` ${delta >= 0 ? "▲" : "▼"}${fmt(Math.abs(delta))} vs ${fq}` : ""}` : `${lq}: not posted yet`;
        const main = qv === "final" ? fp : lp; const mainLbl = qv === "final" ? `${fq} final` : lq;
        const sub = qv === "final" ? liveTxt : fp != null ? `${fq} final ${fmt(fp)}` : `${fq}: not posted`;
        return (<li key={c.key} data-class={c.key} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cyan/5">
          <span className="w-4 font-mono text-xs text-slate">{c.period}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-snow" title={c.course}>{c.course}</div>
            <div className="truncate text-xs text-slate" title={`${c.teacher ?? ""} · ${sub}`}>{c.teacher} · <span data-sub>{sub}</span></div></div>
          <Spark pts={c.trend} />
          <GradeCell pct={main} text={main != null ? fmt(main) : null} caption={main != null ? mainLbl : null} empty={qv === "final" || fp == null ? "Not posted" : "Not posted yet"} />
          <GradedAssignments courseKey={c.key} demo={data.demo} />
        </li>); })}{!gv.current.length && <li className="text-xs text-ash">No classes in the latest sync.</li>}</ul>
      {gv.completed.length > 0 && <div><div className="hud-label mb-1">Completed courses</div><ul className="space-y-1" aria-label="Completed courses">{gv.completed.map(f => <li key={f.course_key} data-class={f.course_key} className="flex items-center gap-2 rounded-lg px-2 py-1 text-ash"><div className="min-w-0 flex-1"><div className="truncate">{f.course}</div><div className="truncate text-xs text-slate">{f.teacher} · {f.term} final</div></div><GradeCell pct={f.percent} text={f.percent != null ? String(f.percent) : f.mark ?? null} caption={`${f.term} final`} empty="Not posted" /></li>)}</ul></div>}
      {gv.asOf && <p className="text-xs text-slate">Current term: {gv.term} · as of {fmt(gv.asOf)}</p>}
    </div>}
    {tab === "work" && <div className="space-y-2">
      {missing.length > 0 && <div><div className="hud-label mb-1 text-alert">Missing / zero</div><ul className="space-y-1">{missing.map(a => <li key={a.source + a.ext_id} className="rounded-lg border border-alert/30 bg-alert/10 px-2 py-1"><div className="text-snow">{a.name}</div><div className="text-[10px] text-ash">{a.course} · due {fmt(a.due_date)} · {a.score_display}</div></li>)}</ul></div>}
      <div><div className="hud-label mb-1">Upcoming</div><ul className="space-y-1">{upcoming.map(a => <li key={a.source + a.ext_id} className="flex items-center gap-2 rounded-lg bg-navy-2/50 px-2 py-1"><div className="min-w-0 flex-1"><div className="truncate text-snow">{a.name}</div><div className="truncate text-[10px] text-ash">{a.course} · {a.source}</div></div><span className="text-xs text-cyan">{fmt(a.due_date)}</span></li>)}{!upcoming.length && <li className="text-xs text-ash">Nothing due.</li>}</ul></div>
    </div>}
    {tab === "comms" && <ul className="space-y-1">{data.messages.slice(0, 25).map(m => <li key={m.source + m.ext_id} className="rounded-lg bg-navy-2/50 px-2 py-1">
      <div className="flex items-center gap-2"><span className="rounded bg-cyan/10 px-1 text-[9px] uppercase text-cyan">{m.source}</span><span className={`flex-1 truncate ${m.unread ? "font-semibold text-snow" : "text-ice"}`}>{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">{m.subject}</a> : m.subject}</span><span className="text-[10px] text-slate">{fmt(m.sent_at)}</span></div>
      <div className="truncate text-[10px] text-ash">{m.sender}{m.body ? ` — ${m.body}` : ""}</div></li>)}{!data.messages.length && <li className="text-xs text-ash">No messages.</li>}</ul>}
    {tab === "calendar" && <ul className="space-y-1">{cal.map(c => <li key={c.date + c.title} className="flex gap-2 rounded-lg bg-navy-2/50 px-2 py-1"><span className="w-20 shrink-0 font-mono text-xs text-cyan">{fmt(c.date)}</span><span className="text-snow">{c.title.replace(/\s+-\s+Score:\s*-?$/, "")}</span></li>)}{!cal.length && <li className="text-xs text-ash">No upcoming school events.</li>}</ul>}
    {tab === "learn" && <Learn demo={data.demo} />}
    {tab === "rules" && <GradingRules classes={gv.current.map(c => { /* same value + label as the Grades column (Q1 final by default; Q toggle respected) */
      const fq = c.final ? c.final.term.replace(/^Quarter\s*/i, "Q") : "Q1"; const lq = c.term.replace(/^Quarter\s*/i, "Q").replace(/^Progress Period\s*/i, "Q");
      const fp = c.final?.percent != null ? Number(c.final.percent) : null; const lp = c.posted && c.term !== c.final?.term && c.percent != null ? Number(c.percent) : null;
      return { key: c.key, course: c.course, percent: qv === "final" ? fp : lp, label: qv === "final" ? `${fq} final` : lq }; })} />}
    {tab === "reportcards" && <ReportCards demo={data.demo} />}
    {tab === "msg" && <MsgHub messages={data.messages} />}
    {tab === "schedule" && <Schedule demo={data.demo} />}
    {tab === "attendance" && <AttendanceTab demo={data.demo} totals={at} rp={data.student.reporting_period as Parameters<typeof GradingPeriods>[0]["rp"]} />}
    {tab === "more" && <Unavailable />}
    {tab === "sync" && <div className="space-y-2">
      {!!sync?.alerts.length && <div><div className="hud-label mb-1 text-alert">Alerts</div><ul className="space-y-1">{sync.alerts.map(a => <li key={a.id} className="rounded-lg border border-alert/30 bg-alert/10 px-2 py-1 text-xs"><span className="text-snow">{a.message}</span><div className="text-[10px] text-ash">{fmt(a.created_at)} {new Date(a.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {a.kind.replace("_", " ")}</div></li>)}</ul></div>}
      <div><div className="hud-label mb-1">Runs</div><ul className="space-y-1">{(sync?.runs || []).map(r => <li key={r.id} className="flex items-start gap-2 rounded-lg bg-navy-2/50 px-2 py-1 text-xs">
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${r.status === "ok" ? "bg-mint shadow-[0_0_6px_#7dffc8]" : "bg-alert shadow-[0_0_6px_#ff3b5c]"}`} />
        <div className="min-w-0 flex-1"><div className="text-snow">{new Date(r.ran_at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.source}{r.job_id ? ` · #${r.job_id}` : ""}</div>
        <div className="truncate text-[10px] text-ash">{r.status === "ok" ? Object.entries(r.counts || {}).map(([k, v]) => `${v} ${k}`).join(" · ") : r.error}</div></div></li>)}
        {!sync?.runs.length && <li className="text-xs text-ash">No runs logged yet.</li>}</ul></div>
    </div>}
  </div>);
}

/** Child switcher (017) + remount per child so every tab reloads that child's rows. */
export default function Education(p: { demo: boolean; log: (s: string, t?: "info" | "ok" | "warn") => void }) {
  const [c, setC] = useState(selectedChild()); useEffect(() => { const on = () => setC(selectedChild()); addEventListener("crystal-child", on); return () => removeEventListener("crystal-child", on); }, []);
  return <><ChildSwitcher /><EducationInner key={c || "all"} {...p} /></>;
}
