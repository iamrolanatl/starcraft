"use client";
// Tiny Web Audio synth for UI sounds. No audio files.
let ctx: AudioContext | null = null;
let muted = typeof window !== "undefined" && localStorage.getItem("crystal-muted") === "1";
export const isMuted = () => muted;
export function setMuted(m: boolean) { muted = m; localStorage.setItem("crystal-muted", m ? "1" : "0"); }
function ac() { if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); return ctx; }
function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.06, slideTo?: number, delay = 0) {
  if (muted) return; const a = ac(); const t = a.currentTime + delay;
  const o = a.createOscillator(); const g = a.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export type Sfx = "click" | "open" | "close" | "success" | "error" | "ping" | "alert" | "chirp";
export function sfx(s: Sfx) {
  try {
    switch (s) {
      case "click": tone(880, 0.06, "square", 0.03); break;
      case "open": tone(440, 0.15, "sine", 0.05, 990); break;
      case "close": tone(700, 0.15, "sine", 0.05, 300); break;
      case "success": tone(660, 0.1, "triangle"); tone(990, 0.15, "triangle", 0.06, undefined, 0.1); break;
      case "error": tone(200, 0.25, "sawtooth", 0.04, 120); break;
      case "ping": tone(1320, 0.4, "sine", 0.04); break;
      case "chirp": tone(1200, 0.08, "sine", 0.05, 1800); tone(1500, 0.08, "sine", 0.05, 2200, 0.09); break;
      case "alert": for (let i = 0; i < 3; i++) tone(520, 0.35, "sawtooth", 0.05, 880, i * 0.45); break;
    }
  } catch {}
}
