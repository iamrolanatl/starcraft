"use client";
// v3 cockpit operations: DEFCON readiness, shields focus timer, mission briefing, incoming transmissions,
// warp jump, ship status bars, medals/ranks, holo globe. All driven by real cockpit data.
import ProgressBar from "@/components/ui/ProgressBar";
import { useEffect, useRef, useState } from "react";
import CrystalBot from "@/components/CrystalBot";
import { sfx, speak, stopSpeech, haptic } from "@/lib/synth";
import type { AppId } from "@/contracts/api";

export interface Threats { overdueTasks: number; billsDueSoon: number; billsOverdue: number; missingWork: number; syncAlerts: number; medsDue: number; unreadTeacher: number }
export function computeDefcon(t: Threats): { level: 1 | 2 | 3 | 4 | 5; score: number; reasons: string[] } {
  const parts: [number, string][] = [[t.overdueTasks * 2, `${t.overdueTasks} overdue task${t.overdueTasks === 1 ? "" : "s"}`], [t.billsOverdue * 3, `${t.billsOverdue} overdue bill${t.billsOverdue === 1 ? "" : "s"}`], [t.billsDueSoon, `${t.billsDueSoon} bill${t.billsDueSoon === 1 ? "" : "s"} due ≤3 days`], [t.missingWork * 2, `${t.missingWork} missing assignment${t.missingWork === 1 ? "" : "s"}`], [t.syncAlerts * 3, `${t.syncAlerts} sync alert${t.syncAlerts === 1 ? "" : "s"}`], [t.medsDue, `${t.medsDue} med dose${t.medsDue === 1 ? "" : "s"} pending`], [t.unreadTeacher, `${t.unreadTeacher} unread teacher msg`]];
  const score = parts.reduce((a, [n]) => a + n, 0); const reasons = parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, r]) => r);
  const level = score >= 14 ? 1 : score >= 9 ? 2 : score >= 5 ? 3 : score >= 2 ? 4 : 5; return { level, score, reasons };
}
export const DEFCON_COLOR = { 5: "#3ef2e0", 4: "#7dffc8", 3: "#ffd166", 2: "#ff9a5c", 1: "#ff3b5c" } as const;

export function DefconMeter({ level, reasons, manual }: { level: number; reasons: string[]; manual: boolean }) {
  const c = DEFCON_COLOR[level as 1]; return (
    <div className="flex h-full w-[70px] shrink-0 flex-col items-center justify-between rounded-md border bg-navy/70 p-1" style={{ borderColor: `${c}88` }} role="meter" aria-valuemin={1} aria-valuemax={5} aria-valuenow={level} aria-label={`DEFCON ${level}${manual ? " (manual red alert)" : ""}: ${reasons.join(", ") || "all clear"}`} title={reasons.join("\n") || "All clear"}>
      <span className="hud-label !text-[8px]">Defcon</span>
      <div className="flex flex-1 flex-col-reverse gap-0.5 py-0.5">{[5, 4, 3, 2, 1].map(l => <span key={l} className={`h-2 w-10 rounded-sm transition-all duration-500 ${l >= level ? "" : "opacity-15"} ${l === level && level <= 2 ? "animate-glow" : ""}`} style={{ background: DEFCON_COLOR[l as 1], boxShadow: l === level ? `0 0 10px ${DEFCON_COLOR[l as 1]}` : undefined }} />)}</div>
      <span className="font-mono text-lg font-bold leading-none" style={{ color: c, textShadow: `0 0 10px ${c}` }}>{level}</span>
    </div>);
}

export function StatusBars({ shields, hull, energy, labels }: { shields: number; hull: number; energy: number; labels: [string, string, string] }) {
  const B = ({ n, v, c, l }: { n: string; v: number; c: string; l: string }) => (<div title={l} className="w-full"><div className="flex justify-between font-mono text-[9px]"><span className="text-slate">{n}</span><span style={{ color: c }}>{Math.round(v)}%</span></div>
    <ProgressBar value={Math.max(2, v)} label={`${n}: ${l}`} color={c} height={6} /></div>);
  return <div className="flex h-full w-[130px] shrink-0 flex-col justify-center gap-1.5 rounded-md border border-cyan/20 bg-navy/60 px-2" aria-label="Ship status">
    <B n="SHIELDS" v={shields} c="#3ef2e0" l={labels[0]} /><B n="HULL" v={hull} c="#7dffc8" l={labels[1]} /><B n="ENERGY" v={energy} c={energy < 25 ? "#ff3b5c" : "#ffd166"} l={labels[2]} /></div>;
}

/* Battle stations / shields focus timer */
export function ShieldsTimer({ endsAt, total, onEnd, onAbort }: { endsAt: number; total: number; onEnd: () => void; onAbort: () => void }) {
  const [now, setNow] = useState(Date.now()); const fired = useRef(false);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(i); }, []);
  const left = Math.max(0, endsAt - now); useEffect(() => { if (!left && !fired.current) { fired.current = true; onEnd(); } }, [left, onEnd]);
  const pct = left / total * 100; const mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
  return (<div data-safe-avoid className="glass neon-frame fixed left-1/2 top-14 z-[46] w-[min(420px,calc(100vw-1rem))] -translate-x-1/2 rounded-2xl px-4 py-2" role="timer" aria-label={`Battle stations: ${mm} minutes ${ss} seconds left`}>
    <div className="flex items-center gap-3"><span className="hud-label !text-cyan">⛨ Battle stations</span><span className="flex-1 text-center font-mono text-2xl text-snow" style={{ textShadow: "0 0 12px #3ef2e0" }}>{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}</span>
      <button onClick={onAbort} className="btn btn-ghost !px-2 !py-1 text-xs">Stand Down</button></div>
    <ProgressBar className="mt-1" value={pct} label="Progress" color="#3ef2e0" height={8} />
    <p className="mt-1 text-center text-[10px] text-slate">Shields up: feeds muted, non-essential applets dimmed.</p></div>);
}

/* Typewriter */
function useType(text: string, on: boolean, speed = 22) { const [n, setN] = useState(0); useEffect(() => { if (!on) return; setN(0); if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return; } const i = setInterval(() => setN(x => { if (x >= text.length) { clearInterval(i); return x; } return x + 1; }), speed); return () => clearInterval(i); }, [text, on, speed]); return text.slice(0, n); }

/* Mission briefing */
export function Briefing({ open, onClose, name, objectives, defcon, weather }: { open: boolean; onClose: () => void; name: string; objectives: string[]; defcon: number; weather: string }) {
  const intro = `${greet()}, ${name}. Readiness is DEFCON ${defcon}. ${weather ? weather + ". " : ""}${objectives.length ? `You have ${objectives.length} objective${objectives.length > 1 ? "s" : ""} today.` : "No objectives. Clear skies."}`;
  const typed = useType(intro, open); const [voice, setVoice] = useState(true);
  useEffect(() => { if (!open) return; sfx("ping"); if (voice) speak(`${intro} ${objectives.slice(0, 4).map((o, i) => `Objective ${i + 1}: ${o}.`).join(" ")}`); return () => stopSpeech(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (<div className="fade-in fixed inset-0 z-[75] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Mission briefing">
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[12vh] bg-black" /><div className="pointer-events-none absolute inset-x-0 bottom-0 h-[12vh] bg-black" />
    <div className="win-in glass neon-frame relative w-full max-w-2xl rounded-2xl p-6 scanlines">
      <div className="hud-label mb-3 flex justify-between"><span>▣ Mission briefing · {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span><span style={{ color: DEFCON_COLOR[defcon as 1] }}>DEFCON {defcon}</span></div>
      <div className="flex gap-4"><CrystalBot size={90} mood="happy" label="Crystal briefing" />
        <p className="min-h-[4.5rem] flex-1 font-mono text-sm leading-relaxed text-snow" aria-live="polite">{typed}<span className="animate-glow text-cyan">▍</span></p></div>
      <ol className="mt-4 space-y-1.5">{objectives.slice(0, 6).map((o, i) => <li key={i} className="fade-in flex gap-2 rounded-lg border border-cyan/15 bg-navy-2/50 px-3 py-1.5 text-sm text-ice" style={{ animationDelay: `${1 + i * .25}s` }}><span className="font-mono text-cyan">{String(i + 1).padStart(2, "0")}</span>{o}</li>)}</ol>
      <div className="mt-5 flex items-center gap-3"><label className="flex items-center gap-1 text-xs text-slate"><input type="checkbox" checked={voice} onChange={e => { setVoice(e.target.checked); if (!e.target.checked) stopSpeech(); }} className="accent-[#3ef2e0]" /> Voice-over</label><span className="flex-1" />
        <button autoFocus onClick={() => { stopSpeech(); sfx("success"); haptic([10, 30, 10]); onClose(); }} className="btn btn-primary">Engage ▸</button></div>
    </div></div>);
}
function greet() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }

/* Incoming transmission */
export interface Transmission { id: string; from: string; title: string; body: string; app: AppId }
export function IncomingTransmission({ tx, onAck, onSnooze }: { tx: Transmission | null; onAck: (t: Transmission) => void; onSnooze: (t: Transmission) => void }) {
  const typed = useType(tx?.body || "", !!tx, 14);
  useEffect(() => { if (tx) { sfx("alert"); haptic([60, 40, 60, 40, 120]); } }, [tx]);
  if (!tx) return null;
  return (<div className="fixed inset-0 z-[78] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="tx-title" aria-describedby="tx-body">
    <div className="tx-static absolute inset-0" aria-hidden />
    <div className="win-in glass relative w-full max-w-lg overflow-hidden rounded-2xl border-alert/60 p-5 tx-glitch" style={{ boxShadow: "0 0 40px rgba(255,59,92,.4)" }}>
      <div className="hud-label mb-2 flex items-center gap-2 !text-alert"><span className="h-2 w-2 animate-glow rounded-full bg-alert" />Incoming transmission · {tx.from}</div>
      <h2 id="tx-title" className="text-xl font-bold text-snow" data-text={tx.title}>{tx.title}</h2>
      <p id="tx-body" className="mt-2 min-h-[3rem] font-mono text-sm text-ice">{typed}</p>
      <div className="mt-4 flex gap-2"><button autoFocus onClick={() => onAck(tx)} className="btn btn-primary flex-1">Acknowledge</button><button onClick={() => onSnooze(tx)} className="btn btn-ghost">Snooze 1h</button></div>
    </div></div>);
}

/* Warp jump overlay (hyperspace streaks) */
export function Warp({ on }: { on: boolean }) {
  if (!on) return null;
  return <div aria-hidden className="warp pointer-events-none fixed inset-0 z-[65]">{Array.from({ length: 60 }, (_, i) => <span key={i} style={{ transform: `rotate(${(i * 137.5) % 360}deg)`, animationDelay: `${(i % 10) * 12}ms` }} />)}</div>;
}

/* Ranks & medals */
export const RANKS = ["Cadet", "Ensign", "Lieutenant", "Lt. Commander", "Commander", "Captain", "Commodore", "Admiral"];
export interface Medal { id: string; icon: string; name: string; desc: string; earned: boolean }
export function MedalsPanel({ xp, rank, next, medals }: { xp: number; rank: string; next: number | null; medals: Medal[] }) {
  return (<div>
    <div className="mb-3 flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-cyan text-2xl neon-border" aria-hidden>✦</div>
      <div className="flex-1"><div className="hud-label">Rank</div><div className="text-lg font-semibold text-snow">{rank}</div>
        <ProgressBar className="mt-1" value={next ? Math.min(100, xp / next * 100) : 100} label="XP to next rank" color="#7dffc8" height={6} />
        <div className="text-[10px] text-slate">{xp} XP{next ? ` · ${next - xp} to promotion` : " · max rank"}</div></div></div>
    <ul className="grid grid-cols-3 gap-2">{medals.map(m => <li key={m.id} title={m.desc} className={`tap rounded-xl border p-2 text-center ${m.earned ? "border-mint/50 bg-mint/10" : "border-slate/30 opacity-45 grayscale"}`}><div className="text-2xl" aria-hidden>{m.icon}</div><div className="text-[10px] text-snow">{m.name}</div><div className="sr-only">{m.earned ? "earned" : "locked"}: {m.desc}</div></li>)}</ul>
  </div>);
}

/* Holographic module globe */
export function HoloGlobe({ nodes, onOpen }: { nodes: { id: AppId; icon: string; label: string; count: number; hot: boolean }[]; onOpen: (id: AppId) => void }) {
  const [rot, setRot] = useState(0); const reduce = useRef(false);
  useEffect(() => { reduce.current = matchMedia("(prefers-reduced-motion: reduce)").matches; if (reduce.current) return; let r = 0, raf = 0; const f = () => { r += .12; setRot(r); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, []);
  return (<div className="relative mx-auto aspect-square w-full max-w-[300px]" aria-label="Module globe">
    <svg viewBox="-110 -110 220 220" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs><radialGradient id="hg" cx="35%" cy="30%"><stop offset="0" stopColor="#3ef2e0" stopOpacity=".35" /><stop offset="1" stopColor="#060b1a" stopOpacity=".1" /></radialGradient></defs>
      <circle r="78" fill="url(#hg)" stroke="#3ef2e0" strokeOpacity=".5" />
      {[-60, -30, 0, 30, 60].map(l => <ellipse key={l} rx={78 * Math.cos(l * Math.PI / 180)} ry={78 * Math.cos(l * Math.PI / 180) * .22} cy={78 * Math.sin(l * Math.PI / 180)} fill="none" stroke="#3ef2e0" strokeOpacity=".18" />)}
      {[0, 30, 60, 90, 120, 150].map(m => <ellipse key={m} rx={Math.abs(78 * Math.cos((m + rot) * Math.PI / 180))} ry="78" fill="none" stroke="#7dffc8" strokeOpacity=".15" />)}
      <ellipse rx="100" ry="22" fill="none" stroke="#c77dff" strokeOpacity=".35" strokeDasharray="2 4" transform="rotate(-15)" />
    </svg>
    {nodes.map((n, i) => { const a = (i / nodes.length) * Math.PI * 2 + rot * Math.PI / 180, lat = ((i % 3) - 1) * .45; const x = Math.cos(a) * Math.cos(lat) * 39, z = Math.sin(a), y = Math.sin(lat) * 34; const front = z > -0.2;
      return <button key={n.id} onClick={() => onOpen(n.id)} onMouseEnter={() => sfx("hover")} aria-label={`${n.label}: ${n.count}${n.hot ? ", needs attention" : ""}`}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-full transition-opacity ${front ? "z-10" : "z-0"}`} style={{ left: `${50 + x}%`, top: `${50 + y}%`, opacity: .35 + (z + 1) * .33, transform: `translate(-50%,-50%) scale(${.75 + (z + 1) * .2})` }}>
        <span className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg backdrop-blur ${n.hot ? "border-alert bg-alert/20 shadow-[0_0_14px_#ff3b5c]" : "border-cyan/60 bg-navy/60 shadow-[0_0_10px_rgba(62,242,224,.5)]"}`}>{n.icon}</span>
        <span className="mt-0.5 whitespace-nowrap rounded bg-navy/70 px-1 text-[9px] text-ice">{n.label} · {n.count}</span></button>; })}
  </div>);
}
