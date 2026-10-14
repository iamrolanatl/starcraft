// Cobb County School District scale: A 90–100, B 80–89, C 74–79, D 70–73, F 0–69.
// Uses the raw posted value (no rounding is applied here; Cobb's posted percentages are used as-is).
export type Letter = "A" | "B" | "C" | "D" | "F";
export function letterGrade(pct: number | null | undefined): Letter | null {
  if (pct == null || !Number.isFinite(Number(pct))) return null; const p = Number(pct);
  return p >= 90 ? "A" : p >= 80 ? "B" : p >= 74 ? "C" : p >= 70 ? "D" : "F";
}
export const LETTER_STYLE: Record<Letter, { bg: string; fg: string; ring: string; label: string }> = {
  A: { bg: "#22c55e", fg: "#04140a", ring: "#86efac", label: "A (90–100)" },
  B: { bg: "#22b8cf", fg: "#03161b", ring: "#8ee6f2", label: "B (80–89)" },
  C: { bg: "#f5b82e", fg: "#1d1300", ring: "#fde08a", label: "C (74–79)" },
  D: { bg: "#fb8a3c", fg: "#1f0c00", ring: "#fdc29a", label: "D (70–73)" },
  F: { bg: "#f0445a", fg: "#ffffff", ring: "#fda4b0", label: "F (0–69)" },
};
