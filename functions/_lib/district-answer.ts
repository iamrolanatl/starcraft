// Grounded answers about the official CCSD 2026-27 calendar (no school days, breaks, early release, first/last day).
import { eventsOn, isNoSchool, CAT_LABEL, type DEvent, type DistrictCal } from "../../src/lib/district";
const dd = (d: string) => new Date(d + "T12:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const rng = (e: DEvent) => e.start === e.end ? dd(e.start) : `${dd(e.start)} – ${dd(e.end)}`;
const add = (d: string, n: number) => new Date(Date.parse(d + "T12:00Z") + n * 864e5).toISOString().slice(0, 10);
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function dateIn(q: string, today: string): string | null {
  if (/\btomorrow\b/i.test(q)) return add(today, 1); if (/\btoday\b/i.test(q)) return today;
  const m = q.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i);
  if (m) { const mo = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3)) + 1; const y = mo >= 7 ? 2026 : 2027; return `${y}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const n = q.match(/\b(\d{1,2})\/(\d{1,2})\b/); if (n) { const mo = Number(n[1]); return `${mo >= 7 ? 2026 : 2027}-${n[1].padStart(2, "0")}-${n[2].padStart(2, "0")}`; }
  return null;
}
export function answerDistrict(q: string, cal: DistrictCal, today: string): string | null {
  const cite = ` [source: Cobb County School District 2026-27 calendar (cobbk12.org); as of ${new Date(cal.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}]`;
  const ev = cal.events.filter(e => e.cat !== "board"); const find = (re: RegExp) => ev.filter(e => re.test(e.title));
  const named: [RegExp, RegExp][] = [[/thanksgiving/i, /thanksgiving/i], [/winter break|christmas break|holiday break/i, /winter holiday/i], [/february break|feb break|winter break in feb|presidents/i, /^winter break$/i], [/spring break/i, /spring break/i], [/fall break/i, /fall break/i], [/digital learning/i, /digital learning/i], [/early release|half day|early dismissal/i, /early release|conference/i], [/conference week/i, /conference/i]];
  if (!/\b(school|break|holiday|early release|half day|digital learning|first day|last day|conference week|day off|days off|off school|closed)\b/i.test(q)) return null;
  if (/\blast day( of school)?\b/i.test(q)) { const e = find(/last day/i)[0]; return e ? `Last day of school: ${dd(e.start)} (early release May 17–19).${cite}` : null; }
  if (/\bfirst day( of school)?\b/i.test(q)) { const e = find(/first day/i)[0]; return e ? `First day of school was ${dd(e.start)}.${cite}` : null; }
  for (const [qr, tr] of named) if (qr.test(q)) { const hits = find(tr).filter(e => e.end >= today); const all = hits.length ? hits : find(tr);
    if (all.length) { const extra = /winter holiday/i.test(tr.source) ? ` Students also have a holiday ${dd("2027-01-04")}; classes resume ${dd("2027-01-05")}.` : ""; return `${all.map(e => `${e.title}: ${rng(e)}`).join("; ")}.${extra}${cite}`; } }
  const d = dateIn(q, today);
  if (d && /\b(school|off|closed|holiday)\b/i.test(q)) { const on = eventsOn(d, ev); const no = isNoSchool(d, ev);
    return `${dd(d)}: ${no ? "no school" : on.some(e => e.cat === "digital") ? "digital learning day (learning from home)" : on.some(e => e.cat === "early_release") ? "school, early release" : "regular school day"}${on.length ? ` (${on.map(e => e.title).join(", ")})` : ""}.${cite}`; }
  if (/\b(next|upcoming)\b.*\b(day off|days off|holiday|break|no school)\b|\bno[- ]school days?\b|\bdays? off\b/i.test(q)) {
    const up = ev.filter(e => e.end >= today && (e.cat === "holiday" || e.cat === "student_holiday")).slice(0, 5);
    return up.length ? `Upcoming no-school days: ${up.map(e => `${e.title} (${rng(e)})`).join("; ")}.${cite}` : `No more no-school days this year.${cite}`; }
  return null;
}
export { CAT_LABEL };
