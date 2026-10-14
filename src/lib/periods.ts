// Grading periods / terms / semesters for the Grades tab. Sources, in order:
// 1) live ParentVUE reporting_period.periods (if the sync stores the full ReportPeriods list),
// 2) the ParentVUE Gradebook ReportPeriods snapshot from the raw pull (src/data),
// 3) Cobb County district calendar (only first/last day of school; quarters are NOT published there).
// Semesters are derived from ParentVUE quarter dates (S1 = Q1 start → Q2 end, S2 = Q3 start → Q4 end). Nothing is invented.
import pv from "@/data/pv-periods-2026-27.json";
import snap from "../../public/data/ccsd-2026-27.json";
import { isNoSchool, type DEvent } from "@/lib/district";
export interface Period { id: string; name: string; start: string | null; end: string | null; source: string }
export interface Span extends Period { current: boolean; daysLeft: number | null; schoolDaysLeft: number | null; pct: number | null }
type Raw = { name: string; start: string; end: string };
const EV = (snap as { events: DEvent[] }).events;
const short = (n: string) => n.replace(/^Quarter\s*/i, "Q").replace(/^Progress Period\s*/i, "PP");
const day = 864e5, dt = (s: string) => Date.parse(s + "T12:00:00Z");
export function schoolDays(from: string, to: string) { let n = 0; for (let t = dt(from); t <= dt(to); t += day) if (!isNoSchool(new Date(t).toISOString().slice(0, 10), EV)) n++; return n; }
export function span(p: Period, today: string): Span {
  if (!p.start || !p.end) return { ...p, current: false, daysLeft: null, schoolDaysLeft: null, pct: null };
  const cur = today >= p.start && today <= p.end;
  const total = (dt(p.end) - dt(p.start)) / day + 1, done = Math.min(total, Math.max(0, (dt(today) - dt(p.start)) / day));
  return { ...p, current: cur, daysLeft: today > p.end ? 0 : Math.round((dt(p.end) - dt(today < p.start ? p.start : today)) / day) + (today < p.start ? 1 : 0),
    schoolDaysLeft: today > p.end ? 0 : schoolDays(today < p.start ? p.start : today, p.end), pct: Math.round(done / total * 100) };
}
export function periods(rp: { name?: string; start?: string; end?: string; periods?: Raw[] } | null | undefined) {
  const live = Array.isArray(rp?.periods) && rp!.periods!.length ? rp!.periods! : null;
  const list: Raw[] = live ?? (pv as { periods: Raw[] }).periods;
  const src = live ? "ParentVUE (live sync)" : `${(pv as { source: string }).source}, ${new Date((pv as { pulled: string }).pulled).toLocaleDateString()}`;
  const by = (n: string) => list.find(p => p.name.toLowerCase() === n.toLowerCase());
  const mk = (id: string, name: string): Period => { const r = by(name); return { id, name, start: r?.start ?? null, end: r?.end ?? null, source: r ? src : "date not available" }; };
  const quarters = [1, 2, 3, 4].map(i => mk(`Q${i}`, `Quarter ${i}`));
  const terms = list.filter(p => /progress period/i.test(p.name)).map(p => ({ id: short(p.name), name: p.name, start: p.start, end: p.end, source: src }));
  if (rp?.name && rp.start && rp.end && !terms.some(t => t.name === rp.name)) terms.push({ id: short(rp.name), name: rp.name, start: rp.start, end: rp.end, source: "ParentVUE (live sync)" });
  const sem = (id: string, a: Period, b: Period): Period => ({ id, name: id === "S1" ? "Semester 1" : "Semester 2", start: a.start, end: b.end, source: a.start && b.end ? `derived from ${a.id}–${b.id} (${src})` : "date not available" });
  const semesters = [sem("S1", quarters[0], quarters[1]), sem("S2", quarters[2], quarters[3])];
  const ff = EV.filter(e => e.cat === "first_last").map(e => e.start).sort();
  const year: Period = { id: "Year", name: "School year", start: ff[0] ?? null, end: ff[ff.length - 1] ?? null, source: ff.length ? "Cobb County district calendar 2026–27" : "date not available" };
  return { quarters, terms, semesters, year, currentTerm: rp?.name ?? null };
}
