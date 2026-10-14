"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import SpaceBackground from "@/components/SpaceBackground";
import CrystalBot, { type Mood } from "@/components/CrystalBot";
import ChatPanel from "@/components/ChatPanel";
import Applet from "@/components/Applet";
import { HudBar, type Ability, type FeedItem } from "@/components/hud/Hud";
import { Priorities, TaskList, Weather, Calendar, ComingSoon } from "@/components/apps/Apps";
import { listTasks, addTask, usingLocal, type Task } from "@/lib/tasks";
import { sb } from "@/lib/supabase";
import { sfx } from "@/lib/synth";
import { call, Routes, type AppId, type CommandRequest, type CommandResponse } from "@/contracts/api";

const META: Record<AppId, { title: string; icon: string }> = {
  home: { title: "Top Priorities", icon: "◎" }, tasks: { title: "To-Do List", icon: "✓" }, weather: { title: "Weather", icon: "☁" }, calendar: { title: "Calendar", icon: "▦" },
  crystal: { title: "Crystal Co-Pilot", icon: "🤖" }, health: { title: "Health", icon: "♥" }, comms: { title: "Communications", icon: "✉" }, education: { title: "Education", icon: "🎓" }, finance: { title: "Finance", icon: "$" }, shopping: { title: "Shopping", icon: "🛒" },
};
const SOON: Partial<Record<AppId, string[]>> = { health: ["Steps", "Blood glucose", "Medications"], comms: ["Mail", "Email", "Drive"], education: ["Classes", "Learn", "Check-ins", "School calendars", "Bell schedules"], finance: ["Bill payments", "Credit monitoring", "Stock tracker"], shopping: ["Shopping list", "Wish list"] };
const HOME: AppId[] = ["home", "tasks", "weather", "calendar"];
type Win = { id: AppId; title: string; minimized: boolean };

export default function Cockpit() {
  const [user, setUser] = useState<string | null>(null); const [ready, setReady] = useState(false); const [demo, setDemo] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]); const [wins, setWins] = useState<Win[]>(HOME.map(id => ({ id, title: META[id].title, minimized: false })));
  const [focus, setFocus] = useState<AppId>("home"); const [alert, setAlert] = useState(false); const [mood, setMood] = useState<Mood>("idle");
  const [feed, setFeed] = useState<FeedItem[]>([]); const [cmd, setCmd] = useState(""); const [cmdBusy, setCmdBusy] = useState(false); const [toast, setToast] = useState("");
  const sparkRoot = useRef<HTMLDivElement>(null);

  const log = useCallback((text: string, tone: FeedItem["tone"] = "info") => setFeed(f => [...f, { t: Date.now() + Math.random(), text, tone }]), []);
  const reload = useCallback(async () => { try { setTasks(await listTasks()); } catch (e) { log(`Task sync error: ${(e as Error).message}`, "warn"); } }, [log]);

  useEffect(() => {
    const isDemo = new URLSearchParams(location.search).has("demo");
    const c = sb();
    const done = (email: string | null) => { setUser(email); setReady(true); };
    c.auth.getSession().then(({ data }) => {
      if (data.session) done(data.session.user.email ?? "pilot");
      else if (isDemo) { setDemo(true); localStorage.setItem("crystal-local-tasks", localStorage.getItem("crystal-local-tasks") || "[]"); done("demo pilot"); }
      else setTimeout(() => c.auth.getSession().then(({ data: d }) => d.session ? done(d.session.user.email ?? "pilot") : location.replace("/#launch")), 1500);
    });
    const { data: sub } = c.auth.onAuthStateChange((_e, s) => { if (s) done(s.user.email ?? "pilot"); });
    return () => sub.subscription.unsubscribe();
  }, []);
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

  async function runCommand(e: React.FormEvent) {
    e.preventDefault(); const text = cmd.trim(); if (!text || cmdBusy) return; setCmdBusy(true); setMood("thinking"); sfx("click"); log(`> ${text}`);
    try {
      const r = await call<CommandRequest, CommandResponse>(Routes.command, { text, nowIso: new Date().toISOString(), tzOffsetMinutes: new Date().getTimezoneOffset() });
      const it = r.intent;
      if (it.kind === "create_task") { await addTask({ title: it.title, due_date: it.dueDate, priority: it.priority }); await reload(); setToast(`Task filed: ${it.title}${it.dueDate ? ` · due ${it.dueDate}` : ""}`); log(`Task created: ${it.title}${it.dueDate ? ` (due ${it.dueDate})` : ""}`, "ok"); sfx("success"); sparks(); react("happy"); }
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
    { id: "wx", icon: "☁", label: "Weather", cooldown: 0, run: () => openApp("weather") },
    { id: "cal", icon: "▦", label: "Calendar", cooldown: 0, run: () => openApp("calendar") },
    { id: "ai", icon: "🤖", label: "Crystal", cooldown: 0, run: () => openApp("crystal") },
    { id: "scan", icon: "◉", label: "Scan", cooldown: 8, run: () => { sfx("ping"); reload(); sparks(); log(`Scan complete: ${open.length} open, ${open.filter(t => t.due_date && t.due_date < new Date().toISOString().slice(0, 10)).length} overdue.`, "ok"); } },
    { id: "focus", icon: "⏱", label: "Focus 25", cooldown: 1500, run: () => { sfx("success"); log("Focus burn engaged: 25 minutes. Comms silenced.", "ok"); setTimeout(() => { sfx("chirp"); log("Focus burn complete. Take five, pilot.", "ok"); }, 1500000); } },
    { id: "boost", icon: "⚡", label: "Boost", cooldown: 30, run: () => { sparks(); react("happy"); const m = ["You've got this, pilot!", "One mission at a time.", "Shields up, distractions down.", "Crystal believes in you ✨"]; log(`Crystal: ${m[Math.floor(Math.random() * m.length)]}`, "ok"); sfx("chirp"); } },
    { id: "alert", icon: "⚠", label: "Alert", cooldown: 3, run: toggleAlert },
  ];

  if (!ready) return (<><SpaceBackground /><div className="flex h-dvh items-center justify-center"><p className="neon animate-glow font-mono">Establishing uplink…</p></div></>);

  const content = (id: AppId) => {
    switch (id) {
      case "home": return <Priorities tasks={alert ? tasks.filter(t => !t.done && (t.priority === 1 || (t.due_date ?? "9") < new Date().toISOString().slice(0, 10))) : tasks} />;
      case "tasks": return <TaskList tasks={tasks} reload={reload} log={log} />;
      case "weather": return <Weather />;
      case "calendar": return <Calendar tasks={tasks} />;
      case "crystal": return <ChatPanel mode="pilot" onMood={setMood} className="h-[340px]" greeting="Hey pilot! 🚀 What are we tackling today?" />;
      default: return <ComingSoon name={META[id].title} items={SOON[id] || []} />;
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(["health", "comms", "education", "finance", "shopping"] as AppId[]).map(id => (
              <button key={id} onClick={() => openApp(id)} className="glass relative rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:border-cyan/50">
                <div className="text-xl text-cyan">{META[id].icon}</div><div className="text-sm font-semibold text-snow">{META[id].title}</div>
                <span className="absolute right-2 top-2 rounded-full bg-slate/30 px-2 py-0.5 text-[9px] uppercase tracking-wider text-ash">Coming soon</span>
              </button>))}
          </div>
        </section>
      </main>
      <HudBar abilities={abilities} feed={feed} blips={open.length} alert={alert} onAlert={toggleAlert} onHome={goHome} onLogout={logout} open={wins} onRestore={id => openApp(id)} />
    </div>
  );
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
