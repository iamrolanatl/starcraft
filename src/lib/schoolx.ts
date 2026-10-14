"use client";
import { sb } from "./supabase";
export interface Sched { term: string; period: number; course: string; course_key: string | null; room: string | null; teacher: string | null; teacher_email: string | null; last_seen_at: string }
export interface AbsP { date: string; period: number; code: string | null; reason: string | null; note: string | null; course: string | null; teacher: string | null }
async function q<T>(t: string, cols: string, order: string, asc: boolean): Promise<T[] | "missing"> {
  const { data, error } = await sb().from(t).select(cols).order(order, { ascending: asc }).limit(2000);
  if (error) { if (/PGRST205|schema cache|does not exist/i.test(error.message + error.code)) return "missing"; throw error; }
  return (data ?? []) as T[];
}
export const loadSchedule = (demo: boolean) => demo ? Promise.resolve([] as Sched[]) : q<Sched>("edu_schedule", "term,period,course,course_key,room,teacher,teacher_email,last_seen_at", "last_seen_at", false);
export const loadAbsences = (demo: boolean) => demo ? Promise.resolve([] as AbsP[]) : q<AbsP>("edu_attendance_periods", "date,period,code,reason,note,course,teacher", "date", false);
