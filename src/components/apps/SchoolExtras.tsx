"use client";
import { useEffect, useState } from "react";
import { loadSchedule, loadAbsences, type Sched, type AbsP } from "@/lib/schoolx";
import { bellFor, hm, fmt12, BELL_SOURCE } from "@/lib/bell";
import { DISTRICT } from "@/lib/school";
import { eventsOn, isNoSchool } from "@/lib/district";
import { periods, span } from "@/lib/periods";
import { draftExcuse, loadExcuses, queueExcuse, cancelExcuse, studentIdentity, ATTENDANCE_EMAIL, ATTENDANCE_SOURCE, type Excuse, type Reason } from "@/lib/excuse";

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

type Group = { key: string; date: string; kind: "absence" | "tardy"; rows: AbsP[]; status: string };
const STATUS_TONE: Record<string, string> = { unexcused: "bg-alert/25 text-snow", unknown: "bg-amber-300/20 text-amber-100", excused: "bg-mint/20 text-mint", activity: "bg-cyan/15 text-cyan" };
export function AttendanceTab({ demo, rp }: { demo: boolean; totals: Record<string, number>; rp?: Parameters<typeof periods>[0] }) {
  const [rows, setRows] = useState<AbsP[] | "missing" | null>(null); const [ex, setEx] = useState<Excuse[] | "missing">([]); const [tick, setTick] = useState(0);
  const [compose, setCompose] = useState<Group | null>(null);
  useEffect(() => { loadAbsences(demo).then(setRows).catch(() => setRows([])); if (!demo) loadExcuses().then(setEx).catch(() => setEx([])); }, [demo, tick]);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60000); return () => clearInterval(t); }, []);
  if (rows === null) return <p className="text-xs text-ash">Loading…</p>;
  if (rows === "missing") return <Missing />;
  const groups: Group[] = []; for (const r of rows) { const kind = (r.kind as "tardy") === "tardy" ? "tardy" : "absence"; const k = r.date + kind; let g = groups.find(x => x.key === k); if (!g) groups.push(g = { key: k, date: r.date, kind, rows: [], status: "excused" }); g.rows.push(r); }
  for (const g of groups) g.status = g.rows.some(r => r.status === "unexcused") ? "unexcused" : g.rows.some(r => !r.status || r.status === "unknown") ? "unknown" : g.rows.every(r => r.status === "activity") ? "activity" : "excused";
  const q = periods(rp).quarters.map(x => span(x, ymdLocal(new Date()))).find(x => x.current);
  const inQ = (d: string) => !!q && !!q.start && !!q.end && d >= q.start && d <= q.end;
  const count = (f: (g: Group) => boolean) => ({ y: groups.filter(f).length, q: groups.filter(g => f(g) && inQ(g.date)).length });
  const cls = (f: (g: Group) => boolean) => groups.filter(f).reduce((n, g) => n + g.rows.length, 0);
  const C = [
    ["Days with a missed class", count(g => g.kind === "absence" && g.status !== "activity"), `${cls(g => g.kind === "absence" && g.status !== "activity")} classes missed in total`],
    ["Unexcused absence days", count(g => g.kind === "absence" && g.status === "unexcused"), "no excuse on file with the school"],
    ["Late arrivals (tardies)", count(g => g.kind === "tardy"), "days marked late to class"],
    ["School activity days", count(g => g.status === "activity"), "school-approved, not counted as absences"]] as const;
  const months = [...new Set(groups.map(g => g.date.slice(0, 7)))].sort(); const mx = Math.max(1, ...months.map(m => groups.filter(g => g.date.startsWith(m)).length));
  const exFor = (g: Group) => ex === "missing" ? undefined : ex.find(e => e.kind === g.kind && e.dates.includes(g.date) && e.mail_outbox?.status !== "cancelled");
  return (<div className="space-y-2">
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{C.map(([k, v, hint]) => <div key={k} className="rounded-lg bg-navy-2/60 px-1 py-2 text-center" title={hint}><div className="text-[11px] font-semibold uppercase tracking-wide text-ice">{k}</div><div className="font-mono text-2xl text-snow">{v.y}</div><div className="text-[11px] text-cyan">{q ? `${v.q} this quarter (${q.id})` : "this quarter: dates not available"}</div><div className="mt-0.5 text-[10px] text-slate">{hint}</div></div>)}</div>    {months.length > 0 && <div><div className="hud-label mb-1">Trend by month</div><div className="flex h-16 items-end gap-1.5" role="img" aria-label="Absences and tardies by month">{months.map(m => { const a = groups.filter(g => g.date.startsWith(m) && g.kind === "absence" && g.status !== "activity").length, t = groups.filter(g => g.date.startsWith(m) && g.kind === "tardy").length, s2 = groups.filter(g => g.date.startsWith(m) && g.status === "activity").length;
      return <div key={m} className="flex flex-1 flex-col items-center gap-0.5"><div className="flex w-full flex-1 flex-col-reverse overflow-hidden rounded-sm bg-navy-2/50">
        <div style={{ height: `${a / mx * 100}%`, background: "#ff3b5c", boxShadow: "0 0 6px #ff3b5c" }} title={`${a} absence day(s)`} /><div style={{ height: `${t / mx * 100}%`, background: "#fcd34d" }} title={`${t} tardy day(s)`} /><div style={{ height: `${s2 / mx * 100}%`, background: "#22d3ee" }} title={`${s2} school activity`} /></div>
        <span className="text-[9px] text-slate">{new Date(m + "-15T12:00").toLocaleDateString([], { month: "short" })}</span></div>; })}</div>
      <div className="mt-0.5 flex gap-2 text-[9px] text-ash"><span><i className="mr-0.5 inline-block h-2 w-2 bg-alert" />absence</span><span><i className="mr-0.5 inline-block h-2 w-2 bg-amber-300" />tardy</span><span><i className="mr-0.5 inline-block h-2 w-2 bg-cyan" />school activity</span></div></div>}
    {!groups.length ? <p className="text-xs text-ash">No absences or tardies recorded in ParentVUE.</p> :
      <ul className="space-y-1.5">{groups.map(g => { const e = exFor(g); const needs = g.status === "unexcused" || g.status === "unknown"; const st = e?.mail_outbox?.status;
        return <li key={g.key} className="rounded-lg border border-cyan/10 bg-navy-2/50 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-snow">{fd(g.date)}</span><span className="uppercase text-[10px] text-ash">{g.kind}</span>
          <span className={`rounded px-1.5 text-[10px] ${STATUS_TONE[g.status]}`}>{g.status === "unknown" ? "unexplained" : g.status === "activity" ? "school activity" : g.status}</span>
          <span className="text-[10px] text-ash">{g.rows[0].code}</span>
          <span className="ml-auto">{e ? (st === "sent" ? <span className="text-[11px] text-mint">✓ Excuse sent {e.mail_outbox?.sent_at ? new Date(e.mail_outbox.sent_at).toLocaleDateString() : ""}</span>
            : st === "queued" ? <span className="flex items-center gap-1 text-[11px] text-amber-200">Queued <button className="btn btn-ghost !px-1.5 !py-0 text-[10px]" onClick={() => cancelExcuse(e.outbox_id).then(() => setTick(x => x + 1)).catch(() => {})}>Cancel</button></span>
            : st === "sending" ? <span className="text-[11px] text-cyan">Sending…</span> : st === "failed" ? <span className="text-[11px] text-alert" title={e.mail_outbox?.error ?? ""}>Send failed</span> : null)
            : needs && ex !== "missing" && !demo ? <button className="btn btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => setCompose(g)}>✎ Draft Excuse Letter</button> : null}</span></div>
        {g.rows[0].note && <div className="text-[11px] italic text-ice">“{g.rows[0].note}”</div>}
        <div className="mt-1 flex flex-wrap gap-1">{g.rows.sort((a, b) => a.period - b.period).map(r => <span key={r.period} title={`${r.course ?? ""} · ${r.teacher ?? ""}`} className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] text-ash">P{r.period}{r.course ? ` ${r.course}` : ""}</span>)}</div>
      </li>; })}</ul>}
    <p className="text-[10px] text-slate">Source: ParentVUE attendance codes. Cobb requires excuses within 3 days.</p>
    {compose && <ExcuseComposer g={compose} onClose={() => setCompose(null)} onQueued={() => { setCompose(null); setTick(x => x + 1); }} />}
  </div>);
}

function ExcuseComposer({ g, onClose, onQueued }: { g: Group; onClose: () => void; onQueued: () => void }) {
  const [reason, setReason] = useState<Reason>("illness"); const [extra, setExtra] = useState(""); const [who, setWho] = useState<{ name: string; permId: string | null } | null>(null);
  const [to, setTo] = useState(ATTENDANCE_EMAIL); const [subject, setSubject] = useState(""); const [body, setBody] = useState(""); const [edited, setEdited] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const pers = g.rows.map(r => r.period);
  useEffect(() => { studentIdentity().then(setWho).catch(() => setWho({ name: "Eli", permId: null })); }, []);
  useEffect(() => { if (!who || edited) return; const d = draftExcuse({ student: who.name, permId: who.permId, kind: g.kind, dates: [g.date], periods: pers, reason, extra }); setSubject(d.subject); setBody(d.body); }, [who, reason, extra, edited]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }; window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true); }, [onClose]);
  async function send() { setBusy(true); setErr(""); try { await queueExcuse({ to: to.trim(), subject, body, dates: [g.date], periods: pers, kind: g.kind, reason }); onQueued(); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); } }
  return (<div role="dialog" aria-modal="true" aria-label="Draft excuse letter" className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-2 sm:items-center">
    <div className="max-h-[92vh] w-full max-w-lg space-y-2 overflow-auto rounded-xl border border-cyan/30 bg-navy-2/95 p-3 text-xs shadow-[0_0_24px_rgba(0,255,255,.2)]">
      <div className="flex items-center"><span className="hud-label">Excuse letter · {fd(g.date)} · {g.kind}</span><button className="btn btn-ghost ml-auto !px-2 !py-0.5" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="flex flex-wrap gap-1">{(["illness", "appointment", "family", "other"] as Reason[]).map(r => <button key={r} aria-pressed={reason === r} onClick={() => { setReason(r); setEdited(false); }} className={`rounded-full border px-2 py-0.5 capitalize ${reason === r ? "border-cyan bg-cyan/20 text-cyan" : "border-cyan/20 text-ash"}`}>{r}</button>)}</div>
      <input value={extra} onChange={e => { setExtra(e.target.value); setEdited(false); }} placeholder="Optional details (e.g. dentist appointment)" className="w-full rounded border border-cyan/20 bg-black/40 px-2 py-1 text-snow" />
      <label className="block text-ash">To <input value={to} onChange={e => setTo(e.target.value)} className="mt-0.5 w-full rounded border border-cyan/20 bg-black/40 px-2 py-1 text-snow" /></label>
      <p className="text-[10px] text-slate">Attendance inbox from <a className="underline" href={ATTENDANCE_SOURCE} target="_blank" rel="noreferrer">Dickerson&apos;s attendance page</a>.</p>
      <label className="block text-ash">Subject <input value={subject} onChange={e => { setSubject(e.target.value); setEdited(true); }} className="mt-0.5 w-full rounded border border-cyan/20 bg-black/40 px-2 py-1 text-snow" /></label>
      <textarea value={body} onChange={e => { setBody(e.target.value); setEdited(true); }} rows={11} className="w-full rounded border border-cyan/20 bg-black/40 px-2 py-1 font-sans text-[12px] leading-relaxed text-snow" aria-label="Letter" />
      {err && <p className="text-alert">{err}</p>}
      <div className="flex items-center gap-2"><span className="text-[10px] text-slate">Queued for your Gmail; sends within ~5 min. You can cancel while queued.</span>
        <button disabled={busy || !body.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())} onClick={send} className="btn ml-auto !px-3 !py-1">{busy ? "Queuing…" : "Send"}</button></div>
    </div></div>);
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
