// One source of truth for "what classes is the student taking and how are they doing", shared by the
// Education applet and Crystal's grounded answers (functions/_lib/answer.ts).
// Current classes = the courses in the LATEST snapshot (even when percent is null / mark 'N/A').
// Each is joined by course_key to its most recent final (e.g. Quarter 1). Finals whose course is
// absent from the latest snapshot are "completed courses" (e.g. a Q1-only PLTW rotation).
export interface GRow { captured_at: string; term: string; course_key: string; course: string; period: string | null; teacher: string | null; percent: number | null; mark: string | null; is_final: boolean }
export interface CurrentClass { key: string; course: string; period: string | null; teacher: string | null; term: string; percent: number | null; mark: string | null; posted: boolean; final: GRow | null; trend: number[]; status: string }
export interface GradeView { asOf: string | null; term: string | null; current: CurrentClass[]; completed: GRow[] }
const posted = (r: GRow) => r.percent != null;
export function gradeView(rows: GRow[]): GradeView {
  const rs = (rows ?? []).filter(r => r && r.course_key && r.captured_at);
  const snaps = rs.filter(r => !r.is_final); const latestAt = snaps.reduce<string | null>((m, r) => !m || r.captured_at > m ? r.captured_at : m, null);
  // tolerate a snapshot written over a few seconds
  const latest = latestAt ? snaps.filter(r => Date.parse(latestAt) - Date.parse(r.captured_at) < 120_000) : [];
  const finals = new Map<string, GRow>(); for (const r of rs.filter(x => x.is_final).sort((a, b) => a.captured_at.localeCompare(b.captured_at))) finals.set(r.course_key, r);
  const byKey = new Map<string, GRow>(); for (const r of latest) byKey.set(r.course_key, r);
  const current: CurrentClass[] = [...byKey.values()].map(r => {
    const fin = finals.get(r.course_key) ?? null;
    const trend = rs.filter(x => x.course_key === r.course_key && posted(x)).sort((a, b) => a.captured_at.localeCompare(b.captured_at)).map(x => Number(x.percent));
    const short = r.term.replace(/^Quarter\s*/i, "Q").replace(/^Progress Period\s*/i, "Q");
    const status = posted(r) ? `${short}: ${Number(r.percent)}%${r.mark && r.mark !== String(r.percent) && r.mark !== String(Math.round(Number(r.percent))) ? ` ${r.mark}` : ""}` : fin ? `${short}: not posted yet` : "No grade yet";
    return { key: r.course_key, course: r.course, period: r.period, teacher: r.teacher, term: r.term, percent: r.percent, mark: r.mark, posted: posted(r), final: fin, trend, status };
  }).sort((a, b) => (Number(a.period) || 99) - (Number(b.period) || 99) || a.course.localeCompare(b.course));
  const completed = latest.length ? [...finals.values()].filter(f => !byKey.has(f.course_key)) : [];
  // No in-progress snapshot at all: fall back to finals as the class list.
  if (!latest.length) return { asOf: null, term: null, current: [...finals.values()].map(f => ({ key: f.course_key, course: f.course, period: f.period, teacher: f.teacher, term: f.term, percent: f.percent, mark: f.mark, posted: posted(f), final: f, trend: posted(f) ? [Number(f.percent)] : [], status: `${f.term} final: ${f.percent ?? f.mark}` })), completed: [] };
  return { asOf: latestAt, term: latest[0]?.term ?? null, current, completed };
}
