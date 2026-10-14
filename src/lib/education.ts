"use client";
import { sb } from "@/lib/supabase"; import { byChild } from "@/lib/family";

export interface Student { id: string; name: string; grade: string | null; school: string | null; attendance_totals: Record<string, number>; reporting_period: { name?: string; start?: string; end?: string }; last_fetched_at: string | null; last_synced_at: string | null }
export interface GradeRow { captured_at: string; term: string; course_key: string; course: string; period: string | null; teacher: string | null; teacher_email: string | null; percent: number | null; mark: string | null; is_final: boolean }
export interface Assignment { source: string; ext_id: string; course: string | null; name: string; kind: string | null; due_date: string | null; score_display: string | null; score_pct: number | null; missing: boolean; zero: boolean; late: boolean; status: string | null }
export interface Message { source: string; ext_id: string; sent_at: string | null; sender: string | null; subject: string | null; body: string | null; course: string | null; url: string | null; unread: boolean | null }
export interface CalItem { date: string; title: string; kind: string | null }
export interface Attendance { date: string; kind: string; reason: string | null; note: string | null }
export interface EduData { student: Student; grades: GradeRow[]; assignments: Assignment[]; messages: Message[]; calendar: CalItem[]; attendance: Attendance[]; demo: boolean }

export async function loadEducation(demo: boolean): Promise<EduData | null> {
  if (demo) return DEMO;
  const c = sb();
  const { data: st, error } = await byChild(c.from("edu_students").select("*")).order("name").limit(1);
  if (error) throw new Error(error.code === "PGRST205" || error.code === "42P01" ? "Education tables not installed yet (migration 002)." : error.message);
  if (!st?.length) return null;
  const s = st[0] as Student; const q = (t: string) => c.from(t).select("*").eq("student_id", s.id);
  const [g, a, m, cal, at] = await Promise.all([
    q("edu_grades").order("captured_at"), q("edu_assignments").order("due_date", { ascending: true }),
    q("edu_messages").order("sent_at", { ascending: false }).limit(60), q("edu_calendar").order("date"), q("edu_attendance").order("date", { ascending: false }),
  ]);
  for (const r of [g, a, m, cal, at]) if (r.error) throw new Error(r.error.message);
  return { student: s, grades: g.data as GradeRow[], assignments: a.data as Assignment[], messages: m.data as Message[], calendar: cal.data as CalItem[], attendance: at.data as Attendance[], demo: false };
}

// Fictional demo data (no real student information is shipped in the public bundle).
const T = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ago = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
const COURSES: [string, string, string, number, number[]][] = [
  ["math", "Math 7", "Ms. Nova", 81, [72, 75, 79, 78]], ["reading", "Reading 7", "Mr. Vega", 84, [80, 82, 79, 80]], ["science", "Science 7", "Dr. Orion", 77, [70, 73, 71, 74]],
  ["la", "Language Arts 7", "Ms. Lyra", 79, [74, 77, 76, 76.8]], ["ss", "Social Studies 7", "Mr. Rigel", 82, [78, 74, 76, 76]], ["chorus", "Chorus 7", "Mr. Sol", 95, [92, 93, 94, 93]], ["pltw", "Design & Modeling", "Mx. Atlas", 92, [96, 90, 94, 94]],
];
const DEMO: EduData = {
  demo: true,
  student: { id: "demo", name: "Cadet (demo)", grade: "07", school: "Starbase Middle School", attendance_totals: { excused: 0, unexcused: 1, tardies: 1 }, reporting_period: { name: "Quarter 2", start: "2026-10-12", end: "2026-12-18" } /* real ParentVUE Q2 dates; never invented */, last_fetched_at: ago(0.2), last_synced_at: ago(0.2) },
  grades: COURSES.flatMap(([k, n, t, cur, hist], i) => [
    ...hist.map((p, j) => ({ captured_at: ago(60 - j * 15), term: "Quarter 1", course_key: k, course: n, period: String(i + 1), teacher: t, teacher_email: null, percent: p, mark: String(p), is_final: j === hist.length - 1 })),
    { captured_at: ago(0.2), term: "Quarter 2", course_key: k, course: n, period: String(i + 1), teacher: t, teacher_email: null, percent: cur, mark: String(cur), is_final: false },
  ]),
  assignments: [
    { source: "ParentVUE", ext_id: "1", course: "Math 7", name: "Unit 3 Weekly Questions", kind: "Formative", due_date: T(-3), score_display: "Missing", score_pct: 0, missing: true, zero: true, late: false, status: "Graded" },
    { source: "CTLS", ext_id: "2", course: "Science 7", name: "Lab Safety Video Assessment", kind: "assignment", due_date: T(1), score_display: "Assigned", score_pct: null, missing: false, zero: false, late: false, status: "Assigned" },
    { source: "ParentVUE", ext_id: "3", course: "Language Arts 7", name: "Text-Based Discussion", kind: "Summative", due_date: T(2), score_display: "Not Due", score_pct: null, missing: false, zero: false, late: false, status: "Not graded" },
    { source: "ParentVUE", ext_id: "4", course: "Social Studies 7", name: "Map Quiz: Southwest Asia", kind: "Summative", due_date: T(4), score_display: "Not Due", score_pct: null, missing: false, zero: false, late: false, status: "Not graded" },
    { source: "ParentVUE", ext_id: "5", course: "Reading 7", name: "Cold Read Test", kind: "Summative", due_date: T(-5), score_display: "88 / 100", score_pct: 88, missing: false, zero: false, late: false, status: "Graded" },
  ],
  messages: [
    { source: "Gmail", ext_id: "m1", sent_at: ago(1), sender: "Ms. Nova (Math)", subject: "Retest window open through Friday", body: "Students may retest Unit 2 during Flex. Bring corrections.", course: "Math 7", url: null, unread: true },
    { source: "CTLS", ext_id: "m2", sent_at: ago(2), sender: "Mr. Rigel", subject: "Study guide posted", body: "Answer key for the study guide is on CTLS Learn.", course: "Social Studies 7", url: null, unread: null },
    { source: "ParentVUE", ext_id: "m3", sent_at: ago(4), sender: "ParentVUE", subject: "Progress report period ends soon", body: null, course: "ReportCard", url: null, unread: false },
  ],
  calendar: [
    { date: T(1), title: "Science: Lab Safety Video Assessment due", kind: "Assignment" }, { date: T(4), title: "Social Studies map quiz", kind: "Assignment" },
    { date: T(9), title: "Early release day", kind: "School" }, { date: T(16), title: "Parent-teacher conferences", kind: "School" },
  ],
  attendance: [{ date: T(-12), kind: "absence", reason: "Unexcused", note: null }],
};

export interface SyncRun { id: number; ran_at: string; source: string | null; kind: string | null; status: string; counts: Record<string, number>; error: string | null; job_id: number | null; fetched_at: string | null }
export interface EduAlert { id: number; created_at: string; kind: string; message: string; job_id: number | null }
export interface Job { id: number; status: string; kind: string; requested_at: string; finished_at: string | null; message: string | null }
export interface SyncStatus { runs: SyncRun[]; alerts: EduAlert[]; jobs: Job[] }

export async function loadSyncStatus(demo: boolean): Promise<SyncStatus> {
  if (demo) return DEMO_SYNC;
  const c = sb();
  const [r, a, j] = await Promise.all([
    c.from("edu_sync_runs").select("*").order("ran_at", { ascending: false }).limit(12),
    c.from("edu_alerts").select("*").order("created_at", { ascending: false }).limit(10),
    c.from("sync_requests").select("id,status,kind,requested_at,finished_at,message").order("id", { ascending: false }).limit(5),
  ]);
  return { runs: (r.data || []) as SyncRun[], alerts: (a.data || []) as EduAlert[], jobs: (j.data || []) as Job[] };
}

/** Sync button: creates a pending job (or returns the active one). The laptop watcher claims it within ~10 s. */
export async function requestSync(demo: boolean): Promise<Job> {
  if (demo) return { id: 999, status: "pending", kind: "manual", requested_at: new Date().toISOString(), finished_at: null, message: null };
  const { data, error } = await sb().rpc("request_sync", { p_message: "Sync pressed in Crystal" });
  if (error) throw new Error(error.message);
  return data as Job;
}
export async function jobStatus(id: number): Promise<Job | null> {
  const { data } = await sb().from("sync_requests").select("id,status,kind,requested_at,finished_at,message").eq("id", id).maybeSingle();
  return data as Job | null;
}

const DEMO_SYNC: SyncStatus = {
  jobs: [],
  runs: [
    { id: 3, ran_at: ago(0.2), source: "laptop:scheduled", kind: "scheduled", status: "ok", counts: { grades: 14, assignments: 23, messages: 57, calendar: 33, attendance: 4 }, error: null, job_id: 3, fetched_at: ago(0.2) },
    { id: 2, ran_at: ago(0.7), source: "laptop:scheduled", kind: "scheduled", status: "failed", counts: {}, error: "ParentVUE unreachable: The operation has timed out", job_id: 2, fetched_at: null },
    { id: 1, ran_at: ago(1.2), source: "laptop:manual", kind: "manual", status: "ok", counts: { grades: 14, assignments: 22, messages: 55, calendar: 33, attendance: 4 }, error: null, job_id: 1, fetched_at: ago(1.2) },
  ],
  alerts: [{ id: 1, created_at: ago(0.7), kind: "laptop_failed", message: "Sync #2 (scheduled) failed: ParentVUE unreachable: The operation has timed out", job_id: 2 }],
};
