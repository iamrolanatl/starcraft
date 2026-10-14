"use client";
// Window manager applet: draggable + resizable floating window on desktop, inline card in grid, bottom sheet on mobile.
import { useEffect, useRef, useState } from "react";
import { sfx } from "@/lib/synth";
import { Boundary } from "@/components/ui/Guard";
export type WinMode = "float" | "grid" | "sheet" | "max" | "tile";
export interface Geo { x: number; y: number; w: number; h: number }
type P = { title: string; icon: string; onMin: () => void; onClose: () => void; children: React.ReactNode; focused: boolean; onFocus: () => void; mode?: WinMode; geo?: Geo; z?: number; onGeo?: (g: Geo) => void; rect?: Geo | null; origin?: { x: number; y: number }; onToggleMax?: () => void; canFloat?: boolean; size?: "full" | "normal"; onDrop?: (x: number, y: number) => void; bounds?: Geo | null; persistKey?: string };
const MINW = 320, MINH = 200;
const topLimit = () => 0;
// [dir, position classes, cursor] — edges 8px, corners 16px (bigger hit area for touch)
const HANDLES: [string, string, string][] = [
  ["n", "left-4 right-4 top-0 h-2", "ns-resize"], ["s", "left-4 right-4 bottom-0 h-2", "ns-resize"], ["e", "top-4 bottom-4 right-0 w-2", "ew-resize"], ["w", "top-4 bottom-4 left-0 w-2", "ew-resize"],
  ["nw", "left-0 top-0 h-4 w-4", "nwse-resize"], ["se", "right-0 bottom-0 h-4 w-4", "nwse-resize"], ["ne", "right-0 top-0 h-4 w-4", "nesw-resize"], ["sw", "left-0 bottom-0 h-4 w-4", "nesw-resize"],
];
export default function Applet({ title, icon, onMin, onClose, children, focused, onFocus, mode = "grid", geo, z = 1, onGeo, rect, origin, onToggleMax, canFloat, size, onDrop, bounds, persistKey }: P) {
  // Resize from any edge/corner. Float → onGeo; tile/max → per-applet override (persisted), clamped to the safe area below the header.
  const okey = persistKey ? `crystal-win-${persistKey}-${mode}` : "";
  const [ov, setOv] = useState<{ base: string; r: Geo } | null>(() => { if (!okey || typeof window === "undefined") return null; try { return JSON.parse(localStorage.getItem(okey) || "null"); } catch { return null; } });
  const baseSig = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : "";
  const clampR = (r: Geo): Geo => { const b = bounds ?? rect; if (!b) return r; const w = Math.min(b.w, Math.max(MINW, r.w)), h = Math.min(b.h, Math.max(MINH, r.h)); return { w, h, x: Math.min(b.x + b.w - w, Math.max(b.x, r.x)), y: Math.min(b.y + b.h - h, Math.max(b.y, r.y)) }; };
  const ovValid = ov && rect && (mode === "max" || ov.base === baseSig) ? clampR(ov.r) : null;
  const eff = ovValid ?? rect;
  const [anim, setAnim] = useState<"in" | "min" | "close">("in"); const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLElement>(null); const g = useRef(geo);
  useEffect(() => { g.current = geo; }, [geo]);
  const cleanup = useRef<(() => void) | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { cleanup.current?.(); clearTimeout(timer.current); }, []); // drop window listeners/timers if unmounted mid-drag
  const leave = (k: "min" | "close") => { setAnim(k); sfx(k === "min" ? "whoosh" : "close"); const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; clearTimeout(timer.current); timer.current = setTimeout(k === "min" ? onMin : onClose, reduce ? 0 : k === "min" ? 300 : 240); };
  const startResize = (e: React.PointerEvent, dir: string) => {
    const cur = mode === "float" ? g.current : eff; if (!cur || e.button > 0) return;
    e.preventDefault(); e.stopPropagation(); onFocus(); setDrag(true); const s = { ...cur }, px = e.clientX, py = e.clientY; let n = s;
    const fb = mode === "float" ? null : bounds ?? rect;
    const mv = (ev: PointerEvent) => { const dx = ev.clientX - px, dy = ev.clientY - py; let { x, y, w, h } = s;
      if (dir.includes("e")) w = s.w + dx; if (dir.includes("s")) h = s.h + dy;
      if (dir.includes("w")) { w = s.w - dx; if (w < MINW) w = MINW; x = s.x + s.w - w; } if (dir.includes("n")) { h = s.h - dy; if (h < MINH) h = MINH; y = s.y + s.h - h; }
      w = Math.max(MINW, w); h = Math.max(MINH, h);
      if (fb) { if (x < fb.x) { w -= fb.x - x; x = fb.x; } if (y < fb.y) { h -= fb.y - y; y = fb.y; } w = Math.min(w, fb.x + fb.w - x); h = Math.min(h, fb.y + fb.h - y); }
      else { const top = topLimit(); if (y < 0) { h += y; y = 0; } void top; w = Math.min(w, innerWidth - x - 8); }
      n = { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(MINW, w)), h: Math.round(Math.max(MINH, h)) };
      if (mode === "float") g.current = n; if (ref.current) Object.assign(ref.current.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px`, transition: "none" }); };
    const off = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); cleanup.current = null; };
    const up = () => { off(); setDrag(false); if (mode === "float") { if (g.current) onGeo?.(g.current); } else { const v = { base: baseSig, r: n }; setOv(v); if (okey) try { localStorage.setItem(okey, JSON.stringify(v)); } catch {} } };
    cleanup.current?.(); cleanup.current = off; addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };
  const startDrag = (e: React.PointerEvent, kind: "move" | "size") => {
    if (mode === "tile" && kind === "move" && onDrop && !(e.target as HTMLElement).closest("button")) { // drag a tile → swap with the tile under the pointer
      e.preventDefault(); onFocus(); setDrag(true); const px = e.clientX, py = e.clientY, el = ref.current;
      const mv = (ev: PointerEvent) => { if (el) el.style.transform = `translate(${ev.clientX - px}px, ${ev.clientY - py}px)`; };
      const off = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); cleanup.current = null; if (el) el.style.transform = ""; };
      const up = (ev: PointerEvent) => { off(); setDrag(false); if (Math.hypot(ev.clientX - px, ev.clientY - py) > 12) onDrop(ev.clientX, ev.clientY); };
      cleanup.current?.(); cleanup.current = off; addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up); return;
    }
    if (mode !== "float" || !g.current || (e.target as HTMLElement).closest("button") && kind === "move") return;
    e.preventDefault(); onFocus(); setDrag(true); const s = { ...g.current }, px = e.clientX, py = e.clientY;
    const mv = (ev: PointerEvent) => { const dx = ev.clientX - px, dy = ev.clientY - py; const n = kind === "move" ? { ...s, x: Math.max(0, Math.min(innerWidth - 120, s.x + dx)), y: Math.max(0, s.y + dy) } : { ...s, w: Math.max(260, s.w + dx), h: Math.max(180, s.h + dy) }; g.current = n; if (ref.current) Object.assign(ref.current.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${n.h}px` }); };
    const off = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); cleanup.current = null; };
    const up = () => { off(); setDrag(false); if (g.current) onGeo?.(g.current); };
    cleanup.current?.(); cleanup.current = off; addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };
  // Mobile gestures (delegated): swipe a [data-swipe] row left → its [data-del], right → its [data-done]; pull down at top → refresh.
  const [pull, setPull] = useState(0);
  const gesture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("input,button,select,textarea,a")) return;
    const box = e.currentTarget, row = (e.target as HTMLElement).closest<HTMLElement>("[data-swipe]"), x0 = e.clientX, y0 = e.clientY, atTop = box.scrollTop <= 0; let axis: "x" | "y" | null = null, dx = 0, dy = 0;
    const mv = (ev: PointerEvent) => { dx = ev.clientX - x0; dy = ev.clientY - y0; if (!axis && Math.hypot(dx, dy) > 10) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x" && row) { row.classList.add("swiping"); row.style.transform = `translateX(${Math.max(-140, Math.min(140, dx))}px)`; row.classList.toggle("swipe-del", dx < -60); row.classList.toggle("swipe-done", dx > 60 && !!row.querySelector("[data-done]")); }
      else if (axis === "y" && atTop && dy > 0) setPull(Math.min(110, dy)); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (row) { row.classList.remove("swiping", "swipe-del", "swipe-done"); row.style.transform = ""; if (axis === "x") { if (dx < -90) row.querySelector<HTMLElement>("[data-del]")?.click(); else if (dx > 90) row.querySelector<HTMLElement>("[data-done]")?.click(); } }
      if (axis === "y" && atTop && dy > 70) { window.dispatchEvent(new Event("crystal-refresh")); sfx("ping"); } setPull(0); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };
  const keyMove = (e: React.KeyboardEvent) => { if (mode !== "float" || !g.current || !e.altKey || !e.shiftKey) return; const d = e.shiftKey ? 40 : 10; const n = { ...g.current }; if (e.key === "ArrowLeft") n.x -= d; else if (e.key === "ArrowRight") n.x += d; else if (e.key === "ArrowUp") n.y = Math.max(0, n.y - d); else if (e.key === "ArrowDown") n.y += d; else return; e.preventDefault(); onGeo?.(n); };
  const cls = anim === "in" ? "win-in" : anim === "min" ? "win-min" : "win-close";
  const ox = origin && origin.x >= 0 && rect ? `${origin.x - rect.x}px ${origin.y - rect.y}px` : "50% 50%";
  const style: React.CSSProperties = mode === "tile" ? { position: "fixed", left: eff?.x ?? 8, top: eff?.y ?? 64, width: eff?.w ?? 300, height: eff?.h ?? 300, zIndex: drag ? 27 : 26, transition: drag ? "none" : "left .25s ease, top .25s ease, width .25s ease, height .25s ease" } : mode === "max" ? { position: "fixed", left: eff?.x ?? 8, top: eff?.y ?? 64, width: eff?.w ?? "calc(100vw - 16px)", height: eff?.h ?? "60vh", zIndex: 28, /* below header (30) + Modules toolbar (35) */ transformOrigin: ox } : mode === "float" && geo ? { position: "absolute", left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: z } : {};
  const base = mode === "tile" ? `rounded-2xl ${drag ? "cursor-grabbing" : ""}` : mode === "max" ? "rounded-2xl win-maxed" : mode === "sheet" ? "fixed inset-x-0 bottom-0 z-[45] max-h-[78dvh] rounded-t-3xl sheet" : mode === "float" ? "rounded-2xl" : "max-h-[calc(100dvh-230px)] min-h-[200px] rounded-2xl";
  return (<>
    {mode === "sheet" && <div className="fade-in fixed inset-0 z-[44] bg-navy/50 backdrop-blur-[2px]" onClick={() => leave("min")} aria-hidden />}
    <section ref={ref} onPointerDown={onFocus} onKeyDown={keyMove} aria-label={`${title} applet`} style={style}
      className={`glass corner-ticks flex flex-col overflow-hidden ${base} ${mode === "max" ? (anim === "in" ? "win-spring" : cls) : mode !== "sheet" ? cls : anim !== "in" ? cls : ""} ${focused ? "neon-frame" : ""} ${drag ? "win-drag" : ""}`}
      data-maximized={mode === "max" ? "true" : undefined} data-winsize={mode === "max" ? size ?? "full" : undefined} data-tiled={mode === "tile" ? "true" : undefined} role={mode === "sheet" ? "dialog" : undefined} aria-modal={mode === "sheet" ? true : undefined}>
      {mode === "sheet" && <div className="flex justify-center pt-2" onPointerDown={e => { const y0 = e.clientY; const up = (ev: PointerEvent) => { removeEventListener("pointerup", up); if (ev.clientY - y0 > 60) leave("min"); }; addEventListener("pointerup", up); }}><span className="h-1.5 w-12 rounded-full bg-slate/60" aria-hidden /></div>}
      <header onPointerDown={e => startDrag(e, "move")} onDoubleClick={() => onToggleMax?.()}
        className={`flex items-center justify-between border-b border-cyan/15 bg-gradient-to-r from-navy-2/80 via-navy-2/40 to-transparent px-3 py-2 ${mode === "float" || mode === "tile" ? "cursor-grab select-none" : ""}`}>
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-snow"><span className={`text-cyan ${focused ? "animate-glow" : ""}`}>{icon}</span>{title}</h2>
        <div className="flex gap-1">
          {onToggleMax && (mode === "max" ? canFloat : true) && <button onClick={onToggleMax} onMouseEnter={() => sfx("hover")} aria-label={mode === "max" ? `Restore ${title} to a movable window` : `Maximize ${title}`} className="tap h-7 w-7 rounded-md text-ash hover:bg-cyan/15 hover:text-cyan">{mode === "max" ? "❐" : "⤢"}</button>}
          <button onClick={() => leave("min")} onMouseEnter={() => sfx("hover")} aria-label={`Minimize ${title}`} className="tap h-7 w-7 rounded-md text-ash hover:bg-cyan/15 hover:text-cyan">–</button>
          <button onClick={() => leave("close")} onMouseEnter={() => sfx("hover")} aria-label={`Close ${title}`} className="tap h-7 w-7 rounded-md text-ash hover:bg-alert/20 hover:text-alert">✕</button>
        </div>
      </header>
      <div className="applet-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" onPointerDown={gesture}>{pull > 0 && <div className="mb-1 text-center text-xs text-cyan" aria-hidden>{pull > 70 ? "↻ Release to refresh" : "↓ Pull to refresh"}</div>}<Boundary name={title}>{children}</Boundary></div>
      {(mode === "float" || mode === "tile" || mode === "max") && HANDLES.map(([d, c, cur]) => <div key={d} data-resize={d} onPointerDown={e => startResize(e, d)} onDoubleClick={() => { if (mode !== "float") { setOv(null); if (okey) try { localStorage.removeItem(okey); } catch {} } }} className={`absolute z-50 touch-none ${c}`} style={{ cursor: cur }} aria-hidden />)}
      {(mode === "float" || mode === "tile" || mode === "max") && <div className="pointer-events-none absolute bottom-0 right-0 h-3 w-3" aria-hidden style={{ background: "linear-gradient(135deg, transparent 50%, rgba(62,242,224,.55) 50%)" }} />}
    </section>
  </>);
}
