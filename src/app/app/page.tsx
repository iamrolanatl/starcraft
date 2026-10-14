"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SpaceBackground from "@/components/SpaceBackground";
import CrystalBot, { type Mood } from "@/components/CrystalBot";
import dynamic from "next/dynamic";
// Code-split: every applet is its own chunk, loaded on first open.
const Ld = () => <div className="space-y-2" aria-busy="true"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton h-4 w-1/2 rounded" /><div className="skeleton h-16 rounded" /></div>;
const ChatPanel = dynamic(() => import("@/components/ChatPanel"), { ssr: false, loading: Ld });
import Applet, { type Geo, type WinMode } from "@/components/Applet";
import { HudBar, type Ability, type FeedItem, type Squad, type Contact, type Blip } from "@/components/hud/Hud";
import { computeDefcon, DEFCON_COLOR, RANKS, type Transmission, type Medal } from "@/components/hud/Ops";
const ShieldsTimer = dynamic(() => import("@/components/hud/Ops").then(m => m.ShieldsTimer), { ssr: false });
const Briefing = dynamic(() => import("@/components/hud/Ops").then(m => m.Briefing), { ssr: false });
const IncomingTransmission = dynamic(() => import("@/components/hud/Ops").then(m => m.IncomingTransmission), { ssr: false });
const Warp = dynamic(() => import("@/components/hud/Ops").then(m => m.Warp), { ssr: false });
const MedalsPanel = dynamic(() => import("@/components/hud/Ops").then(m => m.MedalsPanel), { ssr: false, loading: Ld });
const HoloGlobe = dynamic(() => import("@/components/hud/Ops").then(m => m.HoloGlobe), { ssr: false, loading: Ld });
const Priorities = dynamic(() => import("@/components/apps/Apps").then(m => m.Priorities), { ssr: false, loading: Ld });
const TaskList = dynamic(() => import("@/components/apps/Apps").then(m => m.TaskList), { ssr: false, loading: Ld });
const Weather = dynamic(() => import("@/components/apps/Apps").then(m => m.Weather), { ssr: false, loading: Ld });
const Calendar = dynamic(() => import("@/components/apps/Apps").then(m => m.Calendar), { ssr: false, loading: Ld });
import { dailySteps } from "@/components/apps/HealthSteps";
const Health = dynamic(() => import("@/components/apps/Modules").then(m => m.Health), { ssr: false, loading: Ld });
const Comms = dynamic(() => import("@/components/apps/Modules").then(m => m.Comms), { ssr: false, loading: Ld });
const Finance = dynamic(() => import("@/components/apps/Modules").then(m => m.Finance), { ssr: false, loading: Ld });
const Shopping = dynamic(() => import("@/components/apps/Modules").then(m => m.Shopping), { ssr: false, loading: Ld });
const SchoolHub = dynamic(() => import("@/components/apps/Modules").then(m => m.SchoolHub), { ssr: false, loading: Ld });
const Education = dynamic(() => import("@/components/apps/Education"), { ssr: false, loading: Ld });
const Ocr = dynamic(() => import("@/components/apps/Ocr"), { ssr: false, loading: Ld });
import type { PaletteAction } from "@/components/ui/CommandPalette";
const CommandPalette = dynamic(() => import("@/components/ui/CommandPalette"), { ssr: false });
const Tour = dynamic(() => import("@/components/ui/Tour"), { ssr: false });
import { Toaster, toast, ErrorNote, Particles, undoableDelete } from "@/components/ui/kit";
import { listTasks, addTask, deleteTask, restoreTask, type Task } from "@/lib/tasks";
import { list as listRows, remove as removeRow, restore as restoreRow, insert as insertRow, setDemo as setStoreDemo, onChange as onStoreChange, type Row } from "@/lib/store";
import { loadEducation, loadSyncStatus, type EduData, type SyncStatus } from "@/lib/education";
import { schoolDay } from "@/lib/school";
import { sb } from "@/lib/supabase";
import { sfx, ambient, haptic, isMuted, stopSpeech, speak, unlockSpeech } from "@/lib/synth";
import { listenOnce, voiceSupported, hasWebSpeech, type Listen } from "@/lib/voice";
import { startHandsFree, handsFreeSupported, type HFState } from "@/lib/handsfree";
import { loadPrefs, savePrefs, type Clarity } from "@/lib/prefs";
import { askPilot } from "@/lib/ask";
import { waitEscalation, escText } from "@/lib/escalation";
import { safeJSON, lsRaw, lsSet } from "@/lib/safe";
import { useSafeArea, lastPointer } from "@/lib/safearea";
import { tile } from "@/lib/tile";
import { greeting as greetText, greetName, fullName, shortName, type Profile } from "@/lib/names";
import { getProfile, loadProfile } from "@/lib/profile";
import { getSettings, saveSettings, applySettings, BG_PRESETS, type Settings } from "@/lib/settings";
const SettingsCenter = dynamic(() => import("@/components/SettingsCenter"), { ssr: false });
import { Boundary, useGlobalErrorHooks, OfflineBanner } from "@/components/ui/Guard";
import { ExtTasks } from "@/components/apps/ExtSync";
import { captureGoogleToken } from "@/lib/ext";
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
type Win = { id: AppId; title: string; minimized: boolean; geo?: Geo; z: number; max?: boolean };
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysTo = (d: string) => Math.round((new Date(d + "T12:00").getTime() - new Date(ymd() + "T12:00").getTime()) / 864e5);
const pref = (k: string, d = "") => lsRaw(`crystal-${k}`, d);
const setPref = (k: string, v: string) => lsSet(`crystal-${k}`, v);
const reduced = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Comfortable "normal" (non-full-screen) size per applet, as a fraction of the space between the toolbars; always centered. */
const NORMAL_SIZE: Record<string, [number, number]> = { default: [0.72, 0.86], calendar: [0.9, 0.92], school: [0.9, 0.92], education: [0.86, 0.9], comms: [0.86, 0.9], crystal: [0.6, 0.86], weather: [0.6, 0.8] };
function tileGeo(i: number, W: number): Geo { const cols = W >= 1500 ? 3 : 2; const w = Math.floor((W - 24 - (cols - 1) * 12) / cols); return { x: 12 + (i % cols) * (w + 12), y: 8 + Math.floor(i / cols) * 352, w, h: 340 }; }

export default function Cockpit() {
  const [user, setUser] = useState<string | null>(null); const [ready, setReady] = useState(false); const [demo, setDemo] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]); const [taskErr, setTaskErr] = useState<{ message: string; kind?: string } | null>(null); const [tasksLoaded, setTasksLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile>({}); const [center, setCenter] = useState<null | "Profile" | "Appearance">(null); const [qs, setQs] = useState<Settings | null>(null);
  const [wins, setWins] = useState<Win[]>([]); const [focus, setFocus] = useState<AppId>("home"); const zTop = useRef(10); const [winPref, setWinPref] = useState<"full" | "normal">("full"); const winPrefRef = useRef(winPref); winPrefRef.current = winPref; const origin = useRef({ x: -1, y: -1 });
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
  useEffect(() => { const h = () => { reloadRef.current(); }; addEventListener("crystal-refresh", h); return () => removeEventListener("crystal-refresh", h); }, []);
  const reloadRef = useRef<() => void>(() => {});
  const reload = useCallback(async () => { try { setTasks(await listTasks()); setTaskErr(null); } catch (e) { setTaskErr(e as { message: string; kind?: string }); log(`Tasks: ${(e as Error).message}`, "warn"); } finally { setTasksLoaded(true); } }, [log]);
  const loadMods = useCallback(async () => { const T = ["health_logs", "meds", "bills", "shop_items", "comms_notes", "edu_checkins", "credit_scores"] as const; const out: Record<string, Row[]> = {}; await Promise.all(T.map(async t => { try { out[t] = await listRows(t); } catch { out[t] = []; } })); setMod(out); }, []);
  reloadRef.current = () => { reload(); };
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
    const { data: sub } = c.auth.onAuthStateChange((_e, s) => { if (s) done(s.user.email ?? "pilot"); if (s?.provider_refresh_token) captureGoogleToken().then(ok => { if (ok && location.search.includes("google=connected")) { toast("Google connected: Tasks + Calendar will sync within 15 min"); history.replaceState(null, "", "/app/"); } }); });
    const mq = matchMedia("(min-width: 1100px) and (not (pointer: coarse))"); const upd = () => setDesk(mq.matches); upd(); mq.addEventListener("change", upd);
    setNight(pref("theme") === "night"); const pt = () => setPrefTick(x => x + 1); addEventListener("crystal-prefs", pt);
    return () => { sub.subscription.unsubscribe(); mq.removeEventListener("change", upd); removeEventListener("crystal-prefs", pt); };
  }, []);
  useEffect(() => { if (!ready) return; /* boot: ALL applets closed (minimized to the dock) */ setWins(HOME.map((id, i) => ({ id, title: META[id].title, minimized: true, z: i + 1, geo: savedGeo(id) ?? tileGeo(i, innerWidth) })));
    reload().then(() => log("Systems online. Welcome aboard, pilot.", "ok")); loadMods(); loadEdu(demo);
    const un = onStoreChange(loadMods); const iv = setInterval(() => { loadEdu(demo); loadMods(); }, 300000);
    if (pref("tour") !== "done") setTour(true); else if (pref("brief-date") !== ymd()) setBrief(true);
    return () => { un(); clearInterval(iv); };
  }, [ready, demo, reload, loadMods, loadEdu, log]);
  // Progressive mount: stage 0 = shell, 1 = HUD, 2.. = home applets one per idle slice (keeps main-thread tasks short).
  const [stage, setStage] = useState(0); const idle = stage > 0;
  useEffect(() => { if (stage > 5) return; const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    const f = () => setStage(s => s + 1); if (w.requestIdleCallback) { const id = w.requestIdleCallback(f, { timeout: stage === 0 ? 1500 : 400 }); return () => w.cancelIdleCallback?.(id); } const t = setTimeout(f, stage === 0 ? 800 : 120); return () => clearTimeout(t); }, [stage]);
  useGlobalErrorHooks();

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
  useEffect(() => { const start = () => { ambOn.current = true; ambient(focusEnd ? 5 : level); }; addEventListener("pointerdown", start, { once: true }); return () => { removeEventListener("pointerdown", start); ambient(null); stopSpeech(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ambOn.current) ambient(isMuted() ? null : night ? null : focusEnd ? 5 : level); }, [level, focusEnd, night]);
  const prevLevel = useRef(5);
  useEffect(() => { if (!tasksLoaded) return; if (level < prevLevel.current) { log(`DEFCON ${level}: ${dc.reasons.slice(0, 2).join(", ") || "manual"}`, "warn"); if (level <= 2) { sfx("alert"); haptic([80, 50, 80]); speakBubble(`DEFCON ${level}! ${dc.reasons[0] ?? ""}`); } } else if (level > prevLevel.current) log(`Readiness improved: DEFCON ${level}`, "ok"); prevLevel.current = level; }, [level, tasksLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  /* incoming transmissions (urgent items), with ack/snooze */
  const txs: Transmission[] = useMemo(() => [
    ...syncAlerts.map(a => ({ id: `sync-${a.id}`, from: "School sync", title: ({ absence: "New absence", missing_assignment: "Missing assignment", low_score: "Low score", grade_dip: "Grade below 90" } as Record<string, string>)[(a as { kind?: string }).kind ?? ""] ?? "Sync failure", body: a.message, app: "education" as AppId })),
    ...unreadTeacher.slice(0, 3).map(m => ({ id: `msg-${m.ext_id}`, from: m.sender || "Teacher", title: m.subject || "Teacher message", body: (m.body || "").slice(0, 280), app: "education" as AppId })),
    ...unpaid.filter(r => r.due_date === t0).map(r => ({ id: `bill-${r.id}-${t0}`, from: "Finance", title: `Bill due today: ${r.name}`, body: `${r.name}${r.amount ? ` for $${Number(r.amount).toFixed(2)}` : ""} is due today. Pay it or set autopay.`, app: "finance" as AppId })),
  ], [syncAlerts, unreadTeacher, unpaid, t0]);  
  useEffect(() => { if (tx || tour || brief || palette || focusEnd) return; const acks = safeJSON<Record<string, number>>(pref("tx", "{}"), {}); const next = txs.find(t => !(acks[t.id] && (acks[t.id] === -1 || acks[t.id] > Date.now()))); if (next) setTx(next); }, [txs, tx, tour, brief, palette, focusEnd, txQueueTick]);  
  const settleTx = (t: Transmission, until: number) => { const a = safeJSON<Record<string, number>>(pref("tx", "{}"), {}); a[t.id] = until; setPref("tx", JSON.stringify(a)); setTx(null); setTimeout(() => setTxTick(x => x + 1), 800); };

  /* effects helpers */
  function sparks(x = innerWidth / 2, y = innerHeight / 2, n = 16) {
    const root = sparkRoot.current; if (!root || reduced()) return;
    for (let i = 0; i < n; i++) { const s = document.createElement("span"); s.className = "spark"; const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 90; s.style.left = `${x}px`; s.style.top = `${y}px`; s.style.background = ["#7dffc8", "#3ef2e0", "#c77dff", "#ff7ab6"][i % 4]; s.style.setProperty("--dx", `${Math.cos(a) * d}px`); s.style.setProperty("--dy", `${Math.sin(a) * d}px`); root.appendChild(s); setTimeout(() => s.remove(), 700); }
  }
  const react = (m: Mood, ms = 1600) => { setMood(m); setTimeout(() => setMood(alert ? "alert" : "idle"), ms); };
  function savedGeo(id: AppId): Geo | undefined { const g = safeJSON<Geo | null>(pref(`geo-${id}`, "null"), null); return g && [g.x, g.y, g.w, g.h].every(n => Number.isFinite(n)) ? { x: Math.min(Math.max(0, g.x), Math.max(0, innerWidth - 200)), y: Math.max(0, g.y), w: Math.min(Math.max(260, g.w), innerWidth), h: Math.max(180, g.h) } : undefined; }
  const front = (id: AppId) => { zTop.current += 1; const z = zTop.current; setWins(w => w.map(x => x.id === id ? { ...x, z } : x)); setFocus(id); };
  const doOpen = (id: AppId) => { sfx("open"); haptic(10); zTop.current += 1; const z = zTop.current;
    origin.current = { ...lastPointer };
    // v4 window manager: opening anything minimizes ALL other applets to the dock and maximizes this one into the safe area.
    const full = !desk || getSettings().openMode !== "tile"; const g0 = { x: Math.max(12, innerWidth / 2 - 330), y: 12, w: Math.min(660, innerWidth - 24), h: 540 };
    setWins(w => { w = full ? w.map(x => x.id === id ? x : { ...x, minimized: true, max: false }) : w.map(x => ({ ...x, max: false })); return w.some(x => x.id === id) ? w.map(x => x.id === id ? { ...x, minimized: false, max: full, z, geo: x.geo ?? g0 } : x) : [...w, { id, title: META[id].title, minimized: false, max: full, z, geo: savedGeo(id) ?? g0 }]; });
    setFocus(id); log(`Applet opened: ${META[id].title}`); };
  const openApp = (id: AppId) => { if (HOME.includes(id) || reduced() || wins.some(w => w.id === id && !w.minimized)) return doOpen(id); origin.current = { ...lastPointer }; setWarp(true); sfx("whoosh"); haptic([10, 20, 30]); setTimeout(() => { doOpen(id); setWarp(false); }, 520); };
  /** Dock / module order for Alt+1–9 and cycling. */
  const dockPref = (qs?.dock ?? []) as AppId[];
  const ORDER: AppId[] = dockPref.length ? dockPref : [...MODULES, "crystal"];
  const closeAll = () => { setWins(w => w.map(x => ({ ...x, minimized: true, max: false }))); sfx("whoosh"); haptic(8); log("All applets minimized: clean cockpit."); };
  const cycle = (d: number) => { const cur = wins.find(w => !w.minimized && w.max)?.id ?? focus; const i = ORDER.indexOf(cur); const n = ORDER[((i < 0 ? (d > 0 ? -1 : 0) : i) + d + ORDER.length) % ORDER.length]; openApp(n); };
  const toggleFull = () => { if (!desk) return; const n = winPrefRef.current === "normal" ? "full" : "normal"; setWinPref(n); savePrefs({ win: n }); sfx("whoosh");
    const f = wins.find(w => !w.minimized && w.max); if (!f) { const g = wins.find(w => !w.minimized && w.id === focus) ?? wins.find(w => !w.minimized && !HOME.includes(w.id)); if (g) doOpen(g.id); }
    toast(n === "normal" ? "Normal window size (F or double-click title for full screen)" : "Full screen", "info"); };
  const minimize = (id: AppId) => setWins(w => w.map(x => x.id === id ? { ...x, minimized: true, max: false } : x));
  const unMax = (id: AppId) => { setWins(w => w.map(x => x.id === id ? { ...x, max: false } : x)); sfx("whoosh"); };
  const close = (id: AppId) => setWins(w => w.filter(x => x.id !== id));
  const setGeo = (id: AppId, g: Geo) => { setPref(`geo-${id}`, JSON.stringify(g)); setWins(w => w.map(x => x.id === id ? { ...x, geo: g } : x)); };
  const goHome = () => { sfx("ping"); haptic(8); setWins(HOME.map((id, i) => ({ id, title: META[id].title, minimized: false, z: i + 1, geo: savedGeo(id) ?? tileGeo(i, innerWidth) }))); setFocus("home"); window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" }); log("Returning to Home."); };
  const resetLayout = () => { HOME.concat(MODULES, ["crystal"]).forEach(id => { try { localStorage.removeItem(`crystal-geo-${id}`); } catch {} }); setWins(w => w.map((x, i) => ({ ...x, geo: tileGeo(i, innerWidth) }))); toast("Window layout reset"); };
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

  const say2 = (s: string, voice: boolean) => { if (voice && !isMuted()) speak(s.replace(/\[source:[^\]]*\]/g, "").replace(/[✅✨💙🎖]/gu, "").slice(0, 400)); };
  /** NL/voice "remove <item> [from my shopping/wish/to-do list]" → optimistic delete with undo. */
  async function removeByVoice(text: string, voice: boolean): Promise<boolean> {
    const m = text.trim().match(/^(?:please\s+)?(?:remove|delete|cross off|scratch|get rid of|take)\s+(?:the\s+)?(?:task\s+)?["“]?(.+?)["”]?(?:\s+(?:from|off(?: of)?)\s+(?:my\s+|the\s+)?(to-?do|tasks?|missions?|shopping|grocery|wish)(?:\s+list)?)?[.!]?$/i);
    if (!m) return false; const needle = m[1].toLowerCase().replace(/^(my|a|an)\s+/, ""); const where = (m[2] || "").toLowerCase();
    if (/^(all )?(completed|done)( tasks)?$/.test(needle)) { const done = tasks.filter(t => t.done); if (!done.length) { toast("No completed tasks to clear.", "info"); return true; }
      await undoableDelete(done, { label: `Cleared ${done.length} completed`, hide: () => setTasks(ts => ts.filter(t => !t.done)), rollback: () => reload(), commit: t => deleteTask(t.id), restore: t => restoreTask(t), after: () => { reload(); } }); say2(`Cleared ${done.length} completed tasks`, voice); return true; }
    const hit = (s: unknown) => String(s ?? "").toLowerCase().includes(needle);
    if (!/shopping|grocery|wish/.test(where)) {
      const ts = tasks.filter(t => hit(t.title)); const t = ts.find(x => x.title.toLowerCase() === needle) ?? ts[0];
      if (t) { await undoableDelete([t], { label: `Deleted "${t.title}"`, hide: () => setTasks(x => x.filter(y => y.id !== t.id)), rollback: () => reload(), commit: x => deleteTask(x.id), restore: x => restoreTask(x), after: () => { reload(); } }); log(`Removed task: ${t.title}`, "ok"); say2(`Removed ${t.title}`, voice); return true; }
      if (/to-?do|task|mission/.test(where)) { toast(`No task matching "${m[1]}".`, "warn"); say2(`I couldn't find a task called ${m[1]}`, voice); return true; }
    }
    try {
      const list = /wish/.test(where) ? "wish" : /shopping|grocery/.test(where) ? "shopping" : null;
      const rows = (await listRows("shop_items")).filter(r => (!list || r.list === list) && hit(r.name)); const r = rows[0];
      if (!r) { toast(`Nothing matching "${m[1]}" to remove.`, "warn"); say2(`I couldn't find ${m[1]}`, voice); return true; }
      await undoableDelete([r], { label: `Removed ${String(r.name)} from ${String(r.list)} list`, hide: () => {}, rollback: () => {}, commit: x => removeRow("shop_items", x.id), restore: x => restoreRow("shop_items", x) });
      say2(`Removed ${String(r.name)}`, voice); return true;
    } catch (e) { toast((e as Error).message, "warn"); return true; }
  }
  async function execCommand(text: string, voice = false) {
    if (!text || cmdBusy) return; setCmdBusy(true); setMood("thinking"); sfx("click"); log(`> ${text}`);
    try {
      if (await removeByVoice(text, voice)) { setCmd(""); return; }
      const r = await call<CommandRequest, CommandResponse>(Routes.command, { text, nowIso: new Date().toISOString(), tzOffsetMinutes: new Date().getTimezoneOffset() });
      const it = r.intent;
      if (it.kind === "create_task") { await addTask({ title: it.title, due_date: it.dueDate, priority: it.priority }); await reload(); toast(`Task filed: ${it.title}${it.dueDate ? ` · due ${it.dueDate}` : ""}`); log(`Task created: ${it.title}`, "ok"); sfx("success"); haptic(12); sparks(); react("happy"); speakBubble("Mission logged! ✅"); say2(`Mission logged: ${it.title}`, voice); }
      else if (it.kind === "create_item") { await insertRow(it.table, it.row); toast(it.summary); log(it.summary, "ok"); sfx("success"); haptic(12); sparks(); react("happy"); speakBubble("Got it! ✨"); say2(it.summary, voice); openApp(it.app); }
      else if (it.kind === "open_app") { openApp(it.app); react("wave"); say2(`Opening ${META[it.app].title}`, voice); }
      else { const g = await askPilot([{ role: "user", content: text }]); speakBubble(g.reply.slice(0, 220), 9000); toast(g.reply.slice(0, 220), "info"); log(`Crystal${g.grounded ? " [data]" : ""}: ${g.reply.slice(0, 160)}`); react("happy", 2500); say2(g.reply, voice); if (g.escalation) void waitEscalation(g.escalation.id).then(x => { const a = escText(x); speakBubble(a.slice(0, 220), 12000); toast(a.slice(0, 220), x.status === "answered" ? "info" : "warn"); log(`Crystal [escalated]: ${a.slice(0, 160)}`); say2(a, voice); }); }
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
    if (listening) return; // ignore shortcuts during voice input
    if (center) { if (e.key === "Escape") setCenter(null); return; }
    const overlay = palette || help || settings || tour || brief;
    if (e.key === "Escape" && !typing) { if (!e.shiftKey && overlay) { setPalette(false); setHelp(false); setSettings(false); return; } e.preventDefault(); closeAll(); return; }
    if (e.key === "Escape") { setPalette(false); setHelp(false); return; }
    if (typing || e.metaKey || e.ctrlKey) return;
    // Alt+0 close all · Alt+1–9 / 1–9 open one applet maximized · Alt+←/→ cycle
    const dig = /^Digit([0-9])$/.exec(e.code)?.[1];
    if (e.altKey && dig === "0") { e.preventDefault(); closeAll(); return; }
    if (dig && dig !== "0" && !e.shiftKey) { const id = ORDER[Number(dig) - 1]; if (id) { e.preventDefault(); openApp(id); } return; }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); cycle(e.key === "ArrowRight" ? 1 : -1); return; }
    if (e.altKey) return;
    if (e.key === "F") { shields(); return; }
    if (e.key === "/") { e.preventDefault(); cmdRef.current?.focus(); } else if (e.key === "?") setHelp(h => !h); else if (e.key.toLowerCase() === "h") goHome(); else if (e.key === "A") toggleAlert(); else if (e.key.toLowerCase() === "n") setNight(n => !n); else if (e.key.toLowerCase() === "b") setBrief(true); else if (e.key === "f") toggleFull(); else if (e.key.toLowerCase() === "s") sweep();
  }; addEventListener("keydown", h); return () => removeEventListener("keydown", h); });

  // ---- voice ----
  const [listening, setListening] = useState(false); const [caption, setCaption] = useState(""); const [handsFree, setHandsFree] = useState(false);
  useEffect(() => { setProfile(getProfile()); applySettings(); setQs(getSettings()); const f = () => setProfile({ ...getProfile() }); const g = () => setQs(getSettings()); addEventListener("crystal-profile", f); addEventListener("crystal-settings", g); return () => { removeEventListener("crystal-profile", f); removeEventListener("crystal-settings", g); }; }, []);
  const bootOpened = useRef(false); useEffect(() => { if (!ready || bootOpened.current) return; bootOpened.current = true; const d = getSettings().defaultApplet as AppId; if (d && d !== "home" && META[d]) setTimeout(() => openApp(d), 600); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && !demo) loadProfile().then(p => setProfile({ ...p })); }, [ready, demo]);
  const [settings, setSettings] = useState(false); const [clarity, setClarity] = useState<Clarity>("balanced");
  const ptt = useRef<Listen | null>(null); const capT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showCap = (t: string, ms = 0) => { setCaption(t); clearTimeout(capT.current); if (ms) capT.current = setTimeout(() => setCaption(""), ms); };
  const runVoice = useRef<(t: string) => void>(() => {}); runVoice.current = (t: string) => { showCap(`“${t}”`, 4000); setCmd(t); execCommand(t, true); };
  const toggleMic = () => {
    if (listening) { ptt.current?.stop(); return; }
    if (!voiceSupported()) { toast("Voice isn't supported in this browser. Type your command instead.", "warn"); return; }
    stopSpeech(); sfx("ping"); haptic(10); setListening(true); setMood("thinking"); showCap(hasWebSpeech() ? "Listening…" : "Listening… (tap mic again to send)");
    ptt.current = listenOnce({ onPartial: t => showCap(t), onFinal: t => { if (t) runVoice.current(t); }, onError: m => { toast(m, "warn"); showCap(m, 4000); sfx("error"); },
      onEnd: () => { setListening(false); ptt.current = null; setMood(m => m === "thinking" ? "idle" : m); } });
  };
  useEffect(() => () => { ptt.current?.stop(); clearTimeout(capT.current); }, []);
  const [hf, setHf] = useState<HFState>({ kind: "off" });
  const setHandsFreeOn = (v: boolean) => { if (v) { unlockSpeech(); stopSpeech(); } setHandsFree(v); savePrefs({ handsFree: v }); if (!v) setHf({ kind: "off" }); };
  useEffect(() => { if (!handsFree) return;
    if (!handsFreeSupported()) { setHf({ kind: "error", text: "Voice isn't supported in this browser.", hint: "Use Chrome or Safari, or type your command." }); setHandsFree(false); return; }
    const w = startHandsFree(async t => { setCmd(t); await execCommand(t, true); }, s => { setHf(s); if (s.kind === "error") console.warn("[hands-free]", s.text); }, () => setHandsFree(false));
    return () => w.stop(); }, [handsFree]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!ready) return; loadPrefs().then(p => { setClarity(p.glass ?? "balanced"); if (p.win) setWinPref(p.win); if ((p.handsFree ?? true) && handsFreeSupported()) { setHf({ kind: "error", text: "Tap to Start Hands-Free", hint: "Hands-Free is on by default. Browsers need one tap before Crystal can use the mic." }); } }); }, [ready, user, demo]);
  const [coarse, setCoarse] = useState(false); useEffect(() => { setCoarse(matchMedia("(pointer: coarse)").matches); }, []);
  const maxedId = wins.find(w => !w.minimized && w.max)?.id;
  const safeRect = useSafeArea(wins.some(w => !w.minimized));
  const [tileOrder, setTileOrder] = useState<AppId[]>([]);
  const tiled = useMemo(() => { const v = wins.filter(w => !w.minimized && !w.max); const ix = (id: AppId) => { const i = tileOrder.indexOf(id); return i < 0 ? 1e3 + v.findIndex(w => w.id === id) : i; }; return [...v].sort((a, b) => ix(a.id) - ix(b.id)); }, [wins, tileOrder]);
  const tileRects = useMemo(() => safeRect && desk ? tile(tiled.length, safeRect, 12) : [], [safeRect, desk, tiled.length]);
  const dropTile = (id: AppId, x: number, y: number) => { const j = tileRects.findIndex(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h); const i = tiled.findIndex(w => w.id === id); if (j < 0 || j === i) return;
    const ids = tiled.map(w => w.id); [ids[i], ids[j]] = [ids[j], ids[i]]; setTileOrder(ids); sfx("ping"); };
  const winRect = useMemo(() => { if (!safeRect || !desk || winPref !== "normal") return safeRect; const sz = NORMAL_SIZE[maxedId ?? ""] ?? NORMAL_SIZE.default; const w = Math.min(safeRect.w, Math.max(560, Math.round(safeRect.w * sz[0]))), h = Math.min(safeRect.h, Math.max(420, Math.round(safeRect.h * sz[1])));
    return { ...safeRect, x: Math.round(safeRect.x + (safeRect.w - w) / 2), y: Math.round(safeRect.y + (safeRect.h - h) / 2), w, h }; }, [safeRect, desk, winPref, maxedId]);
  if (!ready) return (<><SpaceBackground /><div className="flex h-dvh flex-col items-center justify-center gap-3"><CrystalBot size={90} mood="thinking" label="Crystal loading" /><p className="neon animate-glow font-mono">Establishing uplink…</p></div></>);

  const blips: Blip[] = open.map(t => ({ label: t.title, days: t.due_date ? daysTo(t.due_date) : null, hot: (!!t.due_date && t.due_date < t0) || (alert && t.priority === 1) }));
  const sd = schoolDay(new Date());
  const squad: Squad[] = [
    { id: "home", label: "Home", status: overdue.length ? "warn" : "ok", detail: `${open.length} open` },
    { id: "health", label: "Health", status: gluBad || medsDue.length ? "warn" : M("health_logs").length ? "ok" : "off", detail: `${(dailySteps(M("health_logs")).get(t0) ?? 0).toLocaleString()} steps · ${medsDue.length} meds` },
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
    if (HOME.includes(id) && stage < 2 + HOME.indexOf(id)) return <Ld />;
    switch (id) {
      case "home": return <><ErrorNote err={taskErr} /><Priorities reload={reload} tasks={alert ? tasks.filter(t => !t.done && (t.priority === 1 || (t.due_date ?? "9") < t0)) : tasks} /></>;
      case "tasks": return <><ErrorNote err={taskErr} /><TaskList tasks={tasks} reload={reload} log={log} /><ExtTasks /></>;
      case "weather": return <Weather />;
      case "calendar": return <Calendar tasks={tasks} />;
      case "crystal": return <ChatPanel mode="pilot" onMood={setMood} className="h-full min-h-[300px]" greeting={`Hey ${greetName(profile)}! 🚀 What are we tackling today?`} />;
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
  const maxed = visible.find(w => w.max) ?? null;
  const modeFor = (id: AppId): WinMode => desk ? "float" : HOME.includes(id) ? "grid" : "sheet";
  const actions: PaletteAction[] = [
    ...(Object.keys(META) as AppId[]).map(id => ({ id: `open-${id}`, label: `Open ${META[id].title}`, icon: META[id].icon, hint: "module", run: () => openApp(id) })),
    ...abilities.map((a, i) => ({ id: `ab-${a.id}`, label: a.id === "destruct" ? "Self-destruct: purge completed missions" : a.id === "alert" ? "Toggle Red Alert" : a.id === "shields" ? "Battle stations (25-min focus)" : a.id === "brief" ? "Mission briefing" : a.id === "sweep" ? "Scan sweep (due within 48h)" : a.id === "night" ? "Toggle night ops / stealth" : a.label, icon: a.icon, hint: `key ${i + 1}`, run: a.run })),
    { id: "tour", label: "Replay onboarding tour", icon: "🧭", run: () => setTour(true) },
    { id: "layout", label: "Reset window layout", icon: "▤", run: resetLayout },
    { id: "help", label: "Keyboard shortcuts", icon: "⌨", hint: "?", run: () => setHelp(true) },
    { id: "logout", label: "Log Out", icon: "⏻", run: logout },
  ];

  return (
    <div className={alert ? "red-alert" : ""}>
      <SpaceBackground dim={night ? 0.85 : 0.5} />
      {idle && <Particles n={night || coarse ? (night ? 0 : 8) : 26} />}
      <div className="alert-overlay pointer-events-none fixed inset-0 z-20" />
      <div className="pointer-events-none fixed inset-0 z-[1]" style={{ boxShadow: `inset 0 0 160px ${DEFCON_COLOR[level as 1]}22` }} />
      <div ref={sparkRoot} className="pointer-events-none fixed inset-0 z-[90]" />
      {warp && <Warp on={warp} />}<Toaster /><OfflineBanner />
      {(handsFree || hf.kind === "error") && <div role="status" aria-live="polite" data-testid="hf-bar" className="fixed inset-x-0 bottom-[190px] z-[49] mx-auto flex w-fit max-w-[94vw] items-center gap-2 rounded-2xl border border-cyan/40 bg-navy/90 px-3 py-1.5 text-sm text-[#E8F4FF]">
        <span aria-hidden>{hf.kind === "error" ? "⚠️" : hf.kind === "speaking" ? "🔊" : hf.kind === "thinking" ? "💭" : "🎙️"}</span>
        <span className="min-w-0"><b>{handsFree ? "Hands-Free On" : "Hands-Free Off"}</b> · {({ off: "Off", starting: "Starting mic…", listening: hf.text ? `Listening: ${hf.text}` : "Listening…", heard: `Heard: “${hf.text}”`, thinking: hf.text === "Transcribing…" ? "Transcribing…" : "Thinking…", speaking: "Speaking…", error: hf.text } as Record<HFState["kind"], string | undefined>)[hf.kind]}{hf.hint && <span className="block text-xs text-[#a9afc0]">{hf.hint}</span>}</span>
        {handsFree ? <button className="btn btn-ghost px-2 py-0.5 text-xs" title="Stop Hands-Free" onClick={() => setHandsFreeOn(false)}>Stop</button> : <button className="btn btn-ghost px-2 py-0.5 text-xs" title="Start Hands-Free" onClick={() => setHandsFreeOn(true)}>Start</button>}
        {!handsFree && <button className="btn btn-ghost px-2 py-0.5 text-xs" title="Dismiss" aria-label="Dismiss" onClick={() => setHf({ kind: "off" })}>✕</button>}</div>}
      {caption && <div role="status" aria-live="polite" className="caption-bar fixed inset-x-0 bottom-[150px] z-[48] mx-auto w-fit max-w-[92vw] rounded-full border border-cyan/40 bg-navy/90 px-4 py-1.5 text-center text-sm text-[#E8F4FF]">{listening && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-alert" aria-hidden />}{caption}</div>}
      {settings && <div role="dialog" aria-label="Settings" className="glass fixed right-3 top-14 z-[50] w-72 rounded-2xl p-4 text-sm">
        <h2 className="mb-2 font-semibold text-[#E8F4FF]">Quick Settings</h2>
        <fieldset><legend className="hud-label mb-1">Glass clarity</legend>
          <div className="grid grid-cols-3 gap-1">{(["clear", "balanced", "solid"] as Clarity[]).map(c => <label key={c} className={`cursor-pointer rounded-md border px-2 py-1 text-center capitalize ${clarity === c ? "border-cyan bg-cyan/15 text-cyan" : "border-slate/50"}`}><input type="radio" name="clarity" className="sr-only" checked={clarity === c} onChange={() => { setClarity(c); savePrefs({ glass: c }); }} />{c}</label>)}</div>
          <input type="range" min={0} max={2} step={1} value={["clear", "balanced", "solid"].indexOf(clarity)} onChange={e => { const c = (["clear", "balanced", "solid"] as Clarity[])[Number(e.target.value)]; setClarity(c); savePrefs({ glass: c }); }} aria-label="Glass clarity slider" className="mt-2 w-full accent-cyan" /></fieldset>
        <label className="mt-3 flex items-center justify-between gap-2">Hands-Free Voice (talk, Crystal answers aloud)<input type="checkbox" checked={handsFree} onChange={e => setHandsFreeOn(e.target.checked)} /></label>
        <p className="mt-1 text-xs text-slate">Say “stop” or tap Stop to end. The mic pauses while Crystal speaks.</p>
        <p className="mt-1 text-xs text-slate">Voice is transcribed live and never recorded or stored.</p>
        {qs && <><div className="hud-label mb-1 mt-3">Background Motion</div>
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Background Motion">{(Object.keys(BG_PRESETS) as (keyof typeof BG_PRESETS)[]).map(k => <button key={k} role="radio" aria-checked={qs.bgSpeed === BG_PRESETS[k]} onClick={() => saveSettings({ bgSpeed: BG_PRESETS[k] })} className={`tap rounded-md border px-1 py-1 text-xs ${qs.bgSpeed === BG_PRESETS[k] ? "border-cyan bg-cyan/15 text-snow" : "border-slate/40 text-ash"}`}>{k}</button>)}</div>
          <div className="hud-label mb-1 mt-3">UI Animations</div>
          <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="UI Animations">{(["off", "reduced", "full"] as const).map(k => <button key={k} role="radio" aria-checked={qs.uiMotion === k} onClick={() => saveSettings({ uiMotion: k })} className={`tap rounded-md border px-1 py-1 text-xs ${qs.uiMotion === k ? "border-cyan bg-cyan/15 text-snow" : "border-slate/40 text-ash"}`}>{k === "off" ? "Off" : k === "reduced" ? "Reduced" : "Full"}</button>)}</div></>}
        <button className="btn btn-primary mt-3 w-full text-sm" onClick={() => { setSettings(false); setCenter("Appearance"); }}>All Settings…</button>
        <button className="btn btn-ghost mt-2 w-full text-xs" onClick={() => setSettings(false)}>Close</button></div>}
      <SettingsCenter open={!!center} initialTab={center ?? "Profile"} onClose={() => setCenter(null)} />
      <header data-safe-top className="glass sticky top-0 z-30 !rounded-none border-x-0 border-t-0">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-3 py-2">
          <button onClick={goHome} className="neon font-bold tracking-[.3em]" aria-label="Crystal Home">◆ CRYSTAL</button>
          <form onSubmit={e => { e.preventDefault(); execCommand(cmd.trim()); }} className="order-3 flex w-full gap-2 sm:order-none sm:w-auto sm:flex-1">
            <input ref={cmdRef} value={cmd} onChange={e => setCmd(e.target.value)} className="input py-1.5 text-sm" placeholder='Command Crystal… "add milk to shopping list" · press / or ⌘K' aria-label="Command bar" maxLength={300} enterKeyHint="go" />
            <MicBtn on={listening} onClick={toggleMic} /><button onClick={() => setHandsFreeOn(!handsFree)} aria-pressed={handsFree} title={handsFree ? "Hands-Free On: Tap To Stop" : "Hands-Free Voice: Tap To Start"} className={`btn btn-ghost px-2 text-xs ${handsFree ? "border-cyan text-cyan" : ""}`}>{handsFree ? "● Hands-Free" : "Hands-Free"}</button>
            <button className="btn btn-primary !py-1.5 text-sm" disabled={cmdBusy}>{cmdBusy ? "…" : "Go"}</button>
          </form>
          <button onClick={() => setPalette(true)} className="btn btn-ghost hidden !px-2 !py-1 text-xs sm:inline-flex" aria-label="Open Command Palette"><kbd>⌘K</kbd></button>
          <span data-testid="user-chip" title={demo ? "Demo mode" : [fullName(profile), user].filter(Boolean).join(" · ")} className="ml-auto hidden max-w-[14rem] truncate text-xs text-ash md:inline">{demo ? "Demo mode" : shortName(profile, user)} · <span className="text-cyan">{RANKS[rankI]}</span></span>
          <button onClick={() => setSettings(s => !s)} aria-expanded={settings} className="btn btn-ghost !px-2 !py-1 text-xs" aria-label="Quick Settings">⚙</button>
          <button onClick={() => setCenter("Profile")} className="tap grid h-8 w-8 place-items-center overflow-hidden rounded-full border border-cyan/40 bg-navy-2 text-sm" aria-label="Profile and Settings">{profile.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : (greetName(profile)[0] ?? "C")}</button>
          <button onClick={closeAll} className="btn btn-ghost !px-2 !py-1 text-xs" aria-label="Close All Applets" title="Close All (Esc · Shift+Esc · Alt+0)">✕ All</button>
          <button onClick={goHome} className="btn btn-ghost !px-2 !py-1 text-xs" aria-label="Home">⌂</button>
          <button onClick={logout} className="btn btn-ghost !px-2 !py-1 text-xs">Log Out</button>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1600px] px-3 pb-[190px] pt-3">
        {demo && <div className="mb-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-xs text-amber-200">Demo mode: sample data stays on this device. <a href="/#launch" className="underline">Sign in</a> to save for real.</div>}
        <div data-safe-top className="mb-3 flex items-center gap-4">
          <div className="relative shrink-0"><div className={listening ? "listen-ring" : ""}><CrystalBot size={76} mood={listening ? "thinking" : mood} say={caption || say} onClick={() => { openApp("crystal"); react("wave"); sfx("chirp"); speakBubble("Hi pilot! Need anything? 💙"); }} label="Open Crystal co-pilot chat" /></div>
            <button onClick={toggleMic} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Talk to Crystal"} className={`absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border text-sm ${listening ? "border-alert bg-alert/30 text-white" : "border-cyan/60 bg-navy/90 text-cyan"}`}>🎙</button></div>
          <div className="min-w-0"><div className="hud-label">Pilot&apos;s assistant · <span style={{ color: DEFCON_COLOR[level as 1] }}>DEFCON {level}</span></div><p className="text-snow">{greetText(profile)} {open.length ? `${open.length} open mission${open.length > 1 ? "s" : ""}.` : "All clear."}</p>
            {dc.reasons.length > 0 && <p className="truncate text-xs text-slate">Threats: {dc.reasons.slice(0, 3).join(" · ")}</p>}</div>
        </div>
        <section data-safe-top data-testid="modules-toolbar" className="relative z-[35] mb-3" aria-label="Modules">
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-8 sm:overflow-visible sm:pb-0">
            {MODULES.map(id => { const q = squad.find(s => s.id === id); return (
              <button key={id} onClick={() => openApp(id)} onMouseEnter={() => sfx("hover")} className={`tap glass relative min-w-[88px] shrink-0 rounded-xl p-2 text-left hover:border-cyan/60 ${q?.status === "warn" ? "!border-alert/60" : ""}`}>
                <div className="text-lg text-cyan">{META[id].icon}</div><div className="truncate text-xs font-semibold text-snow">{META[id].title}</div>
                {q && <div className="truncate text-[9px] text-slate">{q.detail}</div>}
                {q?.status === "warn" && <span className="absolute right-1.5 top-1.5 h-2 w-2 animate-glow rounded-full bg-alert" aria-label="needs attention" />}
              </button>); })}
          </div>
        </section>
        {desk ? (
          <div className="relative" style={{ height: `max(calc(100dvh - 330px), ${Math.max(...visible.map(w => (w.geo?.y ?? 0) + (w.geo?.h ?? 0)), 400) + 20}px)` }}>
            {tiled.map((w, i) => <div key={w.id} className={focusEnd && !ESSENTIAL.includes(w.id) && focus !== w.id ? "focus-dim" : ""}>
              <Applet title={w.title} icon={META[w.id].icon} mode={tileRects[i] ? "tile" : "float"} rect={tileRects[i] ?? null} geo={w.geo} z={w.z} onGeo={g => setGeo(w.id, g)} onDrop={(x, y) => dropTile(w.id, x, y)} focused={focus === w.id} onFocus={() => front(w.id)} onMin={() => minimize(w.id)} onClose={() => close(w.id)} onToggleMax={() => { setWinPref("full"); savePrefs({ win: "full" }); doOpen(w.id); }}>{content(w.id)}</Applet></div>)}
            {!visible.filter(w => !w.max).length && !maxed && <div className="glass flex flex-col items-center rounded-2xl p-6 text-center text-ash"><CrystalBot size={64} mood="wave" label="Crystal" />All applets closed. Press <kbd className="mx-1 rounded border border-slate/50 px-1">H</kbd> or ⌂ Home to restore.</div>}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {visible.filter(w => !w.max).map(w => { const m = modeFor(w.id); return <div key={w.id} className={`${m === "sheet" ? "" : ""} ${focusEnd && !ESSENTIAL.includes(w.id) && focus !== w.id && m !== "sheet" ? "focus-dim" : ""}`}>
              <Applet title={w.title} icon={META[w.id].icon} mode={m} z={w.z} focused={focus === w.id} onFocus={() => setFocus(w.id)} onMin={() => minimize(w.id)} onClose={() => close(w.id)}>{content(w.id)}</Applet></div>; })}
          </div>
        )}
      </main>
      {maxed && <Applet key={`max-${maxed.id}`} title={maxed.title} icon={META[maxed.id].icon} mode="max" rect={winRect} size={desk && winPref === "normal" ? "normal" : "full"} origin={origin.current} z={maxed.z} focused onFocus={() => setFocus(maxed.id)}
        onMin={() => minimize(maxed.id)} onClose={() => close(maxed.id)} onToggleMax={toggleFull} canFloat={desk}>{content(maxed.id)}</Applet>}

      {focusEnd && <ShieldsTimer endsAt={focusEnd} total={25 * 60000} onEnd={shieldsDone} onAbort={() => { setFocusEnd(null); log("Shields down (aborted).", "info"); sfx("close"); }} />}
      <Boundary name="HUD" compact>{!idle ? <nav data-safe-bottom aria-label="HUD loading" className="fixed inset-x-0 bottom-0 z-30 h-16" /> : <HudBar pilot={greetName(profile)} mood={mood} onPilot={() => { openApp("crystal"); react("wave"); sfx("chirp"); }} squad={squad} contacts={contacts} tactical={tactical}
        radar={blips} pulse={pulse} defcon={{ level, reasons: manualAlert ? ["Manual red alert", ...dc.reasons] : dc.reasons }} bars={bars} feedsMuted={!!focusEnd}
        abilities={abilities} feed={feed} onCloseAll={closeAll} hotkey={(id: AppId) => { const i = ORDER.indexOf(id); return i >= 0 ? `Alt+${i + 1}` : ""; }} blips={open.length} alert={alert} onAlert={toggleAlert} onHome={goHome} onLogout={logout} open={dockPref.length ? wins.filter(w => dockPref.includes(w.id)).sort((x, y) => dockPref.indexOf(x.id) - dockPref.indexOf(y.id)) : wins} onRestore={id => openApp(id)} />}</Boundary>
      <Boundary name="Overlays" compact><CommandPalette open={palette} onClose={() => setPalette(false)} actions={actions} onFreeText={t => execCommand(t)} />
      <Tour open={tour} onDone={() => { setTour(false); if (pref("brief-date") !== ymd()) setBrief(true); }} />
      <Briefing open={brief} onClose={() => { setBrief(false); setPref("brief-date", ymd()); }} name={greetName(profile)} objectives={objectives} defcon={level} weather="" />
      <IncomingTransmission tx={tx} onAck={t => { settleTx(t, -1); sfx("success"); openApp(t.app); }} onSnooze={t => { settleTx(t, Date.now() + 3600e3); sfx("close"); toast("Transmission snoozed for 1 hour", "info"); }} /></Boundary>
      {help && <div className="fade-in fixed inset-0 z-[72] flex items-center justify-center bg-navy/70 p-4" onClick={() => setHelp(false)}><div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="win-in glass neon-frame w-full max-w-md rounded-2xl p-5" onClick={e => e.stopPropagation()}>
        <h2 className="mb-3 font-semibold text-snow">Keyboard shortcuts</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">{[["⌘/Ctrl K", "Command Palette"], ["/", "Focus Command Bar"], ["1–9 · Alt+1–9", "Open applet full screen (dock order)"], ["Alt+← / Alt+→", "Previous / next applet"], ["Esc · Shift+Esc · Alt+0", "Close all applets (clean cockpit)"], ["F · double-click title", "Toggle full screen / normal size"], ["Shift+1–9", "Fire ability (respects cooldown)"], ["H", "Home"], ["S", "Scan sweep"], ["Shift+F", "Battle stations focus"], ["B", "Mission briefing"], ["N", "Night ops / stealth"], ["Shift A", "Red Alert"], ["Alt+Shift+Arrows", "Move a normal-size window"], ["Esc", "Close overlays"], ["?", "This help"]].map(([k, v]) => <Fragment key={k}><dt><kbd className="rounded border border-cyan/40 px-1.5 font-mono text-xs text-cyan">{k}</kbd></dt><dd className="text-ice">{v}</dd></Fragment>)}</dl>
        <button autoFocus className="btn btn-primary mt-4 w-full" onClick={() => setHelp(false)}>Close</button></div></div>}
    </div>
  );
}
function MicBtn({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={on} aria-label={on ? "Stop listening" : "Voice command (push to talk)"} className={`btn !px-2.5 !py-1.5 text-sm ${on ? "bg-alert/30 text-white ring-2 ring-alert animate-pulse" : "btn-ghost"}`}>🎙</button>;
}
