// School calendar chip helpers: clean ParentVUE titles, categorize, grade-colored score pills.
export type ChipCat = "school" | "due" | "graded" | "test" | "personal" | "holiday";
export const CHIP: Record<ChipCat, { bg: string; border: string; label: string }> = {
  school: { bg: "rgb(180 120 10 / .38)", border: "#f5b82e", label: "School / District" },
  due: { bg: "rgb(37 99 235 / .38)", border: "#60a5fa", label: "Assignment Due" },
  graded: { bg: "rgb(22 163 74 / .36)", border: "#4ade80", label: "Graded / Score" },
  test: { bg: "rgb(220 38 38 / .38)", border: "#f87171", label: "Test / Quiz" },
  personal: { bg: "rgb(147 51 234 / .38)", border: "#c084fc", label: "Personal / Home" },
  holiday: { bg: "rgb(100 116 139 / .4)", border: "#94a3b8", label: "Holiday / Break" },
};
const TEST = /\b(test|quiz|exam|assessment|eog|milestones?|benchmark|cfa)\b/i;
/** "Hyden, N /Isbell Math 7 Q1(6) : U2P1 Study Guide - Score: 100" → { title: "Math: U2P1 Study Guide", score: 100, teacher: "Hyden, N /Isbell" } */
export function cleanPv(raw: string): { title: string; score: number | null; teacher: string | null; course: string | null } {
  let t = raw.trim(); let score: number | null = null;
  const sm = t.match(/\s*[-–]\s*Score:\s*([\d.]+)\s*%?\s*$/i); if (sm) { score = Number(sm[1]); t = t.slice(0, sm.index).trim(); }
  const parts = t.split(/\s+:\s+|\s*:\s+/); if (parts.length < 2) return { title: t.replace(/\s+due\s*$/i, ""), score, teacher: null, course: null };
  const left = parts[0], what = parts.slice(1).join(": ");
  // teacher = "Last, F" optionally "/Coteacher"; course = first word(s) before a grade number / period marker
  const tm = left.match(/^([A-Z][\w'’-]+,\s*[A-Z]\.?(?:\s*\/\s*[A-Z][\w'’-]+)?)\s+(.*)$/);
  const teacher = tm ? tm[1].replace(/\s+/g, " ") : null; const rest = tm ? tm[2] : left;
  const course = (rest.match(/^([A-Za-z][A-Za-z &]*?)(?=\s+(?:\d|Q\d|\(|$))/)?.[1] ?? rest.split(/\s+/)[0]).trim();
  return { title: `${course}: ${what.replace(/\s+due\s*$/i, "")}`, score, teacher, course };
}
export function catFor(o: { district?: string; pv?: boolean; due?: boolean; personal?: boolean; title: string; score?: number | null }): ChipCat {
  if (o.district) return /holiday|break|no school/i.test(o.district) || o.district === "holiday" || o.district === "student_holiday" ? "holiday" : "school";
  if (o.personal) return "personal";
  if (o.score != null) return "graded";
  if (TEST.test(o.title)) return "test";
  return o.due || o.pv ? "due" : "school";
}
export const scoreColor = (s: number) => s >= 90 ? { bg: "#22c55e", fg: "#04140a" } : s >= 80 ? { bg: "#facc15", fg: "#1a1400" } : { bg: "#b91c1c", fg: "#ffffff" };
