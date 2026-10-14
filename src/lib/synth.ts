"use client";
// Tiny Web Audio synth for UI sounds. No audio files.
let ctx: AudioContext | null = null;
let muted = (() => { try { return typeof window !== "undefined" && localStorage.getItem("crystal-muted") === "1"; } catch { return false; } })();
export const isMuted = () => muted;
export function setMuted(m: boolean) { muted = m; try { localStorage.setItem("crystal-muted", m ? "1" : "0"); } catch {} if (m) { ambient(null); stopSpeech(); } }
function ac() {
  if (!ctx) { ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    // suspend the audio graph while the tab is hidden (battery + no runaway oscillators)
    document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => {}); else if (amb) ctx.resume().catch(() => {}); }); }
  return ctx;
}
function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.06, slideTo?: number, delay = 0) {
  if (muted) return; const a = ac(); const t = a.currentTime + delay;
  const o = a.createOscillator(); const g = a.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export type Sfx = "click" | "open" | "close" | "success" | "error" | "ping" | "alert" | "chirp" | "hover" | "whoosh" | "palette";
let lastHover = 0;
export function sfx(s: Sfx) {
  try {
    switch (s) {
      case "click": tone(880, 0.06, "square", 0.03); break;
      case "hover": { const n = performance.now(); if (n - lastHover < 70) break; lastHover = n; tone(2400, 0.025, "sine", 0.012); break; }
      case "whoosh": tone(300, 0.22, "sine", 0.04, 90); tone(1800, 0.12, "triangle", 0.015, 600); break;
      case "palette": tone(520, 0.08, "triangle", 0.04, 780); tone(1040, 0.12, "sine", 0.03, undefined, 0.06); break;
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

// Ambient bridge hum that tracks DEFCON (5 calm → 1 tense). Starts only after a user gesture.
let amb: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; lfo: OscillatorNode } | null = null;
export function ambient(level: number | null) {
  try {
    if (level == null || muted) { if (amb) { amb.g.gain.setTargetAtTime(0, ac().currentTime, .3); const a = amb; amb = null; setTimeout(() => { a.o1.stop(); a.o2.stop(); a.lfo.stop(); }, 1200); } return; }
    const a = ac(); if (a.state === "suspended") a.resume();
    if (!amb) { const g = a.createGain(); g.gain.value = 0; const o1 = a.createOscillator(), o2 = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain();
      o1.type = "sine"; o2.type = "triangle"; lfo.frequency.value = .2; lg.gain.value = .006; lfo.connect(lg).connect(g.gain); o1.connect(g); o2.connect(g); g.connect(a.destination); o1.start(); o2.start(); lfo.start(); amb = { o1, o2, g, lfo }; }
    const tense = (5 - level) / 4; const t = a.currentTime;
    amb.o1.frequency.setTargetAtTime(55 + tense * 30, t, .8); amb.o2.frequency.setTargetAtTime(110.5 + tense * 72 + (level === 1 ? 3 : 0), t, .8);
    amb.lfo.frequency.setTargetAtTime(.2 + tense * 2.6, t, .5); amb.g.gain.setTargetAtTime(.012 + tense * .018, t, .8);
  } catch {}
}
export function haptic(p: number | number[] = 12) { try { const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation; if (ua && !ua.hasBeenActive) return; if (!matchMedia("(prefers-reduced-motion: reduce)").matches) navigator.vibrate?.(p); } catch {} }
export function speak(text: string, onEnd?: () => void) {
  try { const s = window.speechSynthesis; if (!s || muted) { onEnd?.(); return; } s.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.04; u.pitch = 1.35;
    const v = s.getVoices().find(v => /samantha|zira|female|google us english|aria|jenny/i.test(v.name)); if (v) u.voice = v; u.onend = () => onEnd?.(); u.onerror = () => onEnd?.(); s.speak(u); } catch { onEnd?.(); }
}
export const stopSpeech = () => { try { window.speechSynthesis?.cancel(); } catch {} };
/** iOS only plays speech queued from a user gesture until the engine has spoken once: call from a tap. */
export function unlockSpeech() { try { const s = window.speechSynthesis; if (!s) return; s.getVoices(); const u = new SpeechSynthesisUtterance(" "); u.volume = 0; s.speak(u); s.resume(); } catch {} }
/** Resolves once nothing is speaking or queued (with a short grace for speech that is about to start). */
export async function speechDone(maxMs = 60000) { const s = typeof window !== "undefined" ? window.speechSynthesis : undefined; if (!s) return; const t0 = Date.now();
  await new Promise(r => setTimeout(r, 350)); while ((s.speaking || s.pending) && Date.now() - t0 < maxMs) await new Promise(r => setTimeout(r, 200)); }
