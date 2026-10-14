"use client";
// Dynamic safe area for maximized applets: the viewport minus header/command bar, Crystal row, bottom HUD, and floating buttons.
import { useEffect, useState } from "react";
export interface Rect { x: number; y: number; w: number; h: number }
const GAP = 8;
function insets() {
  const p = document.createElement("div"); p.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(p); const s = getComputedStyle(p); const r = { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 }; p.remove(); return r;
}
export function computeSafe(): Rect {
  const W = innerWidth, H = innerHeight, i = insets(); let top = i.t, bottom = H - i.b;
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" ? r : null; };
  document.querySelectorAll("[data-safe-top]").forEach(el => { const r = vis(el); if (r && r.bottom > top && r.top < H / 2) top = r.bottom; });
  document.querySelectorAll("[data-safe-bottom]").forEach(el => { const r = vis(el); if (r && r.top < bottom && r.bottom > H / 2) bottom = r.top; });
  document.querySelectorAll("[data-safe-avoid]").forEach(el => { const r = vis(el); if (!r) return; if (r.top + r.height / 2 < H / 2) top = Math.max(top, r.bottom); else bottom = Math.min(bottom, r.top); });
  const left = i.l + GAP, right = W - i.r - GAP; top += GAP; bottom -= GAP;
  const w = Math.max(0, right - left), h = Math.max(120, bottom - top);
  return { x: Math.round(left + (right - left - w) / 2), y: Math.round(top), w: Math.round(w), h: Math.round(h) };
}
/** Re-measures with ResizeObserver on every safe-area element plus resize/orientation changes. */
export function useSafeArea(active: boolean): Rect | null {
  const [r, setR] = useState<Rect | null>(null);
  useEffect(() => {
    if (!active) return; let raf = 0; const upd = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setR(prev => { const n = computeSafe(); return prev && prev.x === n.x && prev.y === n.y && prev.w === n.w && prev.h === n.h ? prev : n; })); };
    const ro = new ResizeObserver(upd); const watch = () => { ro.disconnect(); ro.observe(document.documentElement); document.querySelectorAll("[data-safe-top],[data-safe-bottom],[data-safe-avoid]").forEach(el => ro.observe(el)); upd(); };
    watch(); const mo = new MutationObserver(watch); mo.observe(document.body, { childList: true, subtree: true, attributeFilter: ["data-safe-avoid"] });
    addEventListener("resize", upd); addEventListener("orientationchange", upd); addEventListener("scroll", upd, { passive: true }); visualViewport?.addEventListener("resize", upd);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); removeEventListener("resize", upd); removeEventListener("orientationchange", upd); removeEventListener("scroll", upd); visualViewport?.removeEventListener("resize", upd); };
  }, [active]);
  return r;
}
/** Last pointer position, used as the spring animation origin. */
export const lastPointer = { x: -1, y: -1 };
if (typeof window !== "undefined") addEventListener("pointerdown", e => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; }, { capture: true, passive: true });
