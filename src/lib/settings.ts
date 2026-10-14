"use client";
// Settings center model. Stored under user_prefs.prefs.s (RLS), cached locally, applied live via <html data-*> + CSS vars.
import { getPrefs, savePrefs } from "./prefs";
export interface Settings {
  theme: "cockpit" | "blockcraft" | "brickcity" | "battleisland" | "kartrush"; accent: string; textSize: "S" | "M" | "L" | "XL"; highContrast: boolean; reading: boolean;
  video: "on" | "off" | "rotate"; glassOpacity: number; uiMotion: "off" | "reduced" | "full" | "system"; bgSpeed: number; dv?: number;
  defaultApplet: string; openMode: "maximize" | "tile"; dock: string[];
  voice: boolean; voiceName: string; voiceRate: number; autoSpeak: boolean; wakeOnMic: boolean; escalate: boolean;
  alerts: { gradeBelow: boolean; gradeThreshold: number; missing: boolean; absences: boolean; teacherEmail: boolean; lowSteps: boolean };
  quietStart: string; quietEnd: string; defconSensitivity: "low" | "normal" | "high";
  gradeGoal: number; gradeGoals: Record<string, number>; quarterView: "final" | "live"; showUngraded: boolean;
  autoDraft: boolean; signature: string; sendDelay: number;
  stepGoal: number; units: "imperial" | "metric";
  weekStart: "sun" | "mon"; calSources: { tasks: boolean; school: boolean; district: boolean; google: boolean }; timezone: string;
}
export const DEFAULTS: Settings = {
  theme: "cockpit", accent: "#3ef2e0", textSize: "M", highContrast: false, reading: false, video: "on", glassOpacity: 84, uiMotion: "reduced", bgSpeed: 0.5, dv: 2, /* Rolan defaults (Oct 14): Calm background, Reduced UI motion */
  defaultApplet: "home", openMode: "maximize", dock: [],
  voice: true, voiceName: "", voiceRate: 1, autoSpeak: false, wakeOnMic: false, escalate: true,
  alerts: { gradeBelow: true, gradeThreshold: 90, missing: true, absences: true, teacherEmail: true, lowSteps: false },
  quietStart: "22:00", quietEnd: "07:00", defconSensitivity: "normal",
  gradeGoal: 90, gradeGoals: {}, quarterView: "final", showUngraded: true,
  autoDraft: false, signature: "", sendDelay: 30,
  stepGoal: 8000, units: "imperial",
  weekStart: "sun", calSources: { tasks: true, school: true, district: true, google: true }, timezone: "America/New_York",
};
/** Defaults v2: values still equal to the old v1 defaults (bgSpeed 1, uiMotion "system") were never explicitly changed → adopt the new defaults. */
export function upgradeDefaults(s: Partial<Settings>): Partial<Settings> { if (s.dv === 2) return s; const o = { ...s }; if (o.bgSpeed === 1) delete o.bgSpeed; if (o.uiMotion === "system") delete o.uiMotion; o.dv = 2; return o; }
export function getSettings(): Settings { const s = upgradeDefaults((getPrefs() as { s?: Partial<Settings> }).s ?? {}); return { ...DEFAULTS, ...s, alerts: { ...DEFAULTS.alerts, ...(s.alerts ?? {}) }, calSources: { ...DEFAULTS.calSources, ...(s.calSources ?? {}) } }; }
export function applySettings(s = getSettings()) {
  if (typeof document === "undefined") return; const h = document.documentElement, d = h.dataset;
  d.textsize = s.textSize; d.contrast = s.highContrast ? "high" : ""; d.reading = s.reading ? "on" : ""; d.video = s.video; d.skin = s.theme; d.bgpaused = s.bgSpeed === 0 ? "1" : "";
  d.motion = resolvedMotion(s); h.style.setProperty("--bg-speed", String(s.bgSpeed)); applyVideo(s.bgSpeed);
  h.style.setProperty("--accent", s.accent); if (s.glassOpacity !== DEFAULTS.glassOpacity) h.style.setProperty("--glass-a", String(Math.min(98, Math.max(60, s.glassOpacity)) / 100)); else h.style.removeProperty("--glass-a");
}
export function saveSettings(p: Partial<Settings>) { const s = { ...getSettings(), ...p }; savePrefs({ s } as never); applySettings(s); window.dispatchEvent(new Event("crystal-settings")); return s; }
export function resetSettings() { savePrefs({ s: {} } as never); applySettings(DEFAULTS); window.dispatchEvent(new Event("crystal-settings")); }
/** Is `now` inside quiet hours (handles ranges over midnight)? */
export function inQuiet(s: Pick<Settings, "quietStart" | "quietEnd">, now = new Date()) { const m = now.getHours() * 60 + now.getMinutes(), p = (t: string) => { const [a, b] = t.split(":").map(Number); return a * 60 + b; }; const a = p(s.quietStart), b = p(s.quietEnd); return a <= b ? m >= a && m < b : m >= a || m < b; }

export const BG_PRESETS = { Still: 0, Calm: 0.5, Normal: 1, Lively: 1.5 } as const;
export function resolvedMotion(s: Pick<Settings, "uiMotion">): "off" | "reduced" | "full" { return s.uiMotion !== "system" ? s.uiMotion : typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full"; }
/** Background video speed: 0 = paused on the poster frame, else playbackRate 0.25–1.5. Applies to current and future <video>s. */
let watching = false;
export function applyVideo(rate: number) {
  if (typeof document === "undefined") return; const r = Math.max(0, Math.min(1.5, rate));
  const set = (v: HTMLVideoElement) => { try { if (r === 0) { v.pause(); v.currentTime = 0; } else { v.playbackRate = Math.max(.25, r); if (v.paused && v.autoplay) v.play().catch(() => {}); } } catch { /* not ready */ } };
  document.querySelectorAll<HTMLVideoElement>("video.bg-video").forEach(set);
  if (!watching) { watching = true; document.addEventListener("loadeddata", e => { const v = e.target as HTMLVideoElement; if (v?.classList?.contains("bg-video")) set2(v); }, true); document.addEventListener("play", e => { const v = e.target as HTMLVideoElement; if (v?.classList?.contains("bg-video") && getSettings().bgSpeed === 0 && !document.documentElement.dataset.calm) v.pause(); }, true); }
  function set2(v: HTMLVideoElement) { const k = document.documentElement.dataset.calm ? 0.5 : getSettings().bgSpeed; if (k === 0) { v.pause(); } else v.playbackRate = Math.max(.25, Math.min(1.5, k)); }
}
