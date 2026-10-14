"use client";
// Settings center: Profile + grouped preferences. Saved in user_prefs (RLS) / profiles, applied live, reset to defaults.
import { useEffect, useState } from "react";
import { DEFAULTS, getSettings, saveSettings, resetSettings, BG_PRESETS, type Settings } from "@/lib/settings";
import { getProfile, loadProfile, saveProfile } from "@/lib/profile";
import { greeting, type Profile } from "@/lib/names";
import { getPrefs, savePrefs, type Clarity } from "@/lib/prefs";
import { sb } from "@/lib/supabase"; import { isDemo } from "@/lib/store"; import { toast } from "@/components/ui/kit";
const TABS = ["Profile", "Appearance", "Layout", "Crystal AI", "Alerts", "School", "Email", "Health", "Calendar", "Connections", "Privacy & Data"] as const;
type Tab = typeof TABS[number];
const SKINS: { id: Settings["theme"]; name: string; desc: string; bg: string; fg: string; acc: string }[] = [
  { id: "cockpit", name: "Crystal Cockpit", desc: "Space-command nebula with DEFCON glow (default)", bg: "linear-gradient(135deg,#0b1430,#060b1a)", fg: "#E8F4FF", acc: "#3ef2e0" },
  { id: "blockcraft", name: "Blockcraft", desc: "Voxel blocks, grass and dirt, pixel headings", bg: "linear-gradient(#5fae3d 0 22%, #6f4b2c 22%)", fg: "#f6eedd", acc: "#8be05f" },
  { id: "brickcity", name: "Brick City", desc: "Bright primaries and chunky rounded tiles", bg: "linear-gradient(135deg,#ffd23f 0 33%,#4aa3ff 33% 66%,#ff5a5f 66%)", fg: "#0d1530", acc: "#0a58d0" },
  { id: "battleisland", name: "Battle Island", desc: "Storm-sky purple and blue with bold type", bg: "linear-gradient(180deg,#2a1170,#4b1fa8 55%,#1a3f8f)", fg: "#ffffff", acc: "#ffd23f" },
  { id: "kartrush", name: "Kart Rush", desc: "Cheerful red, yellow and blue with stars and coins", bg: "linear-gradient(180deg,#3aa0ff,#7fd0ff 70%,#5cc95c 70%)", fg: "#0a1f55", acc: "#e4000f" },
];
const APPS: [string, string][] = [["home", "Top Priorities"], ["tasks", "To-Do List"], ["health", "Health"], ["comms", "Communications"], ["education", "Education"], ["school", "School Hub"], ["finance", "Finance"], ["shopping", "Shopping"], ["ocr", "OCR Scanner"], ["crystal", "Crystal Co-Pilot"]];
function Row({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return <label className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan/10 py-2.5" data-tip={tip}><span className="min-w-[10rem] text-snow">{label}</span><span className="flex flex-wrap items-center gap-2">{children}</span></label>;
}
const Tog = ({ v, on, label }: { v: boolean; on: (b: boolean) => void; label: string }) => <button type="button" role="switch" aria-checked={v} aria-label={label} onClick={() => on(!v)} className={`tap relative h-7 w-12 rounded-full border ${v ? "border-cyan bg-cyan/40" : "border-slate/60 bg-navy-2"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-snow transition-all ${v ? "left-6" : "left-0.5"}`} /></button>;
function Seg<T extends string>({ v, opts, on, label }: { v: T; opts: [T, string][]; on: (t: T) => void; label: string }) {
  return <span role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">{opts.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={v === k} onClick={() => on(k)} className={`tap rounded-lg border px-2.5 py-1 text-sm ${v === k ? "border-cyan bg-cyan/20 text-snow" : "border-slate/40 text-ash"}`}>{l}</button>)}</span>;
}
export default function SettingsCenter({ open, onClose, initialTab = "Profile" }: { open: boolean; onClose: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab); const [s, setS] = useState<Settings>(getSettings()); const [p, setP] = useState<Profile>(getProfile());
  const [conn, setConn] = useState<Record<string, string>>({}); const [clarity, setClarity] = useState<Clarity>(getPrefs().glass ?? "balanced");
  useEffect(() => { if (open) { setTab(initialTab); setS(getSettings()); loadProfile().then(setP); } }, [open, initialTab]);
  useEffect(() => { if (!open || tab !== "Connections") return; (async () => {
    const out: Record<string, string> = {}; if (isDemo()) { setConn({ google: "Demo mode", steps: "Demo mode", agent: "Demo mode", o365: "Demo mode" }); return; }
    const { data: ss } = await sb().auth.getSession(); out.google = ss.session?.user.app_metadata?.provider === "google" ? `Connected (${ss.session.user.email})` : "Not connected";
    const q = async (t: string, col: string, sel = col) => { try { const { data } = await sb().from(t).select(sel).order(col, { ascending: false }).limit(1); return (data?.[0] as unknown as Record<string, string> | undefined)?.[col] ?? null; } catch { return null; } };
    const st = await q("health_ingest_tokens", "last_used_at"); out.steps = st ? `Connected · last sync ${new Date(st).toLocaleString()}` : "Not connected";
    const ag = await q("edu_sync_runs", "started_at"); out.agent = ag ? `Active · last run ${new Date(ag).toLocaleString()}` : "No runs yet";
    const ml = await q("mail_messages", "received_at"); out.o365 = ml ? `Connected · newest mail ${new Date(ml).toLocaleString()}` : "Not connected";
    setConn(out); })(); }, [open, tab]);
  if (!open) return null;
  const set = (k: Partial<Settings>) => setS(saveSettings(k));
  const exportData = async () => {
    const tables = ["profiles", "user_prefs", "tasks", "health_logs", "meds", "bills", "credit_scores", "stocks", "shop_items", "comms_notes", "edu_students", "edu_grades", "edu_assignments", "edu_attendance", "edu_calendar", "edu_alerts", "drive_pins", "report_cards"];
    const out: Record<string, unknown> = { exported_at: new Date().toISOString() };
    if (isDemo()) { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith("crystal")) out[k] = localStorage.getItem(k); } }
    else for (const t of tables) { try { const { data, error } = await sb().from(t).select("*").limit(5000); out[t] = error ? { error: error.message } : data; } catch (e) { out[t] = { error: String(e) }; } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" })); a.download = `crystal-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast("Export downloaded", "ok");
  };
  const signOutAll = async () => { if (!confirm("Sign out of Crystal on every device?")) return; if (!isDemo()) await sb().auth.signOut({ scope: "global" }); location.href = "/"; };
  const pf = (k: keyof Profile) => <input className="input w-56" value={p[k] ?? ""} onChange={e => setP({ ...p, [k]: e.target.value })} aria-label={String(k)} />;
  return (<div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
    <div role="dialog" aria-modal aria-label="Settings" onClick={e => e.stopPropagation()} className="glass flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl">
      <header className="flex items-center justify-between border-b border-cyan/15 px-4 py-3"><h2 className="text-lg font-semibold text-snow">Settings</h2>
        <span className="flex gap-2"><button className="btn btn-ghost text-sm" onClick={() => { if (confirm("Reset all settings to defaults?")) { resetSettings(); setS(getSettings()); toast("Settings reset to defaults", "info"); } }}>Reset to Defaults</button>
          <button className="btn btn-ghost text-sm" onClick={onClose} aria-label="Close Settings">✕</button></span></header>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav role="tablist" aria-label="Settings sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-cyan/10 p-2 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r">
          {TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`tap rounded-lg px-3 py-2 text-left text-sm ${tab === t ? "bg-cyan/15 text-snow" : "text-ash hover:text-snow"}`}>{t}</button>)}
        </nav>
        <div className="applet-body min-h-0 flex-1 overflow-y-auto px-4 pb-6" role="tabpanel" aria-label={tab}>
          {tab === "Profile" && <>
            <div className="flex items-center gap-3 py-3">{p.avatar_url ? <img src={p.avatar_url} alt="" className="h-14 w-14 rounded-full border border-cyan/40" referrerPolicy="no-referrer" /> : <div className="grid h-14 w-14 place-items-center rounded-full bg-navy-2 text-xl">👤</div>}
              <div><div className="text-base font-semibold text-snow">{p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Commander"}</div><div className="text-sm text-ash">Preview: “{greeting(p)}”</div></div></div>
            <Row label="First Name" tip="From your Google account; capitalization is normalized">{pf("first_name")}</Row>
            <Row label="Last Name" tip="From your Google account">{pf("last_name")}</Row>
            <Row label="Display Name" tip="Shown in menus">{pf("display_name")}</Row>
            <Row label="Nickname" tip="Crystal greets you with this first, if set">{pf("nickname")}</Row>
            <Row label="Time Zone" tip="Used for greetings and due times">{pf("timezone")}</Row>
            <div className="pt-3"><button className="btn btn-primary" onClick={async () => { const r = await saveProfile(p); setP(getProfile()); toast(r.ok ? "Profile saved" : `Couldn't save: ${r.error}`, r.ok ? "ok" : "warn"); }}>Save Profile</button></div>
          </>}
          {tab === "Appearance" && <>
            <div className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Theme">{SKINS.map(k =>
              <button key={k.id} role="radio" aria-checked={s.theme === k.id} onClick={() => set({ theme: k.id })} data-skin-card={k.id} className={`tap rounded-xl border-2 p-3 text-left ${s.theme === k.id ? "border-cyan" : "border-transparent"}`} style={{ background: k.bg, color: k.fg }}>
                <div className="font-semibold">{k.name}</div><div className="text-sm opacity-90">{k.desc}</div><div className="mt-2 h-1.5 w-16 rounded" style={{ background: k.acc }} /></button>)}</div>
            <Row label="Accent Color" tip="Highlight color for focus rings and accents"><input type="color" value={s.accent} onChange={e => set({ accent: e.target.value })} aria-label="Accent Color" className="h-9 w-14 rounded" /></Row>
            <Row label="Text Size" tip="Scales body text across Crystal"><Seg label="Text Size" v={s.textSize} on={v => set({ textSize: v })} opts={[["S", "S"], ["M", "M"], ["L", "L"], ["XL", "XL"]]} /></Row>
            <Row label="High Contrast" tip="Brighter text and solid panels"><Tog label="High Contrast" v={s.highContrast} on={v => set({ highContrast: v })} /></Row>
            <Row label="Reading Mode" tip="Dims the video, makes glass more opaque, slows animations"><Tog label="Reading Mode" v={s.reading} on={v => set({ reading: v })} /></Row>
            <Row label="Glass Clarity" tip="How see-through the panels are"><Seg label="Glass Clarity" v={clarity} on={v => { setClarity(v); savePrefs({ glass: v }); }} opts={[["clear", "Clear"], ["balanced", "Balanced"], ["solid", "Solid"]]} /></Row>
            <Row label="Glass Opacity" tip="Fine-tune panel opacity (60–98%)"><input type="range" min={60} max={98} value={s.glassOpacity} onChange={e => set({ glassOpacity: +e.target.value })} aria-label="Glass Opacity" /><span className="w-10 text-sm text-ash">{s.glassOpacity}%</span></Row>
            <Row label="Background Video" tip="Show, hide or rotate the space background"><Seg label="Background Video" v={s.video} on={v => set({ video: v })} opts={[["on", "On"], ["off", "Off"], ["rotate", "Rotate"]]} /></Row>
            <Row label="Background Motion" tip="Video speed: 0 pauses on the poster image"><input type="range" min={0} max={1.5} step={0.25} value={s.bgSpeed} onChange={e => set({ bgSpeed: +e.target.value })} aria-label="Background Motion" /><span className="w-12 text-sm text-ash">{s.bgSpeed === 0 ? "Paused" : `${s.bgSpeed}×`}</span>
              <Seg label="Motion Presets" v={(Object.entries(BG_PRESETS).find(([, v]) => v === s.bgSpeed)?.[0] ?? "") as keyof typeof BG_PRESETS} on={k => set({ bgSpeed: BG_PRESETS[k] })} opts={Object.keys(BG_PRESETS).map(k => [k, k]) as [keyof typeof BG_PRESETS, string][]} /></Row>
            <Row label="UI Animations" tip="Interface animation intensity (separate from video speed)"><Seg label="UI Animations" v={s.uiMotion} on={v => set({ uiMotion: v })} opts={[["system", "System"], ["off", "Off"], ["reduced", "Reduced"], ["full", "Full"]]} /></Row>
          </>}
          {tab === "Layout" && <>
            <Row label="Default Applet" tip="Opens when Crystal starts"><select className="input" value={s.defaultApplet} onChange={e => set({ defaultApplet: e.target.value })} aria-label="Default Applet">{APPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Row>
            <Row label="Open Applets As" tip="Maximize one at a time, or tile open applets like a puzzle"><Seg label="Open Applets As" v={s.openMode} on={v => set({ openMode: v })} opts={[["maximize", "Maximize"], ["tile", "Tile"]]} /></Row>
            <div className="py-2 text-snow" data-tip="Choose which applets appear in the dock and their order">Dock Applets</div>
            <ol className="space-y-1">{(s.dock.length ? s.dock : APPS.map(a => a[0])).map((id, i, arr) => <li key={id} className="flex items-center gap-2 rounded-lg bg-navy-2/50 px-2 py-1"><span className="flex-1 text-snow">{APPS.find(a => a[0] === id)?.[1] ?? id}</span>
              <button className="tap btn btn-ghost !px-2" aria-label="Move Up" disabled={i === 0} onClick={() => { const d = [...arr]; [d[i - 1], d[i]] = [d[i], d[i - 1]]; set({ dock: d }); }}>↑</button>
              <button className="tap btn btn-ghost !px-2" aria-label="Move Down" disabled={i === arr.length - 1} onClick={() => { const d = [...arr]; [d[i + 1], d[i]] = [d[i], d[i + 1]]; set({ dock: d }); }}>↓</button>
              <button className="tap btn btn-ghost !px-2" aria-label="Remove From Dock" onClick={() => set({ dock: arr.filter(x => x !== id) })}>✕</button></li>)}</ol>
            {APPS.some(a => s.dock.length && !s.dock.includes(a[0])) && <div className="flex flex-wrap gap-1 pt-2">{APPS.filter(a => !s.dock.includes(a[0])).map(([k, l]) => <button key={k} className="btn btn-ghost text-sm" onClick={() => set({ dock: [...s.dock, k] })}>+ {l}</button>)}</div>}
          </>}
          {tab === "Crystal AI" && <>
            <Row label="Voice" tip="Let Crystal speak"><Tog label="Voice" v={s.voice} on={v => set({ voice: v })} /></Row>
            <Row label="Voice Choice" tip="System voice used for speech"><select className="input" value={s.voiceName} onChange={e => set({ voiceName: e.target.value })} aria-label="Voice Choice"><option value="">Default</option>{(typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []).filter(v => v.lang.startsWith("en")).map(v => <option key={v.name}>{v.name}</option>)}</select></Row>
            <Row label="Voice Speed" tip="0.7× to 1.4×"><input type="range" min={0.7} max={1.4} step={0.05} value={s.voiceRate} onChange={e => set({ voiceRate: +e.target.value })} aria-label="Voice Speed" /><span className="text-sm text-ash">{s.voiceRate.toFixed(2)}×</span></Row>
            <Row label="Auto-Speak Answers" tip="Read every answer aloud"><Tog label="Auto-Speak Answers" v={s.autoSpeak} on={v => set({ autoSpeak: v })} /></Row>
            <Row label="Wake on Mic" tip="Listen for “Hey Crystal” when the mic is allowed"><Tog label="Wake on Mic" v={s.wakeOnMic} on={v => set({ wakeOnMic: v })} /></Row>
            <Row label="Escalate to Stronger Model" tip="Hand hard questions to the stronger model"><Tog label="Escalate to Stronger Model" v={s.escalate} on={v => set({ escalate: v })} /></Row>
          </>}
          {tab === "Alerts" && <>
            <Row label="Grade Below Threshold" tip="Alert when a class grade drops below the threshold"><Tog label="Grade Below Threshold" v={s.alerts.gradeBelow} on={v => set({ alerts: { ...s.alerts, gradeBelow: v } })} /><input type="number" min={50} max={100} className="input w-20" value={s.alerts.gradeThreshold} onChange={e => set({ alerts: { ...s.alerts, gradeThreshold: +e.target.value } })} aria-label="Grade Threshold" />%</Row>
            {([["missing", "Missing Assignments", "Alert on missing or zero assignments"], ["absences", "Absences", "Alert on new absences or tardies"], ["teacherEmail", "New Teacher Email", "Alert when a teacher writes"], ["lowSteps", "Low Steps", "Evening nudge if steps are under goal"]] as const).map(([k, l, t]) =>
              <Row key={k} label={l} tip={t}><Tog label={l} v={s.alerts[k]} on={v => set({ alerts: { ...s.alerts, [k]: v } })} /></Row>)}
            <Row label="Quiet Hours" tip="No sounds or pop-ups during these hours"><input type="time" className="input" value={s.quietStart} onChange={e => set({ quietStart: e.target.value })} aria-label="Quiet Hours Start" />to<input type="time" className="input" value={s.quietEnd} onChange={e => set({ quietEnd: e.target.value })} aria-label="Quiet Hours End" /></Row>
            <Row label="DEFCON Sensitivity" tip="How quickly threats raise the DEFCON level"><Seg label="DEFCON Sensitivity" v={s.defconSensitivity} on={v => set({ defconSensitivity: v })} opts={[["low", "Low"], ["normal", "Normal"], ["high", "High"]]} /></Row>
          </>}
          {tab === "School" && <>
            <Row label="Grade Goal (All Classes)" tip="Target percent used for goal bars"><input type="number" min={50} max={100} className="input w-20" value={s.gradeGoal} onChange={e => set({ gradeGoal: +e.target.value })} aria-label="Grade Goal" />%</Row>
            <Row label="Default Quarter View" tip="Which quarter the Grades tab shows first"><Seg label="Default Quarter View" v={s.quarterView} on={v => set({ quarterView: v })} opts={[["final", "Last Final"], ["live", "Current Quarter"]]} /></Row>
            <Row label="Show Ungraded Assignments" tip="Include assignments without a score"><Tog label="Show Ungraded Assignments" v={s.showUngraded} on={v => set({ showUngraded: v })} /></Row>
          </>}
          {tab === "Email" && <>
            <Row label="Auto-Draft Teacher Replies" tip="Crystal drafts replies for you to review; nothing is sent automatically"><Tog label="Auto-Draft Teacher Replies" v={s.autoDraft} on={v => set({ autoDraft: v })} /></Row>
            <Row label="Signature" tip="Added to drafts"><textarea className="input w-72" rows={3} value={s.signature} onChange={e => set({ signature: e.target.value })} aria-label="Signature" /></Row>
            <Row label="Send Delay" tip="Seconds to undo after pressing Send"><input type="number" min={0} max={120} className="input w-20" value={s.sendDelay} onChange={e => set({ sendDelay: +e.target.value })} aria-label="Send Delay" />s</Row>
          </>}
          {tab === "Health" && <>
            <Row label="Daily Step Goal" tip="Used by the Health applet and low-steps alert"><input type="number" min={500} max={100000} step={500} className="input w-28" value={s.stepGoal} onChange={e => set({ stepGoal: +e.target.value })} aria-label="Daily Step Goal" /></Row>
            <Row label="Units" tip="Weight and distance units"><Seg label="Units" v={s.units} on={v => set({ units: v })} opts={[["imperial", "Imperial (lb, mi)"], ["metric", "Metric (kg, km)"]]} /></Row>
          </>}
          {tab === "Calendar" && <>
            <Row label="Week Starts On" tip="First column of month views"><Seg label="Week Starts On" v={s.weekStart} on={v => set({ weekStart: v })} opts={[["sun", "Sunday"], ["mon", "Monday"]]} /></Row>
            {([["tasks", "Tasks"], ["school", "School (ParentVUE)"], ["district", "District Calendar"], ["google", "Google Calendar"]] as const).map(([k, l]) => <Row key={k} label={`Show ${l}`} tip={`Include ${l} events`}><Tog label={`Show ${l}`} v={s.calSources[k]} on={v => set({ calSources: { ...s.calSources, [k]: v } })} /></Row>)}
            <Row label="Time Zone" tip="Calendar display time zone"><input className="input w-56" value={s.timezone} onChange={e => set({ timezone: e.target.value })} aria-label="Calendar Time Zone" /></Row>
          </>}
          {tab === "Connections" && <>
            {([["google", "Google", "Sign-in, Calendar, Drive"], ["steps", "iPhone Steps", "Apple Health shortcut"], ["agent", "ParentVUE Agent (Laptop/Mac)", "Pulls grades and messages"], ["o365", "Eli's Office 365", "School email"]] as const).map(([k, l, t]) =>
              <Row key={k} label={l} tip={t}><span className="text-sm text-ash">{conn[k] ?? "Checking…"}</span>
                {k === "google" ? <button className="btn btn-ghost text-sm" onClick={() => sb().auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/app/" } })}>{/Connected/.test(conn[k] ?? "") ? "Reconnect" : "Connect"}</button>
                  : <a className="btn btn-ghost text-sm" href={k === "steps" ? "/docs/iphone-steps/" : "/app/?open=" + (k === "agent" ? "education" : "comms")}>Manage</a>}</Row>)}
          </>}
          {tab === "Privacy & Data" && <>
            <Row label="Export My Data" tip="Download everything Crystal stores for you as JSON"><button className="btn btn-ghost text-sm" onClick={exportData}>Export JSON</button></Row>
            <Row label="Sync Logs" tip="See recent school and mail sync runs"><a className="btn btn-ghost text-sm" href="/app/?open=education&tab=sync">View Sync Logs</a></Row>
            <Row label="Sign Out Everywhere" tip="Ends every Crystal session on all devices"><button className="btn btn-ghost text-sm text-alert" onClick={signOutAll}>Sign Out Everywhere</button></Row>
          </>}
        </div>
      </div>
    </div>
  </div>);
}
export { DEFAULTS };
