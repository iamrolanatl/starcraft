"use client";
// Steps panel for the Health applet: progress ring vs editable goal, 7/30-day bars, streaks,
// DEFCON-style readiness badge, last iPhone sync, and the Connect iPhone (Shortcuts) panel.
import { useEffect, useMemo, useState } from "react";
import type { Row } from "@/lib/store";
import { sb } from "@/lib/supabase";
import { lsRaw, lsSet } from "@/lib/safe";
import { toast } from "@/components/ui/kit";
import { getSettings, saveSettings } from "@/lib/settings";

export const ENDPOINT = "https://crystal-7ot.pages.dev/api/health/steps";
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysBack = (n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return ymd(d); });

/** Per-day steps: the iPhone value wins for a day; otherwise manual entries are summed. */
export function dailySteps(rows: Row[]): Map<string, number> {
  const ip = new Map<string, number>(), man = new Map<string, number>();
  for (const r of rows) { if (r.kind !== "steps") continue; const d = String(r.logged_on); const v = Number(r.value || 0);
    if (r.source === "iphone") ip.set(d, Math.max(ip.get(d) ?? 0, v)); else man.set(d, (man.get(d) ?? 0) + v); }
  const out = new Map(man); for (const [d, v] of ip) out.set(d, v); return out;
}
export function streaks(by: Map<string, number>, goal: number) {
  const days = daysBack(400); let best = 0, run = 0;
  for (const d of days) { run = (by.get(d) ?? 0) >= goal ? run + 1 : 0; best = Math.max(best, run); }
  // current streak: today counts if met; otherwise count from yesterday back
  let cur = 0; const rev = [...days].reverse(); const start = (by.get(rev[0]) ?? 0) >= goal ? 0 : 1;
  for (let i = start; i < rev.length && (by.get(rev[i]) ?? 0) >= goal; i++) cur++;
  return { cur, best };
}
/** DEFCON 5 (relaxed, good) → 1 (critical) from the 7-day average vs goal. */
export function readiness(avg7: number, goal: number, hasData: boolean) {
  if (!hasData) return { level: 0, label: "NO SIGNAL", color: "#8a96a8" };
  const p = avg7 / goal;
  return p >= 1 ? { level: 5, label: "DEFCON 5 · READY", color: "#7dffc8" } : p >= .75 ? { level: 4, label: "DEFCON 4 · STEADY", color: "#3ef2e0" }
    : p >= .5 ? { level: 3, label: "DEFCON 3 · ELEVATED", color: "#ffd166" } : p >= .25 ? { level: 2, label: "DEFCON 2 · LOW", color: "#ff9a5c" } : { level: 1, label: "DEFCON 1 · CRITICAL", color: "#ff3b5c" };
}

function Ring({ value, goal }: { value: number; goal: number }) {
  const p = Math.min(1, value / goal), R = 52, C = 2 * Math.PI * R;
  const col = p >= 1 ? "#7dffc8" : p >= .5 ? "#3ef2e0" : "#ffd166";
  return (<svg viewBox="0 0 128 128" className="h-32 w-32 shrink-0" role="img" aria-label={`${value.toLocaleString()} of ${goal.toLocaleString()} steps today`}>
    <circle cx="64" cy="64" r={R} fill="rgba(4,12,24,.85)" stroke="rgba(62,242,224,.15)" strokeWidth="10" />
    <circle cx="64" cy="64" r={R} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 64 64)" style={{ filter: `drop-shadow(0 0 4px ${col})`, transition: "stroke-dasharray .6s" }} />
    <text x="64" y="60" textAnchor="middle" fontSize="20" fontWeight="700" fill="#eef6ff">{value.toLocaleString()}</text>
    <text x="64" y="84" textAnchor="middle" fontSize="10" fill="#9fb3c8">{Math.round(p * 100)}% of {goal >= 1000 ? `${+(goal / 1000).toFixed(1)}k` : goal}</text>
  </svg>);
}
function Bars({ days, by, goal }: { days: string[]; by: Map<string, number>; goal: number }) {
  const max = Math.max(goal, ...days.map(d => by.get(d) ?? 0)) * 1.05; const gy = 100 - (goal / max) * 100;
  return (<div className="relative h-24 w-full rounded-md bg-[rgba(4,12,24,.75)] px-1 pt-1" aria-label="Daily steps chart">
    <div className="pointer-events-none absolute inset-x-1 border-t border-dashed border-mint/50" style={{ top: `${gy}%` }} />
    <div className="flex h-full items-end gap-[2px]">{days.map(d => { const v = by.get(d) ?? 0; return (
      <div key={d} title={`${d}: ${v.toLocaleString()} steps`} className="flex-1 rounded-t-sm" style={{ height: `${Math.max(v ? 3 : 1, (v / max) * 100)}%`, background: v >= goal ? "#7dffc8" : v ? "#3ef2e0" : "rgba(159,179,200,.2)", opacity: v ? .9 : 1 }} />); })}</div>
  </div>);
}

export function StepsPanel({ rows, onLog }: { rows: Row[]; onLog: (v: number) => void }) {
  const [goal, setGoalS] = useState(10000); const [range, setRange] = useState<7 | 30>(7); const [val, setVal] = useState(""); const [connect, setConnect] = useState(false);
  useEffect(() => { const g = getSettings().stepGoal || Number(lsRaw("crystal.stepGoal")); if (g >= 500 && g <= 100000) setGoalS(g); const f = () => setGoalS(getSettings().stepGoal); addEventListener("crystal-settings", f); return () => removeEventListener("crystal-settings", f); }, []);
  const setGoal = (g: number) => { if (g >= 500 && g <= 100000) { setGoalS(g); saveSettings({ stepGoal: g }); } };
  const by = useMemo(() => dailySteps(rows), [rows]);
  const t = ymd(new Date()); const today = by.get(t) ?? 0;
  const d7 = daysBack(7), d30 = daysBack(30);
  const avg7 = Math.round(d7.reduce((s, d) => s + (by.get(d) ?? 0), 0) / 7);
  const avg30 = Math.round(d30.reduce((s, d) => s + (by.get(d) ?? 0), 0) / 30);
  const st = streaks(by, goal); const rd = readiness(avg7, goal, by.size > 0);
  const iph = rows.filter(r => r.kind === "steps" && r.source === "iphone");
  const lastSync = iph.map(r => String(r.updated_at || r.created_at)).sort().at(-1);
  return (<div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded border px-2 py-0.5 font-mono text-[11px] font-bold tracking-wider" style={{ color: rd.color, borderColor: rd.color, background: "rgba(4,12,24,.85)" }}>{rd.label}</span>
      <span className="text-[11px] text-ash">{lastSync ? `iPhone sync ${new Date(lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "No data from iPhone yet"}</span>
      <button onClick={() => setConnect(c => !c)} className="ml-auto rounded border border-cyan/40 px-2 py-0.5 text-xs text-cyan hover:bg-cyan/10">{connect ? "Close" : "Connect iPhone"}</button>
    </div>
    {connect && <ConnectIphone />}
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <Ring value={today} goal={goal} />
      <div className="grid w-full grid-cols-2 gap-2 text-center">
        {[["Current streak", `${st.cur} day${st.cur === 1 ? "" : "s"}`], ["Best streak", `${st.best} day${st.best === 1 ? "" : "s"}`], ["7-day avg", avg7.toLocaleString()], ["30-day avg", avg30.toLocaleString()]].map(([k, v]) => (
          <div key={k} className="rounded-md bg-[rgba(4,12,24,.8)] px-2 py-1.5"><div className="text-[10px] uppercase tracking-wider text-slate">{k}</div><div className="text-base font-semibold text-snow">{v}</div></div>))}
      </div>
    </div>
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs"><span className="text-ash">Daily steps</span>
        {([7, 30] as const).map(n => <button key={n} onClick={() => setRange(n)} aria-pressed={range === n} className={`rounded px-2 py-0.5 ${range === n ? "bg-cyan/20 text-cyan" : "text-ash"}`}>{n} Days</button>)}
        <label className="ml-auto flex items-center gap-1 text-ash">Goal <input type="number" inputMode="numeric" min={500} step={500} defaultValue={goal} key={goal} onBlur={e => setGoal(Number(e.target.value))} className="input w-20 py-0.5 text-xs" aria-label="Daily step goal" /></label></div>
      <Bars days={range === 7 ? d7 : d30} by={by} goal={goal} />
    </div>
    {!iph.length && <p className="rounded-md bg-[rgba(4,12,24,.8)] p-2 text-xs text-ash">No data from iPhone yet. Tap <b className="text-cyan">Connect iPhone</b> to set up the Shortcut, or log steps by hand below.</p>}
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const v = Number(val); if (!v || v < 0) return; onLog(v); setVal(""); }}>
      <input className="input text-sm" type="number" inputMode="numeric" min={0} placeholder="Add steps by hand" value={val} onChange={e => setVal(e.target.value)} aria-label="Steps value" />
      <button className="btn btn-primary text-sm">Log</button>
    </form>
  </div>);
}

function ConnectIphone() {
  const [st, setSt] = useState<{ has_token?: boolean; last_used_at?: string | null; token_created_at?: string | null } | null>(null);
  const [tok, setTok] = useState<string | null>(null); const [show, setShow] = useState(false); const [err, setErr] = useState("");
  useEffect(() => { setTok(lsRaw("crystal.healthToken") || null);
    sb().rpc("health_ingest_status").then(({ data, error }) => error ? setErr(error.message.includes("function") ? "Setup step pending: migration 010 hasn't been run yet." : error.message) : setSt(data)); }, []);
  const gen = async () => {
    if (st?.has_token && !confirm("Make a new token? The old one stops working, so you'll need to paste the new one into your Shortcut.")) return;
    const { data: s } = await sb().auth.getSession(); if (!s.session) { toast("Sign in first", "warn"); return; }
    const { data, error } = await sb().rpc("health_rotate_token"); if (error) { setErr(error.message); return; }
    setTok(String(data)); lsSet("crystal.healthToken", String(data)); setShow(true); setSt(x => ({ ...x, has_token: true })); toast("New iPhone token created");
  };
  const copy = (s: string, what: string) => navigator.clipboard?.writeText(s).then(() => toast(`${what} copied`), () => toast("Copy failed", "warn"));
  return (<div className="space-y-2 rounded-md border border-cyan/30 bg-[rgba(4,12,24,.92)] p-3 text-xs leading-relaxed text-snow">
    <div className="font-semibold text-cyan">Connect iPhone (Apple Health → Crystal)</div>
    {err && <p className="text-amber-200">{err}</p>}
    <div><div className="text-slate">Endpoint</div><div className="flex items-center gap-2"><code className="break-token text-mint">{ENDPOINT}</code><button onClick={() => copy(ENDPOINT, "URL")} className="text-cyan">Copy</button></div></div>
    <div><div className="text-slate">Token {st?.last_used_at ? `· last used ${new Date(st.last_used_at).toLocaleString()}` : ""}</div>
      {tok ? <div className="flex flex-wrap items-center gap-2"><code className="break-token">{show ? tok : "hst_" + "•".repeat(16)}</code><button onClick={() => setShow(s => !s)} className="text-cyan">{show ? "Hide" : "Reveal"}</button><button onClick={() => copy(tok, "Token")} className="text-cyan">Copy</button></div>
        : <p className="text-ash">{st?.has_token ? "A token exists but isn't saved on this device (only its fingerprint is stored on the server). Make a new one to see it here." : "No token yet."}</p>}
      <button onClick={gen} className="mt-1 rounded border border-cyan/40 px-2 py-0.5 text-cyan hover:bg-cyan/10">{st?.has_token ? "Make new token" : "Create token"}</button></div>
    <ol className="list-decimal space-y-1 pl-4 text-ash">
      <li>On your iPhone, open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Time of Day</b>. Choose 9:00 PM, Daily, and <b>Run Immediately</b>.</li>
      <li>Add <b>Find Health Samples</b>: Type is <b>Steps</b>, Start Date <b>is today</b>.</li>
      <li>Add <b>Calculate Statistics</b>: <b>Sum</b> of Health Samples.</li>
      <li>Add <b>Format Date</b>: Current Date, Custom format <code>yyyy-MM-dd</code>.</li>
      <li>Add <b>Get Contents of URL</b>: paste the endpoint, Method <b>POST</b>, add a Header <code>Authorization</code> = <code>Bearer </code>+ your token, Request Body <b>JSON</b> with <code>date</code> = Formatted Date and <code>steps</code> = Statistics (Number).</li>
      <li>Optional: make copies for every hour (Time of Day automations, one per hour you want), and run the 7-day backfill Shortcut once. Full guide: <a className="text-cyan underline" href="/docs/iphone-steps" target="_blank" rel="noreferrer">crystal-7ot.pages.dev/docs/iphone-steps</a>.</li>
    </ol>
    <p className="text-slate">Crystal keeps the larger number for each day, so blank or zero sends never erase your steps.</p>
  </div>);
}
