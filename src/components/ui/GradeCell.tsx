import { letterGrade, gradeText, isLow, LETTER_STYLE } from "@/lib/letter";
/** Fixed-width, right-aligned grade column: "C | 74" (same size/weight, colored by the grade rule, flashing < 74) with a caption under it. */
export default function GradeCell({ pct, text, caption, empty }: { pct: number | null | undefined; text: string | null; caption?: string | null; empty: string }) {
  const L = letterGrade(pct);
  return <span data-grade-cell className="w-[7.5rem] shrink-0 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
    {text != null ? <><span data-main data-letter={L ?? undefined} role="img" aria-label={L ? `${L}, ${text}` : text} data-tip={L ? `Letter grade ${LETTER_STYLE[L].label}, Cobb County scale` : undefined}
      className={`${gradeText(pct)} ${isLow(pct) ? "grade-low" : ""} inline-block whitespace-nowrap font-mono text-lg font-bold leading-tight`}>
      {L && <>{L}<span className="mx-1.5 font-normal text-[#6b7280]" aria-hidden>|</span></>}{text}</span>
      {caption && <span className="block text-[11px] text-slate">{caption}</span>}</>
      : <span data-main className="block text-sm text-ash">{empty}</span>}
  </span>;
}
