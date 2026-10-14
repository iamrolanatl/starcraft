// Cobb County School District scale: A 90–100, B 80–89, C 74–79, D 70–73, F 0–69.
// Uses the raw posted value (no rounding is applied here; Cobb's posted percentages are used as-is).
export type Letter = "A" | "B" | "C" | "D" | "F";
export function letterGrade(pct: number | null | undefined): Letter | null {
  if (pct == null || !Number.isFinite(Number(pct))) return null; const p = Number(pct);
  return p >= 90 ? "A" : p >= 80 ? "B" : p >= 74 ? "C" : p >= 70 ? "D" : "F";
}
// Colors (Rolan, Oct 14): A green; B yellow; C red; D/F red + flashing (~1 Hz pulse; static thick outline + ⚠ under reduced motion).
export const LETTER_STYLE: Record<Letter, { bg: string; fg: string; ring: string; label: string }> = {
  A: { bg: "#22c55e", fg: "#04140a", ring: "#86efac", label: "A (90–100)" },
  B: { bg: "#facc15", fg: "#1a1400", ring: "#fde68a", label: "B (80–89)" },
  C: { bg: "#c81e1e", fg: "#ffffff", ring: "#fca5a5", label: "C (74–79)" },
  D: { bg: "#b91c1c", fg: "#ffffff", ring: "#fca5a5", label: "D (70–73)" },
  F: { bg: "#b91c1c", fg: "#ffffff", ring: "#fca5a5", label: "F (0–69)" },
};
/** Below 74 (D/F) → flashing red. */
export const isLow = (pct: number | null | undefined) => pct != null && Number.isFinite(Number(pct)) && Number(pct) < 74;
/** Text color class for a numeric grade; includes the flash class when low. */
export function gradeText(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(Number(pct))) return "text-slate"; const p = Number(pct);
  return p >= 90 ? "g-a" : p >= 80 ? "g-b" : p >= 74 ? "g-c" : "g-c grade-low";
}
/** Fill color for grade bars. */
export const gradeHex = (p: number) => p >= 90 ? "#22c55e" : p >= 80 ? "#facc15" : "#ef4444";
