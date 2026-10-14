"use client";
import { useEffect, useMemo, useState } from "react";
import { gradeView, type GRow } from "@/lib/gradeview";
import { loadEducation, loadSyncStatus, requestSync, jobStatus, type EduData, type GradeRow, type SyncStatus } from "@/lib/education";
import { sfx } from "@/lib/synth";

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => d ? new Date(d.length === 10 ? d + "T12:00" : d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "—";
const tone = (p: number | null) => p == null ? "text-slate" : p >= 90 ? "text-mint" : p >= 80 ? "text-cyan" : p >= 70 ? "text-amber-300" : "text-alert";
const ago = (iso: string | null) => { if (!iso) return "never"; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
type Tab = "grades" | "work" | "comms" | "calendar" | "sync";

function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return <span className="inline-block w-16 text-[10px] text-slate">no trend</span>;
  const lo = Math.min(...pts) - 2, hi = Math.max(...pts) + 2, w = 64, h = 18;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - lo) / (hi - lo || 1)) * h}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return <svg width={w} height={h} aria-hidden className="overflow-visible"><polyline points={d} fill="none" stroke={up ? "#7dffc8" : "#ff3b5c"} strokeWidth="1.6" style={{ filter: "drop-shadow(0 0 3px currentColor)" }} /></svg>;
}

export default function Education({ demo, log }: { demo: boolean; log: (s: string, t?: "info" | "ok" | "warn") => void }) {
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

  if (err) return <p className="text-sm text-alert">{err}</p>;
  if (data === undefined) return <p className="text-sm text-ash">Linking to school uplink…</p>;
  if (data === null) return <p className="text-sm text-ash">No school data yet. The box sync fills this after your next ParentVUE pull.</p>;
  const missing = data.assignments.filter(a => a.missing || a.zero);
  const upcoming = data.assignments.filter(a => !a.missing && a.due_date && a.due_date >= today()).slice(0, 12);
  const cal = data.calendar.filter(c => c.date >= today()).slice(0, 14);
  const at = data.student.attendance_totals || {};
  const TABS: [Tab, string, number?][] = [["grades", "Grades"], ["work", "Work", missing.length], ["comms", "Messages", data.messages.filter(m => m.unread).length], ["calendar", "Calendar"], ["sync", "Sync log", sync?.alerts.filter(a => Date.now() - new Date(a.created_at).getTime() < 864e5).length]];

  return (<div className="space-y-3 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ash">
      <span className="font-semibold text-snow">{data.student.name}</span><span>Gr {Number(data.student.grade) || data.student.grade}</span><span className="truncate">{data.student.school}</span>
      <span className="text-cyan">{data.student.reporting_period?.name}</span>
      <span className="ml-auto" title={data.student.last_fetched_at ?? ""}>⟳ {ago(data.student.last_fetched_at)}</span>
      <button onClick={doSync} disabled={!!busy} className="btn btn-ghost !px-2 !py-0.5 text-[11px]" aria-label="Sync school data now">{busy || "⟳ Sync"}</button>
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
    {tab === "grades" && <div className="space-y-2">
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
        return (<li key={c.key} data-class={c.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cyan/5">
          <span className="w-4 font-mono text-xs text-slate">{c.period}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-snow" title={c.course}>{c.course}</div>
            <div className="truncate text-xs text-slate" title={`${c.teacher ?? ""} · ${sub}`}>{c.teacher} · <span data-sub>{sub}</span></div></div>
          <Spark pts={c.trend} />
          <span className="shrink-0 text-right">{main != null ? <><span data-main className={`block font-mono text-sm ${tone(main)}`}>{fmt(main)}</span><span className="block text-[10px] text-slate">{mainLbl}</span></> : <span data-main className="text-xs text-ash">{qv === "final" || fp == null ? "Not posted" : "Not posted yet"}</span>}</span>
        </li>); })}{!gv.current.length && <li className="text-xs text-ash">No classes in the latest sync.</li>}</ul>
      {gv.completed.length > 0 && <div><div className="hud-label mb-1">Completed courses</div><ul className="space-y-1" aria-label="Completed courses">{gv.completed.map(f => <li key={f.course_key} data-class={f.course_key} className="flex items-center gap-2 rounded-lg px-2 py-1 text-ash"><div className="min-w-0 flex-1"><div className="truncate">{f.course}</div><div className="truncate text-xs text-slate">{f.teacher} · {f.term} final</div></div><span className={`font-mono ${tone(f.percent)}`}>{f.percent ?? f.mark}</span></li>)}</ul></div>}
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
