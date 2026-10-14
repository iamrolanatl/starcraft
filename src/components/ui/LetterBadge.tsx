import { letterGrade, LETTER_STYLE, isLow } from "@/lib/letter";
/** Big, bold, boxed letter grade (Cobb scale). Dark text on bright fills (F uses white on red); passes WCAG AA. */
export default function LetterBadge({ pct, size = "md" }: { pct: number | null | undefined; size?: "sm" | "md" | "lg" }) {
  const L = letterGrade(pct); if (!L) return null; const s = LETTER_STYLE[L];
  const dim = size === "lg" ? "h-10 w-10 text-2xl" : size === "sm" ? "h-6 w-6 text-sm" : "h-8 w-8 text-lg";
  return <span data-letter={L} data-tip={`Letter grade ${s.label}, Cobb County scale`} aria-label={`Letter grade ${L}`} role="img"
    className={`${isLow(pct) ? "grade-low grade-low-badge " : ""}inline-grid shrink-0 place-items-center rounded-md font-black leading-none ${dim}`}
    style={{ background: s.bg, color: s.fg, boxShadow: `0 0 0 2px ${s.ring}55, 0 0 12px -2px ${s.bg}`, fontVariantNumeric: "tabular-nums" }}>{L}</span>;
}
