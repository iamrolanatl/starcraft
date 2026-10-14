"use client";
// Crystal strolls along the top edge of the bottom HUD, strikes poses and teases now and then.
// Cheap: one transform transition per walk + CSS keyframe poses; timers stop while the tab is hidden.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CrystalBot, { type Mood } from "./CrystalBot";
import { getSettings, resolvedMotion } from "@/lib/settings";

export const POSES = ["wave", "dance", "flex", "sit", "peek", "stretch", "fall", "spin"] as const;
export type Pose = (typeof POSES)[number] | "walk" | "idle";
const MOOD: Record<string, Mood> = { wave: "wave", dance: "happy", flex: "happy", sit: "idle", peek: "thinking", stretch: "idle", fall: "alert", spin: "happy", walk: "idle", idle: "idle" };
const POSE_MS: Record<string, number> = { wave: 2000, dance: 2600, flex: 2200, sit: 3500, peek: 2600, stretch: 2400, fall: 2600, spin: 1400 };
export const TAUNTS = [
  "Still here? Go check those grades! 📚", "Bet you can't beat my high score… in napping. 😴", "I've been walking for hours. My battery says hi. 🔋",
  "Psst… homework doesn't do itself. I checked. 🤖", "Look at these muscles! Okay, they're bolts. 💪", "Is it snack o'clock yet? 🍪",
  "Boop me. I dare you. 👆", "I'm not lazy, I'm in power-saving mode. ⚡", "Beep boop! That means 'you're awesome' in robot.",
  "Race you to 90%! I'll wait… very patiently. 🏁", "Did you drink water today? Robots can't, so do it for me. 💧",
  "I tripped on purpose. It's called style. 😎", "Nice clicking skills, pilot!", "Knock knock. …Who's there? A robot with no jokes. 🤷",
  "Don't tell anyone, but I dance when you're not looking. 🕺", "One more assignment and you unlock: bragging rights. 🏆",
];
const FALL_TAUNTS = ["I meant to do that. 🙃", "Ow! Who put a toolbar here?", "Ta-da! Totally on purpose."];
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

export default function RobotWalker() {
  const [mode, setMode] = useState<"lively" | "calm" | "off">("off");
  const [x, setX] = useState(40); const [walkMs, setWalkMs] = useState(0); const [face, setFace] = useState<1 | -1>(1);
  const [pose, setPose] = useState<Pose>("idle"); const [say, setSay] = useState<string | undefined>();
  const [small, setSmall] = useState(false); const [navH, setNavH] = useState(64); const [vw, setVw] = useState(1200);
  const t = useRef<number[]>([]); const lastSay = useRef(Date.now()); const xRef = useRef(40); const busy = useRef(false);
  const later = (fn: () => void, ms: number) => { t.current.push(window.setTimeout(fn, ms)); };
  const clear = () => { t.current.forEach(clearTimeout); t.current = []; busy.current = false; };

  useEffect(() => {
    const read = () => { const s = getSettings(); const os = matchMedia("(prefers-reduced-motion: reduce)").matches; setMode(s.robot === "off" ? "off" : s.robot === "calm" || os || resolvedMotion(s) === "off" ? "calm" : "lively"); };
    const sz = () => { setSmall(innerWidth < 640); setVw(innerWidth); };
    // Sit on the HUD's top edge: track its height (it grows when the dock / radar expands).
    let ro: ResizeObserver | undefined; const hook = () => { const n = document.querySelector('nav[aria-label="Cockpit HUD"]'); if (!n) return false; ro = new ResizeObserver(() => setNavH(n.getBoundingClientRect().height)); ro.observe(n); return true; };
    const iv = window.setInterval(() => { if (hook()) clearInterval(iv); }, 500); hook() && clearInterval(iv);
    read(); sz(); addEventListener("crystal-settings", read); addEventListener("resize", sz);
    return () => { clearInterval(iv); ro?.disconnect(); removeEventListener("crystal-settings", read); removeEventListener("resize", sz); };
  }, []);

  const speak = useCallback((txt?: string) => { setSay(txt ?? pick(TAUNTS)); lastSay.current = Date.now(); later(() => setSay(undefined), 5000); }, []);
  const doPose = useCallback((p: (typeof POSES)[number], then?: () => void) => {
    busy.current = true; setPose(p); if (p === "fall") later(() => speak(pick(FALL_TAUNTS)), 900);
    later(() => { setPose("idle"); busy.current = false; then?.(); }, POSE_MS[p]);
  }, [speak]);

  const step = useCallback(() => {
    if (document.hidden) return; const lively = mode === "lively";
    const due = Date.now() - lastSay.current > 45000 + Math.random() * 45000;
    if (due) speak();
    if (lively && Math.random() < .55) {
      const max = Math.max(60, innerWidth - (small ? 70 : 110)); const nx = Math.round(20 + Math.random() * (max - 20));
      const ms = Math.min(9000, Math.abs(nx - xRef.current) * (small ? 22 : 16)); setFace(nx >= xRef.current ? 1 : -1); setWalkMs(ms); setX(nx); xRef.current = nx; setPose("walk");
      later(() => { setPose("idle"); later(step, 1500 + Math.random() * 2500); }, ms + 50);
    } else {
      const p = lively ? pick(POSES) : pick(["wave", "stretch", "sit"] as const);
      doPose(p, () => later(step, lively ? 3000 + Math.random() * 5000 : 25000 + Math.random() * 20000));
    }
  }, [mode, small, speak, doPose]);

  useEffect(() => {
    clear(); setPose("idle"); setSay(undefined); if (mode === "off") return;
    lastSay.current = Date.now() - 30000; // first tease ~15-60s after load
    later(step, 4000);
    const vis = () => { clear(); setPose("idle"); if (!document.hidden) later(step, 2000); };
    document.addEventListener("visibilitychange", vis);
    return () => { document.removeEventListener("visibilitychange", vis); clear(); };
  }, [mode, step]);

  if (mode === "off") return null;
  const size = small ? 40 : 58;
  const poke = () => { if (busy.current) return; clear(); speak(); doPose(pick(POSES), () => later(step, 4000)); };
  const bw = Math.min(220, vw - 16), bl = Math.max(8, Math.min(vw - bw - 8, x + size / 2 - bw / 2));
  return createPortal(
    <div className="robot-lane pointer-events-none fixed inset-x-0 z-[46]" style={{ bottom: navH, height: size * 1.15 }} data-testid="robot-walker">
      {say && <span key={say} role="status" className="robot-bubble glass absolute rounded-xl px-2.5 py-1.5 text-xs text-snow" style={{ left: bl, bottom: "100%", width: "max-content", maxWidth: bw, marginBottom: 4 }}>{say}</span>}
      <div className="robot-mover absolute bottom-0 left-0" style={{ transform: `translateX(${x}px)`, transition: `transform ${walkMs}ms linear`, ["--walk-ms" as string]: `${walkMs}ms`, willChange: "transform" }}>
        <div className={`robot-pose robot-${pose}`} style={{ ["--face" as string]: face }}>
          <div className={pose === "idle" || pose === "walk" ? "pointer-events-auto" : "pointer-events-none"}><CrystalBot size={size} mood={MOOD[pose]} onClick={poke} label="Crystal the robot: tap for a joke" /></div>
        </div>
      </div>
    </div>, document.body);
}
