// Cobb County School District calendar: ICS parsing + categories. Pure (no DOM) so Pages Functions and the app share it.
export type DCat = "first_last" | "holiday" | "student_holiday" | "early_release" | "digital" | "testing" | "report_card" | "board" | "other";
export interface DEvent { start: string; end: string; title: string; cat: DCat; source: "ics" | "pdf" }
export interface DistrictCal { asOf: string; source: string; pdf: string; year: string; events: DEvent[] }
export const ICS_URL = "https://www.cobbk12.org/_ci/calendar/subscription/";
export const CAT_LABEL: Record<DCat, string> = { first_last: "First/last day", holiday: "Holiday / break (closed)", student_holiday: "Student holiday / staff day", early_release: "Early release", digital: "Digital learning day", testing: "Testing window", report_card: "Report card / progress report", board: "Board meeting", other: "District event" };
/** No in-person classes on these categories. */
export const NO_SCHOOL: DCat[] = ["holiday", "student_holiday"];
export function classify(title: string, catHint = ""): DCat {
  const t = `${title} ${catHint}`.toLowerCase();
  if (/first day|last day/.test(t)) return "first_last";
  if (/digital learning/.test(t)) return "digital";
  if (/early release|conference week|early dismissal/.test(t)) return "early_release";
  if (/report card|progress report/.test(t)) return "report_card";
  if (/test|exam|milestones|eoc|assessment|map growth/.test(t)) return "testing";
  if (/board/.test(t)) return "board";
  if (/election day|student holiday|staff day|teacher work|winter holiday$/.test(t)) return "student_holiday";
  if (/holiday|break|thanksgiving|labor day|memorial|mlk|independence|juneteenth|closed/.test(t)) return "holiday";
  return "other";
}
const unfold = (s: string) => s.replace(/\r?\n[ \t]/g, "");
const ymd = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
const prevDay = (d: string) => new Date(Date.parse(d + "T12:00Z") - 864e5).toISOString().slice(0, 10);
export function parseICS(text: string): DEvent[] {
  const out: DEvent[] = [];
  for (const block of unfold(text).split("BEGIN:VEVENT").slice(1)) {
    const get = (k: string) => block.match(new RegExp(`^${k}(?:;[^:\\n]*)?:(.*)$`, "m"))?.[1]?.trim() ?? "";
    const title = get("SUMMARY").replace(/\\,/g, ",").replace(/\\;/g, ";"); const s = get("DTSTART"), e = get("DTEND");
    if (!title || !/^\d{8}/.test(s)) continue;
    const start = ymd(s); const allDay = /DTSTART;VALUE=DATE:/.test(block);
    const end = e && /^\d{8}/.test(e) ? (allDay ? prevDay(ymd(e)) : ymd(e)) : start; // all-day DTEND is exclusive
    out.push({ start, end: end < start ? start : end, title, cat: classify(title, get("CATEGORIES")), source: "ics" });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
export function eventsOn(d: string, ev: DEvent[]) { return ev.filter(e => d >= e.start && d <= e.end); }
export function isNoSchool(d: string, ev: DEvent[]) { const dow = new Date(d + "T12:00Z").getUTCDay(); return dow === 0 || dow === 6 || eventsOn(d, ev).some(e => NO_SCHOOL.includes(e.cat)); }
