import { loadLife, emptyLife, fetchQuotes, fetchWeather, type Life } from "./life";
// Grounded facts for Crystal's answers. Loaded with the caller's own Supabase JWT so RLS applies.
export interface Grade { course: string; course_key: string; teacher: string | null; period: string | null; percent: number | null; mark: string | null; term: string; captured_at: string; is_final: boolean }
export interface Assign { course: string | null; name: string; due_date: string | null; missing: boolean; score_display: string | null }
export interface Facts {
  demo: boolean; signedIn: boolean; reason?: string;
  student: { name: string; grade: string | null; school: string | null } | null;
  grades: Grade[]; assignments: Assign[];
  lastSync: { ran_at: string; fetched_at: string | null } | null; lastRun: { ran_at: string; status: string; error: string | null } | null;
  alerts: { created_at: string; message: string }[]; tasks: { title: string; due_date: string | null; done: boolean }[];
  life: Life;
  school?: SchoolX;
}
export interface SchoolX {
  schedule: { term: string; period: number; course: string; room: string | null; teacher: string | null; teacher_email: string | null }[] | null;
  absences: { date: string; period: number; reason: string | null; code: string | null; note: string | null; course: string | null }[] | null;
  graded: { course: string | null; period_name: string; name: string | null; category: string | null; due_date: string | null; percent: number | null; score_display: string | null; missing: boolean; graded: boolean; notes: string | null }[] | null;
  weights: { course_key: string; period_name: string; category: string; weight: number | null; points: number | null; points_possible: number | null }[] | null;
  reportCards: { school_year: string | null; period: string | null; issue_date: string | null }[] | null;
}
export interface FactOpts { syms?: string[]; coords?: { lat: number; lon: number } | null }
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
export async function loadFacts(token: string | undefined, anon: string | undefined, o: FactOpts = {}): Promise<Facts> {
  const pub = async () => { const l = emptyLife(); const [qs, wx] = await Promise.all([fetchQuotes(o.syms ?? []), o.coords ? fetchWeather(o.coords.lat, o.coords.lon) : null]); l.quotes = qs; l.weather = wx; return l; };
  const empty: Facts = { demo: false, signedIn: false, student: null, grades: [], assignments: [], lastSync: null, lastRun: null, alerts: [], tasks: [], life: emptyLife() };
  if (!token || !anon) return { ...empty, life: await pub(), reason: "not signed in" };
  const h = { apikey: anon, authorization: `Bearer ${token}` };
  const u = await fetch(`${SB}/auth/v1/user`, { headers: h, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!u?.ok) return { ...empty, life: await pub(), reason: "session expired or invalid" };
  /** null = table missing / unreadable; [] = empty */
  const qn = async <T>(path: string): Promise<T[] | null> => { try { const r = await fetch(`${SB}/rest/v1/${path}`, { headers: h, signal: AbortSignal.timeout(8000) }); if (!r.ok) return null; const j = await r.json(); return Array.isArray(j) ? j as T[] : null; } catch { return null; } };
  const q = async <T>(path: string): Promise<T[]> => (await qn<T>(path)) ?? [];
  const lifeP = loadLife(qn, o.syms ?? []).then(async l => { if (o.coords) l.weather = await fetchWeather(o.coords.lat, o.coords.lon); return l; });
  const st = await q<{ id: string; name: string; grade: string | null; school: string | null }>("edu_students?select=id,name,grade,school&order=name&limit=1");
  const life = await lifeP; const tasks = life.tasks;
  if (!st.length) return { ...empty, signedIn: true, tasks, life, reason: "no school sync has loaded data yet" };
  const sid = encodeURIComponent(st[0].id);
  const [grades, assignments, runs, okRuns, alerts] = await Promise.all([
    q<Grade>(`edu_grades?select=course,course_key,teacher,period,percent,mark,term,captured_at,is_final&student_id=eq.${sid}&order=captured_at.desc&limit=400`),
    q<Assign>(`edu_assignments?select=course,name,due_date,missing,score_display&student_id=eq.${sid}&order=due_date.desc&limit=200`),
    q<{ ran_at: string; status: string; error: string | null }>("edu_sync_runs?select=ran_at,status,error&order=ran_at.desc&limit=1"),
    q<{ ran_at: string; fetched_at: string | null }>("edu_sync_runs?select=ran_at,fetched_at&status=eq.ok&order=ran_at.desc&limit=1"),
    q<{ created_at: string; message: string }>("edu_alerts?select=created_at,message&order=created_at.desc&limit=5"),
  ]);
  const [schedule, absences, graded, weights, reportCards] = await Promise.all([
    qn<SchoolX["schedule"] & object>("edu_schedule?select=term,period,course,room,teacher,teacher_email,last_seen_at&order=last_seen_at.desc,period.asc&limit=40"),
    qn<SchoolX["absences"] & object>("edu_attendance_periods?select=date,period,reason,code,note,course&order=date.desc&limit=200"),
    qn<SchoolX["graded"] & object>("edu_graded_assignments?select=course,period_name,name,category,due_date,percent,score_display,missing,graded,notes&order=due_date.desc&limit=400"),
    qn<SchoolX["weights"] & object>("edu_grade_calc?select=course_key,period_name,category,weight,points,points_possible&limit=200"),
    qn<SchoolX["reportCards"] & object>("report_cards?select=school_year,period,issue_date&order=issue_date.desc&limit=20"),
  ]);
  const school = { schedule, absences, graded, weights, reportCards } as SchoolX;
  return { school, demo: false, signedIn: true, student: { name: st[0].name, grade: st[0].grade, school: st[0].school }, grades, assignments, lastSync: okRuns[0] ?? null, lastRun: runs[0] ?? null, alerts, tasks, life };
}
