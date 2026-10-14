// Deterministic, DB-grounded answers for school questions (no LLM) + the compact DATA block for the LLM.
import type { Facts, Grade } from "./facts";
const fmt = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "unknown";
const day = (d: string | null) => d ? new Date(d.slice(0, 10) + "T12:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "no date";
const SUBJ: [RegExp, RegExp][] = [
  [/\bmath|algebra|geometry\b/i, /math|algebra|geometry/i], [/\bscience|bio|chem|physics\b/i, /science|bio|chem|physic/i], [/\breading\b/i, /reading/i],
  [/\b(la|ela|language arts|english|writing)\b/i, /language arts|\bela\b|english|\bla\b/i], [/\b(social studies|ss|history|civics|geography)\b/i, /social|\bsoc\b|stdy|history|civics|geograph/i],
  [/\bchorus|choir|music|band|orchestra\b/i, /chorus|choir|music|band|orchestra/i], [/\bpltw|engineering|stem|robotics\b/i, /pltw|engineer|stem|robot/i],
  [/\b(pe|p\.e\.|gym|health|physical)\b/i, /\bpe\b|phys|health|gym/i], [/\bspanish|french|german|chinese|latin\b/i, /spanish|french|german|chinese|latin/i], [/\bart\b/i, /\bart\b/i],
];
import { gradeView, type CurrentClass } from "../../src/lib/gradeview";
import { letterGrade } from "../../src/lib/letter";
const lg = (p: number | null | undefined) => { const L = letterGrade(p); return L ? ` (${L})` : ""; };
/** Current classes (latest snapshot) joined to their latest final; completed = finals not in the latest snapshot. */
export function courseTable(g: Grade[]) { return gradeView(g); }
const gradeLine = (c: CurrentClass) => {
  const t = c.teacher ? ` (${c.teacher})` : "";
  const now = c.posted ? `${c.term}: ${c.percent}%${lg(c.percent)}` : c.final ? `${c.term}: not posted yet` : `${c.term}: no grade yet`;
  const fin = c.final ? `; ${c.final.term} final ${c.final.percent ?? c.final.mark}%${lg(c.final.percent)}` : "";
  return `${c.course}${t}: ${now}${fin}`;
};
const completedLine = (v: ReturnType<typeof gradeView>) => v.completed.length ? ` Completed courses: ${v.completed.map(f => `${f.course}${f.teacher ? ` (${f.teacher})` : ""}: ${f.term} final ${f.percent ?? f.mark}%`).join("; ")}.` : "";
export function asOf(f: Facts) { return f.lastSync ? fmt(f.lastSync.fetched_at || f.lastSync.ran_at) : "unknown"; }
const tag = (f: Facts) => `${f.demo ? " [DEMO DATA]" : ""} (as of last sync ${asOf(f)})`;
const who = (f: Facts) => f.student?.name?.split(/[ ,]/)[0] || "your student";
export const isSchoolQ = (q: string) => /\b(grade|grades|gpa|class|classes|course|courses|teacher|teachers|missing|assignment|assignments|homework|due|school|eli|sync|synced|report card|schedule|subject|subjects|quiz|test)\b/i.test(q) || SUBJ.some(([r]) => r.test(q));

/** Returns a grounded answer, or null if the LLM should handle it (with the DATA block). */
export function answerSchool(q: string, f: Facts): string | null {
  if (!isSchoolQ(q)) return null;
  if (!f.student && !f.demo) return f.signedIn ? `I can't see any school data yet: ${f.reason ?? "no sync has loaded data"}. Once the laptop sync runs, I'll answer from it.` : `I can't see school data yet because you're not signed in. Sign in and I'll answer from your synced records.`;
  const v = courseTable(f.grades); const rows = v.current;
  if (/\b(last|latest|recent)?\s*sync(ed)?\b|updated|refresh/i.test(q) && !/grade|class/i.test(q)) {
    const last = f.lastSync ? `Last successful sync: ${fmt(f.lastSync.fetched_at || f.lastSync.ran_at)}.` : "I don't have any successful sync on record.";
    const fail = f.lastRun && f.lastRun.status !== "ok" ? ` The most recent run (${fmt(f.lastRun.ran_at)}) ${f.lastRun.status}: ${f.lastRun.error ?? "no details"}.` : "";
    return `${last}${fail}${f.demo ? " [DEMO DATA]" : ""}`;
  }
  if (/\bmissing|late|zero|overdue\b/i.test(q)) {
    const m = f.assignments.filter(a => a.missing);
    return m.length ? `${who(f)} has ${m.length} missing assignment${m.length > 1 ? "s" : ""}: ${m.map(a => `${a.course ?? "unknown class"}: ${a.name} (due ${day(a.due_date)})`).join("; ")}${tag(f)}.` : `No missing assignments in the synced data${tag(f)}.`;
  }
  if (/\b(upcoming|due|homework|assignments?)\b/i.test(q) && !/grade/i.test(q)) {
    const today = new Date().toISOString().slice(0, 10); const up = f.assignments.filter(a => a.due_date && a.due_date.slice(0, 10) >= today && !a.missing).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 8);
    return up.length ? `Upcoming: ${up.map(a => `${a.course ?? "unknown class"}: ${a.name} (due ${day(a.due_date)})`).join("; ")}${tag(f)}.` : `I don't have any upcoming assignments in the synced data${tag(f)}.`;
  }
  const subj = SUBJ.find(([r]) => r.test(q));
  if (/\b(grade|grades|doing|score|percent|average|gpa|mark)\b/i.test(q) || (subj && /\bhow\b/i.test(q))) {
    if (!rows.length) return `I don't have any grades in the synced data${tag(f)}.`;
    if (subj) { const hit = rows.filter(r => subj[1].test(r.course) || subj[1].test(r.key)); const done = v.completed.filter(r => subj[1].test(r.course) || subj[1].test(r.course_key));
      return hit.length ? `${hit.map(gradeLine).join("; ")}${tag(f)}.` : done.length ? `${done.map(d => `${d.course} is a completed course: ${d.term} final ${d.percent ?? d.mark}%${lg(d.percent)}`).join("; ")}${tag(f)}.` : `I don't have a class matching that in ${who(f)}'s synced schedule. Classes I can see: ${rows.map(r => r.course).join(", ")}.`; }
    return `${who(f)}'s grades: ${rows.map(gradeLine).join("; ")}.${completedLine(v)}${tag(f)}.`;
  }
  if (/\b(class|classes|course|courses|schedule|subjects?|teachers?|taking|take)\b/i.test(q)) {
    if (!rows.length) return `I don't have ${who(f)}'s class list in the synced data${tag(f)}.`;
    return `${who(f)} takes ${rows.length} classes: ${rows.map(c => `${c.course}${c.period ? ` (period ${c.period}` : " ("}${c.teacher ? `${c.period ? ", " : ""}${c.teacher}` : ""})`.replace(" ()", "")).join("; ")}.${completedLine(v)}${tag(f)}.`;
  }
  return null;
}

export function dataBlock(f: Facts): string {
  if (!f.student && !f.demo) return `DATA:\nschool: unavailable (${f.reason ?? "no data"})\ntasks: ${f.tasks.filter(t => !t.done).map(t => `${t.title}${t.due_date ? ` due ${t.due_date}` : ""}`).join("; ") || "none"}`;
  const v = courseTable(f.grades);
  return [`DATA${f.demo ? " (DEMO, fake sample data)" : ""} as of last sync ${asOf(f)}:`, `student: ${f.student?.name ?? "unknown"}${f.student?.grade ? `, grade ${f.student.grade}` : ""}${f.student?.school ? `, ${f.student.school}` : ""}`,
    `current classes (latest snapshot ${v.term ?? ""}): ${v.current.map(gradeLine).join(" | ") || "none"}`,
    `completed courses (no longer on schedule): ${v.completed.map(c => `${c.course}: ${c.term} final ${c.percent ?? c.mark}`).join(" | ") || "none"}`,
    `missing: ${f.assignments.filter(a => a.missing).map(a => `${a.course}: ${a.name} (due ${a.due_date?.slice(0, 10)})`).join(" | ") || "none"}`,
    `upcoming: ${f.assignments.filter(a => !a.missing && a.due_date && a.due_date.slice(0, 10) >= new Date().toISOString().slice(0, 10)).slice(0, 8).map(a => `${a.course}: ${a.name} (due ${a.due_date?.slice(0, 10)})`).join(" | ") || "none"}`,
    `sync alerts: ${f.alerts.map(a => a.message).join(" | ") || "none"}`,
    ...schoolLines(f),
    `open tasks: ${f.tasks.filter(t => !t.done).slice(0, 15).map(t => `${t.title}${t.due_date ? ` due ${t.due_date}` : ""}`).join(" | ") || "none"}`].join("\n");
}

/** Extra school data (migrations 013/014). null = table not installed; never invented. */
export function schoolLines(f: Facts): string[] {
  const x = f.school; if (!x) return [];
  const na = (v: unknown) => v === null ? "not available yet (table not set up)" : "none";
  const sched = x.schedule?.length ? (() => { const t = x.schedule![0].term; return x.schedule!.filter(r => r.term === t).sort((a, b) => a.period - b.period).map(r => `P${r.period} ${r.course}, room ${r.room ?? "?"}, ${r.teacher ?? "?"}${r.teacher_email ? ` <${r.teacher_email}>` : ""}`).join(" | "); })() : na(x.schedule);
  const days = x.absences?.length ? [...new Set(x.absences.map(a => a.date))].map(d => { const rs = x.absences!.filter(a => a.date === d); return `${d}: ${rs[0].reason || rs[0].code}${rs[0].note ? ` (${rs[0].note})` : ""}, periods ${rs.map(r => r.period).join(",")}`; }).join(" | ") : na(x.absences);
  const g = (x.graded ?? []).filter(a => a.graded);
  const per = new Map<string, typeof g>(); for (const a of g) { const k = `${a.course} ${a.period_name}`; per.set(k, [...(per.get(k) ?? []), a]); }
  const graded = x.graded === null ? na(null) : [...per.entries()].map(([k, rs]) => `${k}: ${rs.slice(0, 12).map(a => `${a.name} [${a.category ?? "?"}] ${a.missing ? "MISSING" : a.percent != null ? a.percent + "%" : a.score_display}${a.due_date ? ` due ${a.due_date}` : ""}${a.notes ? ` note: ${a.notes}` : ""}`).join("; ")}${rs.length > 12 ? ` (+${rs.length - 12} more)` : ""}`).join(" || ") || "none";
  const wk = new Map<string, string[]>(); for (const w of x.weights ?? []) { if (w.category.toUpperCase() === "TOTAL") continue; const k = `${w.course_key} ${w.period_name}`; wk.set(k, [...(wk.get(k) ?? []), `${w.category.trim()} ${w.weight}%${w.points_possible ? ` (${(Number(w.points) / Number(w.points_possible) * 100).toFixed(1)}%)` : ""}`]); }
  const weights = x.weights === null ? na(null) : [...wk.entries()].map(([k, v]) => `${k}: ${v.join(", ")}`).join(" | ") || "none";
  const rc = x.reportCards === null ? na(null) : x.reportCards.map(r => `${r.school_year} ${r.period} (period ended ${r.issue_date})`).join(" | ") || "none published yet";
  return [`schedule (bell times: Dickerson MS site; Mon-Wed master, Thu-Fri flex): ${sched}`, `absences by day (ParentVUE): ${days}`,
    `graded assignments (newest first, per class/period): ${graded}`, `category weights (ParentVUE grade calc; category % in parens): ${weights}`,
    `report cards in Crystal: ${rc}`,
    "NOT available from Cobb (say so if asked): test scores (MAP/Milestones/CogAT), discipline, school documents, fees/lunch balance, counselor/homeroom/locker/emergency contacts, principal info via ParentVUE. Dickerson MS phone 770-578-2710, principal Bradley Blackman (school website)."];
}
