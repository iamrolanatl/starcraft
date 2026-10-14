"use client";
import { useEffect, useState } from "react";
import CrystalBot from "@/components/CrystalBot";
import { sfx } from "@/lib/synth";

/* ── Toasts (event bus, no context needed) ── */
export type ToastTone = "ok" | "warn" | "info";
type T = { id: number; text: string; tone: ToastTone };
const bus = new EventTarget();
export function toast(text: string, tone: ToastTone = "ok") { bus.dispatchEvent(new CustomEvent("t", { detail: { id: Date.now() + Math.random(), text, tone } })); }
export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => { const h = (e: Event) => { const t = (e as CustomEvent<T>).detail; setItems(i => [...i.slice(-3), t]); setTimeout(() => setItems(i => i.filter(x => x.id !== t.id)), 4500); }; bus.addEventListener("t", h); return () => bus.removeEventListener("t", h); }, []);
  return (<div className="pointer-events-none fixed right-3 top-16 z-[60] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2" role="status" aria-live="polite">
    {items.map(t => <div key={t.id} className={`toast-in glass neon-frame pointer-events-auto flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${t.tone === "warn" ? "text-alert" : t.tone === "ok" ? "text-mint" : "text-ice"}`}>
      <span aria-hidden>{t.tone === "warn" ? "⚠" : t.tone === "ok" ? "✦" : "ℹ"}</span><span className="flex-1 text-snow">{t.text}</span>
      <button className="text-slate hover:text-snow" aria-label="Dismiss" onClick={() => setItems(i => i.filter(x => x.id !== t.id))}>✕</button></div>)}
  </div>);
}

/* ── Skeletons & empty states ── */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-2" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skel h-7" style={{ width: `${92 - i * 9}%` }} />)}</div>;
}
export function Empty({ title, hint, mood = "wave" }: { title: string; hint?: string; mood?: "wave" | "idle" | "happy" }) {
  return <div className="flex flex-col items-center py-3 text-center"><CrystalBot size={56} mood={mood} label="Crystal" /><p className="mt-1 text-sm text-snow">{title}</p>{hint && <p className="text-xs text-slate">{hint}</p>}</div>;
}
export function ErrorNote({ err }: { err: { message: string; kind?: string } | null }) {
  if (!err) return null;
  return <div role="alert" className="mb-2 rounded-lg border border-alert/50 bg-alert/10 px-3 py-2 text-xs text-snow">
    {err.message} {err.kind === "signin" && <a href="/#launch" className="ml-1 font-semibold text-cyan underline">Sign in</a>}
  </div>;
}

/* ── Data viz ── */
export function Gauge({ value, max, min = 0, label, unit = "", bands }: { value: number; max: number; min?: number; label: string; unit?: string; bands?: [number, string][] }) {
  const p = Math.max(0, Math.min(1, (value - min) / (max - min))); const R = 34, C = Math.PI * R;
  const col = bands ? (bands.find(([lim]) => value <= lim)?.[1] ?? bands.at(-1)![1]) : "#3ef2e0";
  return (<div className="flex flex-col items-center" role="meter" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
    <svg viewBox="0 0 80 46" className="w-28"><path d="M6 42 A34 34 0 0 1 74 42" fill="none" stroke="rgba(100,116,139,.3)" strokeWidth="6" strokeLinecap="round" />
      <path d="M6 42 A34 34 0 0 1 74 42" fill="none" stroke={col} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} style={{ filter: `drop-shadow(0 0 4px ${col})`, transition: "stroke-dasharray .8s cubic-bezier(.2,.9,.3,1)" }} />
      <text x="40" y="38" textAnchor="middle" fontSize="13" fill="#f4f8ff" fontWeight="600">{value.toLocaleString()}</text></svg>
    <span className="-mt-1 text-[10px] uppercase tracking-wider text-slate">{label}{unit && ` · ${unit}`}</span></div>);
}
export function Sparkline({ vals, color = "#3ef2e0", fill = true, h = 34 }: { vals: number[]; color?: string; fill?: boolean; h?: number }) {
  if (vals.length < 2) return null; const mx = Math.max(...vals), mn = Math.min(...vals), r = mx - mn || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 100, 28 - ((v - mn) / r) * 24]);
  const line = pts.map(p => p.join(",")).join(" "); const id = `g${Math.abs(vals.reduce((a, b) => a * 31 + b, 7)) % 1e6}`;
  return <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    {fill && <polygon points={`0,30 ${line} 100,30`} fill={`url(#${id})`} />}
    <polyline points={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r="1.8" fill={color} /></svg>;
}

/* ── Ambient particles (parallax depth layer) ── */
export function Particles({ n = 28 }: { n?: number }) {
  const [ps, setPs] = useState<{ l: number; d: number; delay: number; px: number; s: number }[]>([]);
  useEffect(() => { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; setPs(Array.from({ length: n }, () => ({ l: Math.random() * 100, d: 14 + Math.random() * 22, delay: -Math.random() * 30, px: (Math.random() - .5) * 120, s: Math.random() < .2 ? 3 : 2 }))); }, [n]);
  return <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">{ps.map((p, i) => <span key={i} className="particle" style={{ left: `${p.l}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s`, ["--px" as string]: `${p.px}px` }} />)}</div>;
}

/* hover-sound helper for any element */
export const hoverSfx = { onMouseEnter: () => sfx("hover") };
