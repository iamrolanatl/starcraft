"use client";
import { sb } from "./supabase";
export interface GA { course_key: string; period_name: string; gradebook_id: string; name: string | null; category: string | null; assigned_date: string | null; due_date: string | null; score_display: string | null; points_display: string | null; earned: number | null; possible: number | null; percent: number | null; notes: string | null; graded: boolean; missing: boolean }
export interface Calc { course_key: string; period_name: string; category: string; weight: number | null; points: number | null; points_possible: number | null; calculated_mark: string | null; updated_at: string }
export interface GradedData { rows: GA[]; calc: Calc[]; missing?: boolean }
let cache: Promise<GradedData> | null = null;
export function loadGraded(demo: boolean): Promise<GradedData> {
  if (demo) return Promise.resolve({ rows: [], calc: [] });
  return cache ??= (async () => {
    const [a, c] = await Promise.all([
      sb().from("edu_graded_assignments").select("course_key,period_name,gradebook_id,name,category,assigned_date,due_date,score_display,points_display,earned,possible,percent,notes,graded,missing").order("due_date", { ascending: false, nullsFirst: false }).limit(5000),
      sb().from("edu_grade_calc").select("course_key,period_name,category,weight,points,points_possible,calculated_mark,updated_at"),
    ]);
    if (a.error && /PGRST205|schema cache|does not exist/i.test(a.error.message + a.error.code)) { cache = null; return { rows: [], calc: [], missing: true }; }
    if (a.error) { cache = null; throw a.error; }
    return { rows: (a.data ?? []) as GA[], calc: (c.data ?? []) as Calc[] };
  })();
}
// Cobb County Administrative Rule IHA-R (Grading Systems), middle school letter scale.
export const COBB_SCALE_URL = "https://media.cobbk12.org/media/WWWCobb/medialib/iha-r.f670e337165.pdf";
export const LETTERS: [string, number][] = [["D", 70], ["C", 74], ["B", 80], ["A", 90]];
export const letter = (p: number) => p >= 90 ? "A" : p >= 80 ? "B" : p >= 74 ? "C" : p >= 70 ? "D" : "F";
export const qOf = (period: string) => { const m = period.match(/quarter\s*(\d)/i); return m ? `Q${m[1]}` : null; };

export interface Cat { category: string; weight: number; pct: number | null; points: number; possible: number; impact: number | null }
export interface CalcView { period: string; cats: Cat[]; overall: number | null; whatIf: string | null }
/** Weighted category math from ParentVUE's own GradeCalculationSummary. Returns null when ParentVUE has no weights for the class. */
export function calcView(calc: Calc[], rows: GA[], key: string): CalcView | null {
  const mine = calc.filter(c => c.course_key === key && c.category.toUpperCase() !== "TOTAL" && c.weight != null);
  if (!mine.length) return null;
  const periods = [...new Set(mine.map(c => c.period_name))];
  const hasData = (p: string) => mine.some(c => c.period_name === p && (c.points_possible ?? 0) > 0);
  const rank = (p: string) => (hasData(p) ? 100 : 0) + (qOf(p) ? 10 + Number(qOf(p)!.slice(1)) : 0);
  const period = periods.sort((a, b) => rank(b) - rank(a))[0];
  const cs = mine.filter(c => c.period_name === period);
  const cats: Cat[] = cs.map(c => ({ category: c.category, weight: Number(c.weight), points: Number(c.points ?? 0), possible: Number(c.points_possible ?? 0), pct: (c.points_possible ?? 0) > 0 ? Number(c.points) / Number(c.points_possible) * 100 : null, impact: null }));
  const live = cats.filter(c => c.pct != null); const W = live.reduce((s, c) => s + c.weight, 0);
  const overall = W > 0 ? live.reduce((s, c) => s + c.weight * (c.pct as number), 0) / W : null;
  if (overall != null) for (const c of live) c.impact = (c.weight / W) * ((c.pct as number) - overall);
  let whatIf: string | null = null;
  if (overall != null && live.length) {
    const k = [...live].sort((a, b) => (a.pct as number) - (b.pct as number))[0];
    const next = LETTERS.find(([, t]) => t > overall);
    if (!next) whatIf = `Already an A (${overall.toFixed(1)}%).`;
    else {
      const sizes = rows.filter(r => r.course_key === key && r.category === k.category && r.graded && r.possible).map(r => Number(r.possible)).sort((a, b) => a - b);
      const P = sizes.length ? sizes[Math.floor(sizes.length / 2)] : null;
      if (!P) whatIf = `To reach a ${next[0]} (${next[1]}%), ${k.category} needs to rise to ${(k.pct! + (next[1] - overall) * W / k.weight).toFixed(1)}%.`;
      else {
        const target = k.pct! + (next[1] - overall) * W / k.weight; const x = target / 100 * (k.possible + P) - k.points;
        whatIf = x <= P ? `Score ${Math.max(0, x).toFixed(1)} / ${P} (${Math.max(0, x / P * 100).toFixed(0)}%) on the next ${k.category} assignment to reach a ${next[0]} (${next[1]}%).`
                        : `One ${k.category} assignment (${P} pts) can't lift it to a ${next[0]} alone; even 100% gets ${(((k.points + P) / (k.possible + P) * 100 - k.pct!) * k.weight / W + overall).toFixed(1)}%.`;
      }
    }
  }
  return { period, cats, overall, whatIf };
}
