// Grounded facts for Crystal's answers. Loaded with the caller's own Supabase JWT so RLS applies.
export interface Grade { course: string; course_key: string; teacher: string | null; period: string | null; percent: number | null; mark: string | null; term: string; captured_at: string; is_final: boolean }
export interface Assign { course: string | null; name: string; due_date: string | null; missing: boolean; score_display: string | null }
export interface Facts {
  demo: boolean; signedIn: boolean; reason?: string;
  student: { name: string; grade: string | null; school: string | null } | null;
  grades: Grade[]; assignments: Assign[];
  lastSync: { ran_at: string; fetched_at: string | null } | null; lastRun: { ran_at: string; status: string; error: string | null } | null;
  alerts: { created_at: string; message: string }[]; tasks: { title: string; due_date: string | null; done: boolean }[];
}
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
export async function loadFacts(token: string | undefined, anon: string | undefined): Promise<Facts> {
  const empty: Facts = { demo: false, signedIn: false, student: null, grades: [], assignments: [], lastSync: null, lastRun: null, alerts: [], tasks: [] };
  if (!token || !anon) return { ...empty, reason: "not signed in" };
  const h = { apikey: anon, authorization: `Bearer ${token}` };
  const u = await fetch(`${SB}/auth/v1/user`, { headers: h });
  if (!u.ok) return { ...empty, reason: "session expired or invalid" };
  const q = async <T>(path: string): Promise<T[]> => { const r = await fetch(`${SB}/rest/v1/${path}`, { headers: h }); return r.ok ? (await r.json() as T[]) : []; };
  const st = await q<{ id: string; name: string; grade: string | null; school: string | null }>("edu_students?select=id,name,grade,school&order=name&limit=1");
  const tasks = await q<{ title: string; due_date: string | null; done: boolean }>("tasks?select=title,due_date,done&order=done,due_date&limit=40");
  if (!st.length) return { ...empty, signedIn: true, tasks, reason: "no school sync has loaded data yet" };
  const sid = encodeURIComponent(st[0].id);
  const [grades, assignments, runs, okRuns, alerts] = await Promise.all([
    q<Grade>(`edu_grades?select=course,course_key,teacher,period,percent,mark,term,captured_at,is_final&student_id=eq.${sid}&order=captured_at.desc&limit=400`),
    q<Assign>(`edu_assignments?select=course,name,due_date,missing,score_display&student_id=eq.${sid}&order=due_date.desc&limit=200`),
    q<{ ran_at: string; status: string; error: string | null }>("edu_sync_runs?select=ran_at,status,error&order=ran_at.desc&limit=1"),
    q<{ ran_at: string; fetched_at: string | null }>("edu_sync_runs?select=ran_at,fetched_at&status=eq.ok&order=ran_at.desc&limit=1"),
    q<{ created_at: string; message: string }>("edu_alerts?select=created_at,message&order=created_at.desc&limit=5"),
  ]);
  return { demo: false, signedIn: true, student: { name: st[0].name, grade: st[0].grade, school: st[0].school }, grades, assignments, lastSync: okRuns[0] ?? null, lastRun: runs[0] ?? null, alerts, tasks };
}
