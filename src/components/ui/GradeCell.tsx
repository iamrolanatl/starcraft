import { letterGrade, gradeText, LETTER_STYLE } from "@/lib/letter";
/** Grade column as a fixed 3-column grid: [letter 1.6ch centered][| 1.4ch][number 4.5ch right-aligned, tabular]
 *  so letters, separators and numbers form straight vertical lines across rows. Caption/"Not posted" span the same width. */
const GRID = { display: "grid", gridTemplateColumns: "1.6ch 1.4ch 4.5ch", fontVariantNumeric: "tabular-nums" } as const;
export default function GradeCell({ pct, text, caption, empty }: { pct: number | null | undefined; text: string | null; caption?: string | null; empty: string }) {
  const L = letterGrade(pct); const cls = gradeText(pct);
  return <span data-grade-cell className="shrink-0 font-mono text-lg font-bold leading-tight" style={GRID}>
    {text != null ? <>
      <span data-main data-letter={L ?? undefined} role="img" aria-label={L ? `${L}, ${text}` : text} data-tip={L ? `Letter grade ${LETTER_STYLE[L].label}, Cobb County scale` : undefined} className={`${cls} text-center`}>{L ?? ""}</span>
      <span data-sep aria-hidden className="text-center font-normal text-[#8b93a3]">{L ? "|" : ""}</span>
      <span data-num aria-hidden className={`${cls} text-right`}>{text}</span>
      {caption && <span className="col-span-3 text-right font-sans text-[11px] font-normal text-slate">{caption}</span>}</>
      : <span data-main className="col-span-3 text-right font-sans text-sm font-normal text-ash">{empty}</span>}
  </span>;
}
