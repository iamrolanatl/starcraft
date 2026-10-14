"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SpaceBackground from "@/components/SpaceBackground";
import CrystalBot, { type Mood } from "@/components/CrystalBot";
import ChatPanel from "@/components/ChatPanel";
import Applet, { type Geo, type WinMode } from "@/components/Applet";
import { HudBar, type Ability, type FeedItem, type Squad, type Contact, type Blip } from "@/components/hud/Hud";
import { computeDefcon, DEFCON_COLOR, ShieldsTimer, Briefing, IncomingTransmission, Warp, MedalsPanel, HoloGlobe, RANKS, type Transmission, type Medal } from "@/components/hud/Ops";
import { Priorities, TaskList, Weather, Calendar } from "@/components/apps/Apps";
import { Health, Comms, Finance, Shopping, SchoolHub } from "@/components/apps/Modules";
import Education from "@/components/apps/Education";
import Ocr from "@/components/apps/Ocr";
import CommandPalette, { type PaletteAction } from "@/components/ui/CommandPalette";
import Tour from "@/components/ui/Tour";
import { Toaster, toast, ErrorNote, Particles } from "@/components/ui/kit";
import { listTasks, addTask, deleteTask, type Task } from "@/lib/tasks";
import { list as listRows, insert as insertRow, setDemo as setStoreDemo, onChange as onStoreChange, type Row } from "@/lib/store";
import { loadEducation, loadSyncStatus, type EduData, type SyncStatus } from "@/lib/education";
import { schoolDay } from "@/lib/school";
import { sb } from "@/lib/supabase";
import { sfx, ambient, haptic, isMuted } from "@/lib/synth";
import { call, Routes, type AppId, type CommandRequest, type CommandResponse } from "@/contracts/api";

const META: Record<AppId, { title: string; icon: string }> = {
  home: { title: "Top Priorities", icon: "◎" }, tasks: { title: "To-Do List", icon: "✓" }, weather: { title: "Weather", icon: "☁" }, calendar: { title: "Calendar", icon: "▦" },
  crystal: { title: "Crystal Co-Pilot", icon: "🤖" }, health: { title: "Health", icon: "♥" }, comms: { title: "Communications", icon: "✉" }, education: { title: "Education", icon: "🎓" },
  school: { title: "School Hub", icon: "🔔" }, ocr: { title: "OCR Scanner", icon: "📷" }, finance: { title: "Finance", icon: "$" }, shopping: { title: "Shopping", icon: "🛒" },
  globe: { title: "Holo Globe", icon: "🌐" }, medals: { title: "Rank & Medals", icon: "🎖" },
};
const HOME: AppId[] = ["home", "globe", "tasks", "weather", "calendar"];
const MODULES: AppId[] = ["health", "comms", "education", "school", "finance", "shopping", "ocr", "medals"];
const ESSENTIAL: AppId[] = ["home", "tasks", "crystal"];
type Win = { id: AppId; title: string; minimized: boolean; geo?: Geo; z: number };
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysTo = (d: string) => Math.round((new Date(d + "T12:00").getTime() - new Date(ymd() + "T12:00").getTime()) / 864e5);
const pref = (k: string, d = "") => (typeof window === "undefined" ? d : localStorage.getItem(`crystal-${k}`) ?? d);
const setPref = (k: string, v: string) => localStorage.setItem(`crystal-${k}`, v);
const reduced = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function tileGeo(i: number, W: number): Geo { const cols = W >= 1500 ? 3 : 2; const w = Math.floor((W - 24 - (cols - 1) * 12) / cols); return { x: 12 + (i % cols) * (w + 12), y: 8 + Math.floor(i / cols) * 352, w, h: 340 }; }

export default function Cockpit() {
  const [user, setUser] = useState<string | null>(null); const [ready, setReady] = useState(false); const [demo, setDemo] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]); const [taskErr, setTaskErr] = useState<{ message: string; kind?: string } | null>(null); const [tasksLoaded, setTasksLoaded] = useState(false);
  const [wins, setWins] = useState<Win[]>([]); const [focus, setFocus] = useState<AppId>("home"); const zTop = useRef(10);
  const [manualAlert, setManualAlert] = useState(false); const [mood, setMood] = useState<Mood>("idle"); const [say, setSay] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]); const [cmd, setCmd] = useState(""); const [cmdBusy, setCmdBusy] = useState(false);
  const [mod, setMod] = useState<Record<string, Row[]>>({}); const [edu, setEdu] = useState<EduData | null>(null); const [sync, setSync] = useState<SyncStatus | null>(null);
  const [palette, setPalette] = useState(false); const [tour, setTour] = useState(false); const [brief, setBrief] = useState(false); const [help, setHelp] = useState(false);
  const [warp, setWarp] = useState(false); const [focusEnd, setFocusEnd] = useState<number | null>(null); const [pulse, setPulse] = useState(0);
  const [night, setNight] = useState(false); const [desk, setDesk] = useState(false); const [destruct, setDestruct] = useState(0); const [, setPrefTick] = useState(0);
  const [txQueueTick, setTxTick] = useState(0); const [tx, setTx] = useState<Transmission | null>(null);
  const sparkRoot = useRef<HTMLDivElement>(null); const cmdRef = useRef<HTMLInputElement>(null); const sayT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const log = useCallback((text: string, tone: FeedItem["tone"] = "info") => setFeed(f => [...f.slice(-60), { t: Date.now() + Math.random(), text, tone }]), []);
  const speakBubble = useCallback((s: string, ms = 3800) => { setSay(s); clearTimeout(sayT.current); sayT.current = setTimeout(() => setSay(""), ms); }, []);
  const reload = useCallback(async () => { try { setTasks(await listTasks()); setTaskErr(null); } catch (e) { setTaskErr(e as { message: string; kind?: string }); log(`Tasks: ${(e as Error).message}`, "warn"); } finally { setTasksLoaded(true); } }, [log]);
  const loadMods = useCallback(async () => { const T = ["health_logs", "meds", "bills", "shop_items", "comms_notes", "edu_checkins", "credit_scores"] as const; const out: Record<string, Row[]> = {}; await Promise.all(T.map(async t => { try { out[t] = await listRows(t); } catch { out[t] = []; } })); setMod(out); }, []);
  const loadEdu = useCallback(async (d: boolean) => { try { setEdu(await loadEducation(d)); } catch { setEdu(null); } try { setSync(await loadSyncStatus(d)); } catch { setSync(null); } }, []);

  /* auth + boot */
  useEffect(() => {
    const isDemo = new URLSearchParams(location.search).has("demo"); const c = sb();
    const done = (email: string | null, d = false) => { setUser(email); setDemo(d); setReady(true); };
    c.auth.getSession().then(({ data }) => {
      if (data.session) done(data.session.user.email ?? "pilot");
      else if (isDemo) { setStoreDemo(true); done("demo pilot", true); }
      else setTimeout(() => c.auth.getSession().then(({ data: d }) => d.session ? done(d.session.user.email ?? "pilot") : location.replace("/#launch")), 1500);
    });
    const { data: sub } = c.auth.onAuthStateChange((_e, s) => { if (s) done(s.user.email ?? "pilot"); });
    const mq = matchMedia("(min-width: 1100px) and (not (pointer: coarse))"); const upd = () => setDesk(mq.matches); upd(); mq.addEventListener("change", upd);
    setNight(pref("theme") === "night"); const pt = () => setPrefTick(x => x + 1); addEventListener("crystal-prefs", pt);
    return () => { sub.subscription.unsubscribe(); mq.removeEventListener("change", upd); removeEventListener("crystal-prefs", pt); };
  }, []);
  useEffect(() => { if (!ready) return; setWins(HOME.map((id, i) => ({ id, title: META[id].title, minimized: false, z: i + 1, geo: savedGeo(id) ?? tileGeo(i, innerWidth) })));
    reload().then(() => log("Systems online. Welcome aboard, pilot.", "ok")); loadMods(); loadEdu(demo);
    const un = onStoreChange(loadMods); const iv = setInterval(() => { loadEdu(demo); loadMods(); }, 300000);
    if (pref("tour") !== "done") setTour(true); else if (pref("brief-date") !== ymd()) setBrief(true);
    return () => { un(); clearInterval(iv); };
  }, [ready, demo, reload, loadMods, loadEdu, log]);
  useEffect(() => { const h = (e: ErrorEvent | PromiseRejectionEvent) => { const err = "reason" in e ? e.reason : e.error; fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: String(err?.message || ("message" in e ? e.message : err)), stack: String(err?.stack || ""), url: location.pathname }) }).catch(() => {}); }; addEventListener("error", h); addEventListener("unhandledrejection", h); return () => { removeEventListener("error", h); removeEventListener("unhandledrejection", h); }; }, []);

  /* derived data */
  const t0 = ymd(); const M = (k: string) => mod[k] || [];
  const open = tasks.filter(t => !t.done); const doneN = tasks.length - open.length;
  const overdue = open.filter(t => t.due_date && t.due_date < t0);
  const unpaid = M("bills").filter(r => !r.paid); const billsOver = unpaid.filter(r => r.due_date && String(r.due_date) < t0); const billsSoon = unpaid.filter(r => r.due_date && daysTo(String(r.due_date)) >= 0 && daysTo(String(r.due_date)) <= 3);
  const medsDue = M("meds").filter(r => r.active !== false && String(r.last_taken || "").slice(0, 10) !== t0);
  const stepsDays = new Set(M("health_logs").filter(r => r.kind === "steps").map(r => String(r.logged_on)));
  const streak = (() => { let n = 0; const d = new Date(); if (!stepsDays.has(ymd(d))) d.setDate(d.getDate() - 1); while (stepsDays.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); } return n; })();
  const last7 = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return stepsDays.has(ymd(d)); }).filter(Boolean).length;
  const glu = M("health_logs").find(r => r.kind === "glucose"); const gluBad = !!glu && (Number(glu.value) > 180 || Number(glu.value) < 70);
  const shop = M("shop_items").filter(r => r.list === "shopping" && !r.done); const comms = M("comms_notes").filter(r => !r.done);
  const missing = (edu?.assignments || []).filter(a => a.missing); const unreadTeacher = (edu?.messages || []).filter(m => m.unread);
  const syncAlerts = (sync?.alerts || []).filter(a => Date.now() - new Date(a.created_at).getTime() < 864e5);
  const dc = computeDefcon({ overdueTasks: overdue.length, billsDueSoon: billsSoon.length, billsOverdue: billsOver.length, missingWork: missing.length, syncAlerts: syncAlerts.length, medsDue: medsDue.length, unreadTeacher: unreadTeacher.length });
  const level = manualAlert ? 1 : dc.level; const alert = level === 1;
  const budget = Number(pref("budget", "1500")); const monthSpend = M("bills").filter(r => String(r.due_date || "").startsWith(t0.slice(0, 7))).reduce((a, r) => a + Number(r.amount || 0), 0);
  const bars = { shields: tasks.length ? doneN / tasks.length * 100 : 100, hull: last7 / 7 * 100, energy: Math.max(0, (budget - monthSpend) / budget * 100), labels: [`${doneN}/${tasks.length} missions complete`, `${last7}/7 days with steps logged (streak ${streak})`, `$${Math.round(budget - monthSpend)} of $${budget} monthly budget left`] as [string, string, string] };

  /* ranks & medals */
  const paidN = M("bills").filter(r => r.paid).length; const shopDone = M("shop_items").filter(r => r.done).length; const commsDone = M("comms_notes").length - comms.length; const checkins = M("edu_checkins").length;
  const xp = doneN * 10 + paidN * 5 + stepsDays.size * 15 + checkins * 8 + shopDone * 2 + commsDone * 5;
  const TH = [0, 50, 120, 250, 450, 700, 1000, 1500]; const rankI = TH.filter(t => xp >= t).length - 1;
  const medals: Medal[] = [
    { id: "first", icon: "🥇", name: "First Blood", desc: "Complete your first mission", earned: doneN >= 1 },
    { id: "squad", icon: "🎖", name: "Squadron", desc: "Complete 10 missions", earned: doneN >= 10 },
    { id: "hull", icon: "🛡", name: "Iron Hull", desc: "7-day steps streak", earned: streak >= 7 },
    { id: "treas", icon: "💰", name: "Treasurer", desc: "No overdue bills and ≥1 paid", earned: paidN > 0 && !billsOver.length },
    { id: "medic", icon: "💊", name: "Medic", desc: "All meds taken today", earned: M("meds").length > 0 && !medsDue.length },
    { id: "schol", icon: "📚", name: "Scholar", desc: "3+ school check-ins", earned: checkins >= 3 },
    { id: "qm", icon: "📦", name: "Quartermaster", desc: "5 shopping items picked up", earned: shopDone >= 5 },
    { id: "comms", icon: "📡", name: "Comms Officer", desc: "Close 5 comms items", earned: commsDone >= 5 },
    { id: "clear", icon: "🌌", name: "Clear Skies", desc: "Reach DEFCON 5", earned: dc.level === 5 },
  ];
  useEffect(() => { if (!ready || !tasksLoaded) return; const prev = Number(pref("rank", "-1")); if (prev >= 0 && rankI > prev) { toast(`Promotion! You are now ${RANKS[rankI]}.`); speakBubble(`Promoted to ${RANKS[rankI]}! 🎖`); sfx("success"); haptic([20, 40, 20, 40, 80]); sparks(innerWidth / 2, innerHeight / 3, 40); log(`PROMOTION: ${RANKS[rankI]}`, "ok"); } setPref("rank", String(rankI)); }, [rankI, ready, tasksLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /* DEFCON theme + ambient */
  useEffect(() => { document.documentElement.dataset.defcon = String(level); }, [level]);
  useEffect(() => { document.documentElement.dataset.theme = night ? "night" : ""; setPref("theme", night ? "night" : ""); }, [night]);
  const ambOn = useRef(false);
  useEffect(() => { const start = () => { ambOn.current = true; ambient(focusEnd ? 5 : level); }; addEventListener("pointerdown", start, { once: true }); return () => removeEventListener("pointerdown", start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ambOn.current) ambient(isMuted() ? null : night ? null : focusEnd ? 5 : level); }, [level, focusEnd, night]);
  const prevLevel = useRef(5);
  useEffect(() => { if (!tasksLoaded) return; if (level < prevLevel.current) { log(`DEFCON ${level}: ${dc.reasons.slice(0, 2).join(", ") || "manual"}`, "warn"); if (level <= 2) { sfx("alert"); haptic([80, 50, 80]); speakBubble(`DEFCON ${level}! ${dc.reasons[0] ?? ""}`); } } else if (level > prevLevel.current) log(`Readiness improved: DEFCON ${level}`, "ok"); prevLevel.current = level; }, [level, tasksLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /* incoming transmissions (urgent items), with ack/snooze */
  const txs: Transmission[] = useMemo(() => [
    ...syncAlerts.map(a => ({ id: `sync-${a.id}`, from: "School sync", title: "Sync failure", body: a.message, app: "education" as AppId })),
    ...unreadTeacher.slice(0, 3).map(m => ({ id: `msg-${m.ext_id}`, from: m.sender || "Teacher", title: m.subject || "Teacher message", body: (m.body || "").slice(0, 280), app: "education" as AppId })),
    ...unpaid.filter(r => r.due_date === t0).map(r => ({ id: `bill-${r.id}-${t0}`, from: "Finance", title: `Bill due today: ${r.name}`, body: `${r.name}${r.amount ? ` for $${Number(r.amount).toFixed(2)}` : ""} is due today. Pay it or set autopay.`, app: "finance" as AppId })),
  ], [syncAlerts, unreadTeacher, unpaid, t0]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tx || tour || brief || palette || focusEnd) return; const acks: Record<string, number> = JSON.parse(pref("tx", "{}")); const next = txs.find(t => !(acks[t.id] && (acks[t.id] === -1 || acks[t.id] > Date.now()))); if (next) setTx(next); }, [txs, tx, tour, brief, palette, focusEnd, txQueueTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const settleTx = (t: Transmission, until: number) => { const a = JSON.parse(pref("tx", "{}")); a[t.id] = until; setPref("tx", JSON.stringify(a)); setTx(null); setTimeout(() => setTxTick(x => x + 1), 800); };

  /* effects helpers */
  function sparks(x = innerWidth / 2, y = innerHeight / 2, n = 16) {
    const root = sparkRoot.current; if (!root || reduced()) return;
    for (let i = 0; i < n; i++) { const s = document.createElement("span"); s.className = "spark"; const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 90; s.style.left = `${x}px`; s.style.top = `${y}px`; s.style.background = ["#7dffc8", "#3ef2e0", "#c77dff", "#ff7ab6"][i % 4]; s.style.setProperty("--dx", `${Math.cos(a) * d}px`); s.style.setProperty("--dy", `${Math.sin(a) * d}px`); root.appendChild(s); setTimeout(() => s.remove(), 700); }
  }
  const react = (m: Mood, ms = 1600) => { setMood(m); setTimeout(() => setMood(alert ? "alert" : "idle"), ms); };
  function savedGeo(id: AppId): Geo | undefined { try { return JSON.parse(pref(`geo-${id}`, "null")) ?? undefined; } catch { return undefined; } }
  const front = (id: AppId) => { zTop.current += 1; const z = zTop.current; setWins(w => w.map(x => x.id === id ? { ...x, z } : x)); setFocus(id); };
  const doOpen = (id: AppId) => { sfx("open"); haptic(10); zTop.current += 1; const z = zTop.current;
    setWins(w => { if (!desk) w = w.map(x => HOME.includes(x.id) || x.id === id ? x : { ...x, minimized: true }); return w.some(x => x.id === id) ? w.map(x => x.id === id ? { ...x, minimized: false, z } : x) : [...w, { id, title: META[id].title, minimized: false, z, geo: savedGeo(id) ?? { x: Math.max(12, innerWidth / 2 - 300 + (w.length % 4) * 30), y: 20 + (w.length % 4) * 30, w: 600, h: 520 } }]; });
    setFocus(id); log(`Applet opened: ${META[id].title}`); };
  const openApp = (id: AppId) => { if (HOME.includes(id) || reduced() || wins.some(w => w.id === id && !w.minimized)) return doOpen(id); setWarp(true); sfx("whoosh"); haptic([10, 20, 30]); setTimeout(() => { doOpen(id); setWarp(false); }, 520); };
  const minimize = (id: AppId) => setWins(w => w.map(x => x.id === id ? { ...x, minimized: true } : x));
  const close = (id: AppId) => setWins(w => w.filter(x => x.id !== id));
  const setGeo = (id: AppId, g: Geo) => { setPref(`geo-${id}`, JSON.stringify(g)); setWins(w => w.map(x => x.id === id ? { ...x, geo: g } : x)); };
  const goHome = () => { sfx("ping"); haptic(8); setWins(HOME.map((id, i) => ({ id, title: META[id].title, minimized: false, z: i + 1, geo: savedGeo(id) ?? tileGeo(i, innerWidth) }))); setFocus("home"); window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }); log("Returning to Home."); };
  const resetLayout = () => { HOME.concat(MODULES, ["crystal"]).forEach(id => localStorage.removeItem(`crystal-geo-${id}`)); setWins(w => w.map((x, i) => ({ ...x, geo: tileGeo(i, innerWidth) }))); toast("Window layout reset"); };
  const logout = async () => { sfx("close"); if (!demo) await sb().auth.signOut(); location.href = "/"; };
  const toggleAlert = () => { const n = !manualAlert; setManualAlert(n); sfx(n ? "alert" : "ping"); haptic(n ? [100, 50, 100] : 10); setMood(n ? "alert" : "happy"); log(n ? "RED ALERT — DEFCON 1. Overdue + high priority missions highlighted." : `Stand down. DEFCON ${dc.level}.`, n ? "warn" : "ok"); if (!n) setTimeout(() => setMood("idle"), 1500); };
  const sweep = () => { setPulse(p => p + 1); sfx("ping"); haptic(15); reload(); loadMods();
    const soon: string[] = [...open.filter(t => t.due_date && daysTo(t.due_date) <= 2).map(t => `${t.title} (${daysTo(t.due_date!) < 0 ? "overdue" : daysTo(t.due_date!) === 0 ? "today" : `in ${daysTo(t.due_date!)}d`})`), ...unpaid.filter(r => r.due_date && daysTo(String(r.due_date)) <= 2).map(r => `Bill ${r.name} (${r.due_date})`), ...comms.filter(r => r.due_date && daysTo(String(r.due_date)) <= 2).map(r => String(r.title)), ...(edu?.assignments || []).filter(a => a.due_date && daysTo(a.due_date.slice(0, 10)) >= 0 && daysTo(a.due_date.slice(0, 10)) <= 2).map(a => `${a.course ?? "School"}: ${a.name}`), ...medsDue.map(r => `Med ${r.name}`)];
    setTimeout(() => { log(`Sweep: ${soon.length} contact${soon.length === 1 ? "" : "s"} within 48h${soon.length ? ": " + soon.slice(0, 5).join("; ") : ""}`, soon.length ? "warn" : "ok"); toast(soon.length ? `Sweep: ${soon.length} due within 48h — ${soon.slice(0, 3).join(", ")}${soon.length > 3 ? "…" : ""}` : "Sweep clear: nothing due within 48h", soon.length ? "warn" : "ok"); speakBubble(soon.length ? `${soon.length} contacts inbound!` : "Sector clear ✨"); }, 900); };
  const shields = () => { if (focusEnd) { setFocusEnd(null); log("Shields down.", "info"); return; } const ms = 25 * 60000; setFocusEnd(Date.now() + ms); sfx("success"); haptic([20, 30, 60]); log("Battle stations! Shields up for 25 minutes.", "ok"); speakBubble("Shields up. I'll hold the comms. 🛡"); };
  const shieldsDone = useCallback(() => { setFocusEnd(null); sfx("chirp"); haptic([40, 30, 40]); toast("Focus burn complete. Take five, pilot."); log("Shields down: focus session complete.", "ok"); speakBubble("Great burn! Take five. ☕"); }, [log, speakBubble]);
  const selfDestruct = async () => { const doneT = tasks.filter(t => t.done);
    if (!doneT.length) { toast("Nothing to self-destruct: no completed missions.", "info"); return; }
    if (!destruct || Date.now() > destruct) { setDestruct(Date.now() + 5000); sfx("alert"); haptic([50, 50, 50]); toast(`SELF-DESTRUCT ARMED: press again within 5s to purge ${doneT.length} completed mission${doneT.length > 1 ? "s" : ""}.`, "warn"); speakBubble("Are you sure?! Press again to confirm 😬"); return; }
    setDestruct(0); try { for (const t of doneT) await deleteTask(t.id); await reload(); sparks(innerWidth / 2, innerHeight / 2, 60); sfx("error"); haptic([200]); toast(`Purged ${doneT.length} completed missions.`); log(`Self-destruct: purged ${doneT.length} completed missions.`, "warn"); } catch (e) { toast((e as Error).message, "warn"); } };
  const boost = () => { sparks(); react("happy"); const m = ["You've got this, pilot!", "One mission at a time.", "Shields up, distractions down.", "Crystal believes in you ✨"]; const s = m[Math.floor(Math.random() * m.length)]; speakBubble(s); log(`Crystal: ${s}`, "ok"); sfx("chirp"); haptic(10); };

  async function execCommand(text: string) {
    if (!text || cmdBusy) return; setCmdBusy(true); setMood("thinking"); sfx("click"); log(`> ${text}`);
    try {
      const r = await call<CommandRequest, CommandResponse>(Routes.command, { text, nowIso: new Date().toISOString(), tzOffsetMinutes: new Date().getTimezoneOffset() });
      const it = r.intent;
      if (it.kind === "create_task") { await addTask({ title: it.title, due_date: it.dueDate, priority: it.priority }); await reload(); toast(`Task filed: ${it.title}${it.dueDate ? ` · due ${it.dueDate}` : ""}`); log(`Task created: ${it.title}`, "ok"); sfx("success"); haptic(12); sparks(); react("happy"); speakBubble("Mission logged! ✅"); }
      else if (it.kind === "create_item") { await insertRow(it.table, it.row); toast(it.summary); log(it.summary, "ok"); sfx("success"); haptic(12); sparks(); react("happy"); speakBubble("Got it! ✨"); openApp(it.app); }
      else if (it.kind === "open_app") { openApp(it.app); react("wave"); }
      else { speakBubble(it.reply.slice(0, 160), 7000); log(`Crystal: ${it.reply.slice(0, 120)}`); react("happy", 2500); }
      setCmd("");
    } catch (err) { toast((err as Error).message, "warn"); log(`Command failed: ${(err as Error).message}`, "warn"); sfx("error"); haptic([30, 30, 30]); react("alert"); }
    finally { setCmdBusy(false); }
  }

  const abilities: Ability[] = [
    { id: "home", icon: "⌂", label: "Home", cooldown: 0, run: goHome },
    { id: "brief", icon: "▣", label: "Brief", cooldown: 10, run: () => setBrief(true) },
    { id: "sweep", icon: "◉", label: "Sweep", cooldown: 8, run: sweep },
    { id: "shields", icon: "⛨", label: focusEnd ? "Drop" : "Shields", cooldown: 5, run: shields },
    { id: "ocr", icon: "📷", label: "Scan", cooldown: 0, run: () => openApp("ocr") },
    { id: "boost", icon: "⚡", label: "Boost", cooldown: 20, run: boost },
    { id: "night", icon: night ? "☀" : "☾", label: night ? "Day" : "Stealth", cooldown: 1, run: () => { setNight(n => !n); sfx("whoosh"); } },
    { id: "destruct", icon: "☢", label: destruct ? "CONFIRM" : "Purge", cooldown: 0, run: selfDestruct },
    { id: "alert", icon: "⚠", label: "Alert", cooldown: 3, run: toggleAlert },
  ];

  /* keyboard shortcuts */
  useEffect(() => { const h = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement; const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(p => !p); return; }
    if (e.key === "Escape") { setPalette(false); setHelp(false); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); cmdRef.current?.focus(); } else if (e.key === "?") setHelp(h => !h); else if (e.key.toLowerCase() === "h") goHome(); else if (e.key === "A") toggleAlert(); else if (e.key.toLowerCase() === "n") setNight(n => !n); else if (e.key.toLowerCase() === "b") setBrief(true); else if (e.key.toLowerCase() === "f") shields(); else if (e.key.toLowerCase() === "s") sweep();
  }; addEventListener("keydown", h); return () => removeEventListener("keydown", h); });

  if (!ready) return (<><SpaceBackground /><div className="flex h-dvh flex-col items-center justify-center gap-3"><CrystalBot size={90} mood="thinking" label="Crystal loading" /><p className="neon animate-glow font-mono">Establishing uplink…</p></div></>);

  const blips: Blip[] = open.map(t => ({ label: t.title, days: t.due_date ? daysTo(t.due_date) : null, hot: (!!t.due_date && t.due_date < t0) || (alert && t.priority === 1) }));
  const sd = schoolDay(new Date());
  const squad: Squad[] = [
    { id: "home", label: "Home", status: overdue.length ? "warn" : "ok", detail: `${open.length} open` },
    { id: "health", label: "Health", status: gluBad || medsDue.length ? "warn" : M("health_logs").length ? "ok" : "off", detail: `${M("health_logs").filter(r => r.kind === "steps" && r.logged_on === t0).reduce((a, r) => a + Number(r.value || 0), 0).toLocaleString()} steps · ${medsDue.length} meds` },
    { id: "comms", label: "Comms", status: comms.some(r => r.due_date && String(r.due_date) < t0) ? "warn" : comms.length ? "ok" : "off", detail: `${comms.length} to handle` },
    { id: "education", label: "School", status: missing.length || syncAlerts.length ? "warn" : sd.kind === "none" ? "off" : "ok", detail: missing.length ? `${missing.length} missing` : sd.label },
    { id: "finance", label: "Finance", status: billsOver.length ? "warn" : unpaid.length ? "ok" : "off", detail: `${unpaid.length} bills${billsOver.length ? `, ${billsOver.length} late` : ""}` },
    { id: "shopping", label: "Shop", status: shop.length ? "ok" : "off", detail: `${shop.length} items` },
  ];
  const contacts: Contact[] = [
    ...open.map(t => ({ label: t.title, sector: 0, hot: !!t.due_date && t.due_date < t0 })),
    ...medsDue.map(r => ({ label: `Med: ${r.name}`, sector: 1 })), ...(gluBad ? [{ label: "Glucose out of range", sector: 1, hot: true }] : []),
    ...comms.map(r => ({ label: String(r.title), sector: 2, hot: !!r.due_date && String(r.due_date) < t0 })),
    ...missing.map(a => ({ label: `Missing: ${a.name}`, sector: 3, hot: true })), ...syncAlerts.map(a => ({ label: a.message, sector: 3, hot: true })),
    ...unpaid.map(r => ({ label: `Bill: ${r.name}`, sector: 4, hot: !!r.due_date && String(r.due_date) < t0 })),
    ...shop.map(r => ({ label: String(r.name), sector: 5 })),
  ];
  const tactical: FeedItem[] = [
    ...contacts.filter(c => c.hot).map((c, i) => ({ t: i + 1, text: `HOSTILE: ${c.label}`, tone: "warn" as const })),
    ...medsDue.map((r, i) => ({ t: 100 + i, text: `Med due: ${r.name}${r.schedule ? ` (${r.schedule})` : ""}`, tone: "info" as const })),
    ...billsSoon.map((r, i) => ({ t: 200 + i, text: `Bill ${r.name} due ${r.due_date}`, tone: "info" as const })),
    { t: 300, text: `School: ${sd.label}`, tone: "ok" as const },
  ];
  const objectives = [...overdue.map(t => `Overdue: ${t.title}`), ...open.filter(t => t.due_date === t0).map(t => t.title), ...billsSoon.map(r => `Pay ${r.name}${r.amount ? ` ($${Number(r.amount).toFixed(0)})` : ""} by ${r.due_date}`), ...medsDue.map(r => `Take ${r.name}`), ...missing.slice(0, 2).map(a => `Eli: turn in ${a.name}`), ...open.filter(t => t.priority === 1 && t.due_date !== t0 && !overdue.includes(t)).map(t => t.title)].slice(0, 6);
  const globeNodes = [{ id: "tasks" as AppId, icon: "✓", label: "Tasks", count: open.length, hot: overdue.length > 0 }, ...squad.filter(q => q.id !== "home").map(q => ({ id: q.id, icon: META[q.id].icon, label: q.label, count: contacts.filter(c => c.sector === ["home", "health", "comms", "education", "finance", "shopping"].indexOf(q.id)).length, hot: q.status === "warn" })), { id: "ocr" as AppId, icon: "📷", label: "Scan", count: 0, hot: false }];

  const content = (id: AppId) => {
    switch (id) {
      case "home": return <><ErrorNote err={taskErr} /><Priorities tasks={alert ? tasks.filter(t => !t.done && (t.priority === 1 || (t.due_date ?? "9") < t0)) : tasks} /></>;
      case "tasks": return <><ErrorNote err={taskErr} /><TaskList tasks={tasks} reload={reload} log={log} /></>;
      case "weather": return <Weather />;
      case "calendar": return <Calendar tasks={tasks} />;
      case "crystal": return <ChatPanel mode="pilot" onMood={setMood} className="h-full min-h-[300px]" greeting="Hey pilot! 🚀 What are we tackling today?" />;
      case "education": return <Education demo={demo} log={log} />;
      case "school": return <SchoolHub log={log} />;
      case "health": return <Health log={log} />;
      case "comms": return <Comms log={log} />;
      case "finance": return <Finance log={log} />;
      case "shopping": return <Shopping log={log} />;
      case "ocr": return <Ocr log={log} onCommand={execCommand} />;
      case "globe": return <HoloGlobe nodes={globeNodes} onOpen={openApp} />;
      case "medals": return <MedalsPanel xp={xp} rank={RANKS[rankI]} next={TH[rankI + 1] ?? null} medals={medals} />;
    }
  };
  const visible = wins.filter(w => !w.minimized);
  const modeFor = (id: AppId): WinMode => desk ? "float" : HOME.includes(id) ? "grid" : "sheet";
  const actions: PaletteAction[] = [
    ...(Object.keys(META) as AppId[]).map(id => ({ id: `open-${id}`, label: `Open ${META[id].title}`, icon: META[id].icon, hint: "module", run: () => openApp(id) })),
    ...abilities.map((a, i) => ({ id: `ab-${a.id}`, label: a.id === "destruct" ? "Self-destruct: purge completed missions" : a.id === "alert" ? "Toggle Red Alert" : a.id === "shields" ? "Battle stations (25-min focus)" : a.id === "brief" ? "Mission briefing" : a.id === "sweep" ? "Scan sweep (due within 48h)" : a.id === "night" ? "Toggle night ops / stealth" : a.label, icon: a.icon, hint: `key ${i + 1}`, run: a.run })),
    { id: "tour", label: "Replay onboarding tour", icon: "🧭", run: () => setTour(true) },
    { id: "layout", label: "Reset window layout", icon: "▤", run: resetLayout },
    { id: "help", label: "Keyboard shortcuts", icon: "⌨", hint: "?", run: () => setHelp(true) },
    { id: "logout", label: "Log out", icon: "⏻", run: logout },
  ];

  return (
    <div className={alert ? "red-alert" : ""}>
      <SpaceBackground dim={night ? 0.85 : 0.5} />
      <Particles n={night ? 0 : 26} />
      <div className="alert-overlay pointer-events-none fixed inset-0 z-20" />
      <div className="pointer-events-none fixed inset-0 z-[1]" style={{ boxShadow: `inset 0 0 160px ${DEFCON_COLOR[level as 1]}22` }} />
      <div ref={sparkRoot} className="pointer-events-none fixed inset-0 z-[90]" />
      <Warp on={warp} /><Toaster />
      <header className="glass sticky top-0 z-30 !rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2">
          <button onClick={goHome} className="neon font-bold tracking-[.3em]" aria-label="Crystal home">◆ CRYSTAL</button>
          <form onSubmit={e => { e.preventDefault(); execCommand(cmd.trim()); }} className="order-3 flex w-full gap-2 sm:order-none sm:w-auto sm:flex-1">
            <input ref={cmdRef} value={cmd} onChange={e => setCmd(e.target.value)} className="input py-1.5 text-sm" placeholder='Command Crystal… "add milk to shopping list" · press / or ⌘K' aria-label="Command bar" maxLength={300} enterKeyHint="go" />
            <button className="btn btn-primary !py-1.5 text-sm" disabled={cmdBusy}>{cmdBusy ? "…" : "Go"}</button>
          </form>
          <button onClick={() => setPalette(true)} className="btn btn-ghost hidden !px-2 !py-1 text-xs sm:inline-flex" aria-label="Open command palette"><kbd>⌘K</kbd></button>
          <span className="ml-auto hidden max-w-[12rem] truncate text-xs text-ash md:inline">{demo ? "Demo mode" : user} · <span className="text-cyan">{RANKS[rankI]}</span></span>
          <button onClick={goHome} className="btn btn-ghost !px-2 !py-1 text-xs" aria-label="Home">⌂</button>
          <button onClick={logout} className="btn btn-ghost !px-2 !py-1 text-xs">Log out</button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1600px] px-3 pb-[190px] pt-3">
        {demo && <div className="mb-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-200">Demo mode: sample data stays on this device. <a href="/#launch" className="underline">Sign in</a> to save for real.</div>}
        <div className="mb-3 flex items-center gap-4">
          <CrystalBot size={76} mood={mood} say={say} onClick={() => { openApp("crystal"); react("wave"); sfx("chirp"); speakBubble("Hi pilot! Need anything? 💙"); }} label="Open Crystal co-pilot chat" />
          <div className="min-w-0"><div className="hud-label">Pilot&apos;s assistant · <span style={{ color: DEFCON_COLOR[level as 1] }}>DEFCON {level}</span></div><p className="text-snow">{greeting()}, {demo ? "pilot" : (user?.split("@")[0] ?? "pilot")}. {open.length ? `${open.length} open mission${open.length > 1 ? "s" : ""}.` : "All clear."}</p>
            {dc.reasons.length > 0 && <p className="truncate text-xs text-slate">Threats: {dc.reasons.slice(0, 3).join(" · ")}</p>}</div>
        </div>
        <section className="mb-3" aria-label="Modules">
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {MODULES.map(id => { const q = squad.find(s => s.id === id); return (
              <button key={id} onClick={() => openApp(id)} onMouseEnter={() => sfx("hover")} className={`tap glass relative rounded-xl p-2 text-left hover:border-cyan/60 ${q?.status === "warn" ? "!border-alert/60" : ""}`}>
                <div className="text-lg text-cyan">{META[id].icon}</div><div className="truncate text-xs font-semibold text-snow">{META[id].title}</div>
                {q && <div className="truncate text-[9px] text-slate">{q.detail}</div>}
                {q?.status === "warn" && <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-glow rounded-full bg-alert" aria-label="needs attention" />}
              </button>); })}
          </div>
        </section>
        {desk ? (
          <div className="relative" style={{ height: `max(calc(100dvh - 330px), ${Math.max(...visible.map(w => (w.geo?.y ?? 0) + (w.geo?.h ?? 0)), 400) + 20}px)` }}>
            {visible.map(w => <div key={w.id} className={focusEnd && !ESSENTIAL.includes(w.id) && focus !== w.id ? "focus-dim" : ""}>
              <Applet title={w.title} icon={META[w.id].icon} mode="float" geo={w.geo} z={w.z} onGeo={g => setGeo(w.id, g)} focused={focus === w.id} onFocus={() => front(w.id)} onMin={() => minimize(w.id)} onClose={() => close(w.id)}>{content(w.id)}</Applet></div>)}
            {!visible.length && <div className="glass flex flex-col items-center rounded-2xl p-6 text-center text-ash"><CrystalBot size={64} mood="wave" label="Crystal" />All applets closed. Press <kbd className="mx-1 rounded border border-slate/50 px-1">H</kbd> or ⌂ Home to restore.</div>}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.map(w => { const m = modeFor(w.id); return <div key={w.id} className={`${m === "sheet" ? "" : ""} ${focusEnd && !ESSENTIAL.includes(w.id) && focus !== w.id && m !== "sheet" ? "focus-dim" : ""}`}>
              <Applet title={w.title} icon={META[w.id].icon} mode={m} z={w.z} focused={focus === w.id} onFocus={() => setFocus(w.id)} onMin={() => minimize(w.id)} onClose={() => close(w.id)}>{content(w.id)}</Applet></div>; })}
          </div>
        )}
      </main>

      {focusEnd && <ShieldsTimer endsAt={focusEnd} total={25 * 60000} onEnd={shieldsDone} onAbort={() => { setFocusEnd(null); log("Shields down (aborted).", "info"); sfx("close"); }} />}
      <HudBar pilot={demo ? "demo pilot" : (user?.split("@")[0] ?? "pilot")} mood={mood} onPilot={() => { openApp("crystal"); react("wave"); sfx("chirp"); }} squad={squad} contacts={contacts} tactical={tactical}
        radar={blips} pulse={pulse} defcon={{ level, reasons: manualAlert ? ["Manual red alert", ...dc.reasons] : dc.reasons }} bars={bars} feedsMuted={!!focusEnd}
        abilities={abilities} feed={feed} blips={open.length} alert={alert} onAlert={toggleAlert} onHome={goHome} onLogout={logout} open={wins} onRestore={id => openApp(id)} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} actions={actions} onFreeText={t => execCommand(t)} />
      <Tour open={tour} onDone={() => { setTour(false); if (pref("brief-date") !== ymd()) setBrief(true); }} />
      <Briefing open={brief} onClose={() => { setBrief(false); setPref("brief-date", ymd()); }} name={demo ? "pilot" : (user?.split("@")[0] ?? "pilot")} objectives={objectives} defcon={level} weather="" />
      <IncomingTransmission tx={tx} onAck={t => { settleTx(t, -1); sfx("success"); openApp(t.app); }} onSnooze={t => { settleTx(t, Date.now() + 3600e3); sfx("close"); toast("Transmission snoozed for 1 hour", "info"); }} />
      {help && <div className="fade-in fixed inset-0 z-[72] flex items-center justify-center bg-navy/70 p-4" onClick={() => setHelp(false)}><div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="win-in glass neon-frame w-full max-w-md rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <h2 className="mb-3 font-semibold text-snow">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">{[["⌘/Ctrl K", "Command palette"], ["/", "Focus command bar"], ["1–9", "Fire ability (respects cooldown)"], ["H", "Home"], ["S", "Scan sweep"], ["F", "Battle stations focus"], ["B", "Mission briefing"], ["N", "Night ops / stealth"], ["Shift A", "Red Alert"], ["Alt+Arrows", "Move focused window"], ["Esc", "Close overlays"], ["?", "This help"]].map(([k, v]) => <Fragment key={k}><dt><kbd className="rounded border border-cyan/40 px-1.5 font-mono text-xs text-cyan">{k}</kbd></dt><dd className="text-ice">{v}</dd></Fragment>)}</dl>
        <button autoFocus className="btn btn-primary mt-4 w-full" onClick={() => setHelp(false)}>Close</button></div></div>}
    </div>
  );
}
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
