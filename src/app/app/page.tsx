"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import SpaceBackground from "@/components/SpaceBackground";
import CrystalBot, { type Mood } from "@/components/CrystalBot";
import ChatPanel from "@/components/ChatPanel";
import Applet from "@/components/Applet";
import { HudBar, type Ability, type FeedItem, type Squad, type Contact } from "@/components/hud/Hud";
import { Priorities, TaskList, Weather, Calendar } from "@/components/apps/Apps";
import { Health, Comms, Finance, Shopping, SchoolHub } from "@/components/apps/Modules";
import Ocr from "@/components/apps/Ocr";
import { list as listRows, insert as insertRow, setDemo as setStoreDemo, onChange as onStoreChange, type Row } from "@/lib/store";
import { schoolDay } from "@/lib/school";
import Education from "@/components/apps/Education";
import { listTasks, addTask, usingLocal, type Task } from "@/lib/tasks";
import { sb } from "@/lib/supabase";
import { sfx } from "@/lib/synth";
import { call, Routes, type AppId, type CommandRequest, type CommandResponse } from "@/contracts/api";

const META: Record<AppId, { title: string; icon: string }> = {
  home: { title: "Top Priorities", icon: "◎" }, tasks: { title: "To-Do List", icon: "✓" }, weather: { title: "Weather", icon: "☁" }, calendar: { title: "Calendar", icon: "▦" },
  crystal: { title: "Crystal Co-Pilot", icon: "🤖" }, health: { title: "Health", icon: "♥" }, comms: { title: "Communications", icon: "✉" }, education: { title: "Education", icon: "🎓" }, school: { title: "School Hub", icon: "🔔" }, ocr: { title: "OCR Scanner", icon: "📷" }, finance: { title: "Finance", icon: "$" }, shopping: { title: "Shopping", icon: "🛒" },
};
const HOME: AppId[] = ["home", "tasks", "weather", "calendar"];
type Win = { id: AppId; title: string; minimized: boolean };

export default function Cockpit() {
  const [user, setUser] = useState<string | null>(null); const [ready, setReady] = useState(false); const [demo, setDemo] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]); const [wins, setWins] = useState<Win[]>(HOME.map(id => ({ id, title: META[id].title, minimized: false })));
  const [focus, setFocus] = useState<AppId>("home"); const [alert, setAlert] = useState(false); const [mood, setMood] = useState<Mood>("idle");
  const [feed, setFeed] = useState<FeedItem[]>([]); const [cmd, setCmd] = useState(""); const [cmdBusy, setCmdBusy] = useState(false); const [toast, setToast] = useState("");
  const sparkRoot = useRef<HTMLDivElement>(null);
  const [mod, setMod] = useState<Record<string, Row[]>>({});
  const loadMods = useCallback(async () => { const T = ["health_logs", "meds", "bills", "shop_items", "comms_notes"] as const; const out: Record<string, Row[]> = {}; await Promise.all(T.map(async t => { try { out[t] = await listRows(t); } catch { out[t] = []; } })); setMod(out); }, []);

  const log = useCallback((text: string, tone: FeedItem["tone"] = "info") => setFeed(f => [...f, { t: Date.now() + Math.random(), text, tone }]), []);
  const reload = useCallback(async () => { try { setTasks(await listTasks()); } catch (e) { log(`Task sync error: ${(e as Error).message}`, "warn"); } }, [log]);

  useEffect(() => {
    const isDemo = new URLSearchParams(location.search).has("demo");
    const c = sb();
    const done = (email: string | null) => { setUser(email); setReady(true); };
    c.auth.getSession().then(({ data }) => {
      if (data.session) done(data.session.user.email ?? "pilot");
      else if (isDemo) { setDemo(true); setStoreDemo(true); localStorage.setItem("crystal-local-tasks", localStorage.getItem("crystal-local-tasks") || "[]"); done("demo pilot"); }
      else setTimeout(() => c.auth.getSession().then(({ data: d }) => d.session ? done(d.session.user.email ?? "pilot") : location.replace("/#launch")), 1500);
    });
    const { data: sub } = c.auth.onAuthStateChange((_e, s) => { if (s) done(s.user.email ?? "pilot"); });
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (!ready) return; loadMods(); return onStoreChange(loadMods); }, [ready, loadMods]);
  useEffect(() => { const h = (e: ErrorEvent | PromiseRejectionEvent) => { const err = "reason" in e ? e.reason : e.error; fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: String(err?.message || ("message" in e ? e.message : err)), stack: String(err?.stack || ""), url: location.pathname }) }).catch(() => {}); }; addEventListener("error", h); addEventListener("unhandledrejection", h); return () => { removeEventListener("error", h); removeEventListener("unhandledrejection", h); }; }, []);
  useEffect(() => { if (ready) { reload().then(() => { log("Systems online. Welcome aboard, pilot.", "ok"); if (usingLocal()) log("Tasks table not found — using on-device storage.", "warn"); }); } }, [ready, reload, log]);

  const sparks = (x = innerWidth / 2, y = innerHeight / 2) => {
    const root = sparkRoot.current; if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (let i = 0; i < 14; i++) { const s = document.createElement("span"); s.className = "spark"; const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 60; s.style.left = `${x}px`; s.style.top = `${y}px`; s.style.setProperty("--dx", `${Math.cos(a) * d}px`); s.style.setProperty("--dy", `${Math.sin(a) * d}px`); root.appendChild(s); setTimeout(() => s.remove(), 700); }
  };
  const react = (m: Mood, ms = 1600) => { setMood(m); setTimeout(() => setMood(alert ? "alert" : "idle"), ms); };
  const openApp = (id: AppId) => { sfx("open"); setWins(w => w.some(x => x.id === id) ? w.map(x => x.id === id ? { ...x, minimized: false } : x) : [...w, { id, title: META[id].title, minimized: false }]); setFocus(id); log(`Applet opened: ${META[id].title}`); };
  const minimize = (id: AppId) => { sfx("close"); setWins(w => w.map(x => x.id === id ? { ...x, minimized: true } : x)); };
  const close = (id: AppId) => { sfx("close"); setWins(w => w.filter(x => x.id !== id)); };
  const goHome = () => { sfx("ping"); setWins(HOME.map(id => ({ id, title: META[id].title, minimized: false }))); setFocus("home"); window.scrollTo({ top: 0, behavior: "smooth" }); log("Returning to Home."); };
  const logout = async () => { sfx("close"); if (!demo) await sb().auth.signOut(); location.href = "/"; };
  const toggleAlert = () => { const n = !alert; setAlert(n); sfx(n ? "alert" : "ping"); setMood(n ? "alert" : "happy"); log(n ? "RED ALERT — DEFCON 1. Overdue + high priority missions highlighted." : "Stand down. DEFCON 5.", n ? "warn" : "ok"); if (!n) setTimeout(() => setMood("idle"), 1500); };

  async function runCommand(e: React.FormEvent) { e.preventDefault(); await execCommand(cmd.trim()); }
  async function execCommand(text: string) {
    if (!text || cmdBusy) return; setCmdBusy(true); setMood("thinking"); sfx("click"); log(`> ${text}`);
    try {
      const r = await call<CommandRequest, CommandResponse>(Routes.command, { text, nowIso: new Date().toISOString(), tzOffsetMinutes: new Date().getTimezoneOffset() });
      const it = r.intent;
      if (it.kind === "create_task") { await addTask({ title: it.title, due_date: it.dueDate, priority: it.priority }); await reload(); setToast(`Task filed: ${it.title}${it.dueDate ? ` · due ${it.dueDate}` : ""}`); log(`Task created: ${it.title}${it.dueDate ? ` (due ${it.dueDate})` : ""}`, "ok"); sfx("success"); sparks(); react("happy"); }
      else if (it.kind === "create_item") { await insertRow(it.table, it.row); setToast(it.summary); log(it.summary, "ok"); sfx("success"); sparks(); react("happy"); openApp(it.app); }
      else if (it.kind === "open_app") { openApp(it.app); react("wave"); }
      else { setToast(it.reply); log(`Crystal: ${it.reply.slice(0, 120)}`); react("happy", 2500); }
      setCmd("");
    } catch (err) { log(`Command failed: ${(err as Error).message}`, "warn"); sfx("error"); react("alert"); }
    finally { setCmdBusy(false); setTimeout(() => setToast(""), 6000); }
  }

  const open = tasks.filter(t => !t.done);
  const abilities: Ability[] = [
    { id: "home", icon: "⌂", label: "Home", cooldown: 0, run: goHome },
    { id: "tasks", icon: "✓", label: "Tasks", cooldown: 0, run: () => openApp("tasks") },
    { id: "ocr", icon: "📷", label: "Scan", cooldown: 0, run: () => openApp("ocr") },
    { id: "edu", icon: "🎓", label: "School", cooldown: 0, run: () => openApp("education") },
    { id: "ai", icon: "🤖", label: "Crystal", cooldown: 0, run: () => openApp("crystal") },
    { id: "scan", icon: "◉", label: "Sweep", cooldown: 8, run: () => { sfx("ping"); reload(); loadMods(); sparks(); log(`Sweep complete: ${open.length} open, ${open.filter(t => t.due_date && t.due_date < new Date().toISOString().slice(0, 10)).length} overdue.`, "ok"); } },
    { id: "focus", icon: "⏱", label: "Focus 25", cooldown: 1500, run: () => { sfx("success"); log("Focus burn engaged: 25 minutes. Comms silenced.", "ok"); setTimeout(() => { sfx("chirp"); log("Focus burn complete. Take five, pilot.", "ok"); }, 1500000); } },
    { id: "boost", icon: "⚡", label: "Boost", cooldown: 30, run: () => { sparks(); react("happy"); const m = ["You've got this, pilot!", "One mission at a time.", "Shields up, distractions down.", "Crystal believes in you ✨"]; log(`Crystal: ${m[Math.floor(Math.random() * m.length)]}`, "ok"); sfx("chirp"); } },
    { id: "alert", icon: "⚠", label: "Alert", cooldown: 3, run: toggleAlert },
  ];

  const t0 = new Date().toISOString().slice(0, 10);
  const M = (k: string) => mod[k] || [];
  const unpaid = M("bills").filter(r => !r.paid); const overdueBills = unpaid.filter(r => r.due_date && String(r.due_date) < t0);
  const stepsToday = M("health_logs").filter(r => r.kind === "steps" && r.logged_on === t0).reduce((a, r) => a + Number(r.value || 0), 0);
  const glu = M("health_logs").filter(r => r.kind === "glucose")[0]; const gluBad = glu && (Number(glu.value) > 180 || Number(glu.value) < 70);
  const medsDue = M("meds").filter(r => r.active !== false && String(r.last_taken || "").slice(0, 10) !== t0);
  const shop = M("shop_items").filter(r => r.list === "shopping" && !r.done); const comms = M("comms_notes").filter(r => !r.done);
  const sd = schoolDay(new Date());
  const squad: Squad[] = [
    { id: "home", label: "Home", status: open.some(t => t.due_date && t.due_date < t0) ? "warn" : "ok", detail: `${open.length} open` },
    { id: "health", label: "Health", status: gluBad ? "warn" : M("health_logs").length || M("meds").length ? "ok" : "off", detail: `${stepsToday.toLocaleString()} steps · ${medsDue.length} meds due` },
    { id: "comms", label: "Comms", status: comms.some(r => r.due_date && String(r.due_date) < t0) ? "warn" : comms.length ? "ok" : "off", detail: `${comms.length} to handle` },
    { id: "school", label: "School", status: sd.kind === "none" ? "off" : "ok", detail: sd.label },
    { id: "finance", label: "Finance", status: overdueBills.length ? "warn" : unpaid.length ? "ok" : "off", detail: `${unpaid.length} bills${overdueBills.length ? `, ${overdueBills.length} late` : ""}` },
    { id: "shopping", label: "Shop", status: shop.length ? "ok" : "off", detail: `${shop.length} items` },
  ];
  const contacts: Contact[] = [
    ...open.map(t => ({ label: t.title, sector: 0, hot: !!t.due_date && t.due_date < t0 })),
    ...medsDue.map(r => ({ label: `Med: ${r.name}`, sector: 1 })), ...(gluBad ? [{ label: "Glucose out of range", sector: 1, hot: true }] : []),
    ...comms.map(r => ({ label: String(r.title), sector: 2, hot: !!r.due_date && String(r.due_date) < t0 })),
    ...unpaid.map(r => ({ label: `Bill: ${r.name}`, sector: 4, hot: !!r.due_date && String(r.due_date) < t0 })),
    ...shop.map(r => ({ label: String(r.name), sector: 5 })),
  ];
  const tactical: FeedItem[] = [
    ...contacts.filter(c => c.hot).map((c, i) => ({ t: i + 1, text: `HOSTILE: ${c.label}`, tone: "warn" as const })),
    ...medsDue.map((r, i) => ({ t: 100 + i, text: `Med due: ${r.name}${r.schedule ? ` (${r.schedule})` : ""}`, tone: "info" as const })),
    ...unpaid.filter(r => r.due_date && String(r.due_date) >= t0).slice(0, 3).map((r, i) => ({ t: 200 + i, text: `Bill ${r.name} due ${r.due_date}`, tone: "info" as const })),
    { t: 300, text: `School: ${sd.label}`, tone: "ok" as const },
  ];

  if (!ready) return (<><SpaceBackground /><div className="flex h-dvh items-center justify-center"><p className="neon animate-glow font-mono">Establishing uplink…</p></div></>);

  const content = (id: AppId) => {
    switch (id) {
      case "home": return <Priorities tasks={alert ? tasks.filter(t => !t.done && (t.priority === 1 || (t.due_date ?? "9") < new Date().toISOString().slice(0, 10))) : tasks} />;
      case "tasks": return <TaskList tasks={tasks} reload={reload} log={log} />;
      case "weather": return <Weather />;
      case "calendar": return <Calendar tasks={tasks} />;
      case "crystal": return <ChatPanel mode="pilot" onMood={setMood} className="h-[340px]" greeting="Hey pilot! 🚀 What are we tackling today?" />;
      case "education": return <Education demo={demo} log={log} />;
      case "school": return <SchoolHub log={log} />;
      case "health": return <Health log={log} />;
      case "comms": return <Comms log={log} />;
      case "finance": return <Finance log={log} />;
      case "shopping": return <Shopping log={log} />;
      case "ocr": return <Ocr log={log} onCommand={execCommand} />;
      default: return null;
    }
  };
  const visible = wins.filter(w => !w.minimized);

  return (
    <div className={alert ? "red-alert" : ""}>
      <SpaceBackground dim={0.5} />
      <div className="alert-overlay pointer-events-none fixed inset-0 z-20" />
      <div ref={sparkRoot} className="pointer-events-none fixed inset-0 z-50" />
      <header className="glass sticky top-0 z-30 !rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-3 py-2">
          <button onClick={goHome} className="neon font-bold tracking-[.3em]" aria-label="Crystal home">◆ CRYSTAL</button>
          <form onSubmit={runCommand} className="order-3 flex w-full gap-2 sm:order-none sm:w-auto sm:flex-1">
            <input value={cmd} onChange={e => setCmd(e.target.value)} className="input py-1.5 text-sm" placeholder='Command Crystal… e.g. "remind me Friday to pay the water bill"' aria-label="Command bar" maxLength={300} />
            <button className="btn btn-primary !py-1.5 text-sm" disabled={cmdBusy}>{cmdBusy ? "…" : "Go"}</button>
          </form>
          <span className="ml-auto hidden max-w-[12rem] truncate text-xs text-ash md:inline">{demo ? "Demo mode" : user}</span>
          <button onClick={goHome} className="btn btn-ghost !px-2 !py-1 text-xs" aria-label="Home">⌂</button>
          <button onClick={logout} className="btn btn-ghost !px-2 !py-1 text-xs">Log out</button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl px-3 pb-[180px] pt-4">
        {toast && <div role="status" className="glass mb-3 rounded-xl px-4 py-2 text-sm text-mint">{toast}</div>}
        {demo && <div className="mb-3 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-200">Demo mode: not signed in, tasks stay on this device. <a href="/#launch" className="underline">Sign in</a></div>}
        <div className="mb-4 flex items-center gap-4">
          <CrystalBot size={76} mood={mood} onClick={() => { openApp("crystal"); react("wave"); sfx("chirp"); }} label="Open Crystal co-pilot chat" />
          <div><div className="hud-label">Pilot&apos;s assistant</div><p className="text-snow">{greeting()}, {demo ? "pilot" : (user?.split("@")[0] ?? "pilot")}. {open.length ? `${open.length} open mission${open.length > 1 ? "s" : ""}.` : "All clear."}</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(w => (<div key={w.id} className={w.id === "calendar" || w.id === "tasks" ? "md:col-span-1 xl:col-span-1" : ""}>
            <Applet title={w.title} icon={META[w.id].icon} focused={focus === w.id} onFocus={() => setFocus(w.id)} onMin={() => minimize(w.id)} onClose={() => close(w.id)}>{content(w.id)}</Applet>
          </div>))}
          {!visible.length && <div className="glass rounded-2xl p-6 text-center text-ash md:col-span-2 xl:col-span-3">All applets closed. Tap ⌂ Home to restore.</div>}
        </div>
        <section className="mt-6" aria-label="Modules"><div className="hud-label mb-2">Modules</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {(["health", "comms", "education", "school", "finance", "shopping", "ocr"] as AppId[]).map(id => (
              <button key={id} onClick={() => openApp(id)} className="glass relative rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan/50">
                <div className="text-xl text-cyan">{META[id].icon}</div><div className="text-sm font-semibold text-snow">{META[id].title}</div>
                {squad.find(q => q.id === id) && <span className="absolute right-2 top-2 max-w-[60%] truncate text-[9px] text-ash">{squad.find(q => q.id === id)!.detail}</span>}
              </button>))}
          </div>
        </section>
      </main>
      <HudBar pilot={demo ? "demo pilot" : (user?.split("@")[0] ?? "pilot")} mood={mood} onPilot={() => { openApp("crystal"); react("wave"); sfx("chirp"); }} squad={squad} contacts={contacts} tactical={tactical} abilities={abilities} feed={feed} blips={open.length} alert={alert} onAlert={toggleAlert} onHome={goHome} onLogout={logout} open={wins} onRestore={id => openApp(id)} />
    </div>
  );
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
