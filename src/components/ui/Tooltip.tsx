"use client";
// Shared tooltip layer. One delegated listener covers the whole app:
//  - icon-only buttons (no letters in their visible text) show their aria-label,
//  - any element with data-tip shows that text,
//  - truncated single-line labels (.truncate that overflows) show their full text.
// Hover (350ms delay), keyboard focus (immediate), long-press on touch (450ms). Native title is moved to data-tip so it never double-shows.
import { useEffect, useState } from "react";
type T = { text: string; x: number; y: number; below: boolean } | null;
const LETTER = /[\p{L}\p{N}]/u;
export function iconOnly(el: Element) { const t = (el.textContent || "").replace(/\s+/g, ""); return !t || !LETTER.test(t) || t.length <= 1; }
export function tipFor(el: Element | null): { el: Element; text: string } | null {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    if (e.hasAttribute("title")) { const t = e.getAttribute("title")!; e.removeAttribute("title"); if (t && !e.hasAttribute("data-tip")) e.setAttribute("data-tip", t); }
    const dt = e.getAttribute("data-tip"); if (dt) return { el: e, text: dt };
    if ((e.tagName === "BUTTON" || e.getAttribute("role") === "button" || e.tagName === "A") && iconOnly(e)) { const a = e.getAttribute("aria-label"); if (a) return { el: e, text: a }; }
    if (e.classList.contains("truncate") && (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1) return { el: e, text: (e.textContent || "").trim() };
  }
  return null;
}
export default function TipLayer() {
  const [t, setT] = useState<T>(null);
  useEffect(() => {
    let timer = 0, cur: Element | null = null;
    const show = (hit: { el: Element; text: string }) => { const r = hit.el.getBoundingClientRect(); const below = r.bottom + 72 < innerHeight || r.top < 56; /* prefer below so tabs above are never covered; auto-flip up near the bottom edge */ setT({ text: hit.text, x: Math.min(Math.max(r.left + r.width / 2, 90), innerWidth - 90), y: below ? r.bottom + 8 : r.top - 8, below }); };
    const hide = () => { clearTimeout(timer); cur = null; setT(null); };
    const over = (e: Event) => { const hit = tipFor(e.target as Element); if (!hit) { if (cur) hide(); return; } if (hit.el === cur) return; hide(); cur = hit.el; timer = window.setTimeout(() => show(hit), 350); };
    const focus = (e: Event) => { const el = e.target as Element; if (!(el as HTMLElement).matches?.(":focus-visible")) return; const hit = tipFor(el); if (hit) { cur = hit.el; show(hit); } };
    const touch = (e: TouchEvent) => { const hit = tipFor(e.target as Element); if (!hit) return; clearTimeout(timer); timer = window.setTimeout(() => { cur = hit.el; show(hit); setTimeout(hide, 1800); }, 450); };
    const cancel = () => clearTimeout(timer);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    document.addEventListener("pointerover", over, true); document.addEventListener("focusin", focus, true); document.addEventListener("focusout", hide, true);
    document.addEventListener("touchstart", touch, { passive: true, capture: true }); document.addEventListener("touchend", cancel, true); document.addEventListener("touchmove", cancel, true);
    document.addEventListener("pointerdown", e => { if ((e as PointerEvent).pointerType !== "touch") hide(); }, true); document.addEventListener("keydown", key, true); addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("pointerover", over, true); document.removeEventListener("focusin", focus, true); document.removeEventListener("focusout", hide, true); document.removeEventListener("touchstart", touch, true); document.removeEventListener("touchend", cancel, true); document.removeEventListener("touchmove", cancel, true); document.removeEventListener("keydown", key, true); removeEventListener("scroll", hide, true); clearTimeout(timer); };
  }, []);
  if (!t) return null;
  return <div role="tooltip" data-tooltip className="tip-layer" style={{ left: t.x, top: t.y, transform: `translate(-50%, ${t.below ? "0" : "-100%"})` }}>{t.text}</div>;
}
