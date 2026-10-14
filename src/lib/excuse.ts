"use client";
import { sb } from "./supabase";
// Verified 2026-10-14 on https://www.cobbk12.org/dickerson/front-office-attendance-procedures
// ("email our school attendance inbox at dickersonmssupport@cobbk12.org"; excuses due within 3 days).
export const ATTENDANCE_EMAIL = "dickersonmssupport@cobbk12.org";
export const ATTENDANCE_SOURCE = "https://www.cobbk12.org/dickerson/front-office-attendance-procedures";
export type Reason = "illness" | "appointment" | "family" | "other";
export interface Excuse { id: string; dates: string[]; periods: string | null; kind: "absence" | "tardy"; reason_choice: Reason; created_at: string; outbox_id: string; mail_outbox: { status: string; queued_at: string; sent_at: string | null; error: string | null } | null }
const longDate = (d: string) => new Date(d + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
export function draftExcuse(o: { student: string; permId: string | null; kind: "absence" | "tardy"; dates: string[]; periods: number[]; reason: Reason; extra: string }) {
  const ds = o.dates.map(longDate); const dl = ds.length > 1 ? `${ds.slice(0, -1).join(", ")} and ${ds[ds.length - 1]}` : ds[0];
  const ps = o.periods.filter(p => p >= 1 && p <= 7); const pl = ps.length ? ` (period${ps.length > 1 ? "s" : ""} ${ps.join(", ")})` : "";
  const what = o.kind === "tardy" ? (o.dates.length > 1 ? "late arrivals" : "late arrival") : (o.dates.length > 1 ? "absences" : "absence");
  const why = { illness: o.kind === "tardy" ? "He was not feeling well that morning." : "He was ill and unable to attend.", appointment: "He had an appointment that could not be scheduled outside school hours.", family: "It was due to a family matter.", other: "" }[o.reason];
  const extra = o.extra.trim(); const reasonText = [why, extra ? (extra.endsWith(".") ? extra : extra + ".") : ""].filter(Boolean).join(" ");
  const id = o.permId ? `Student ID ${o.permId}, ` : "";
  const subject = `Attendance excuse: ${o.student} (${id}Grade 7), ${o.dates.map(d => new Date(d + "T12:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })).join(", ")}`;
  const body = `Dear Dickerson Attendance Office,

I am writing to excuse my son, ${o.student} (${id}Grade 7), for his ${what} on ${dl}${pl}.${reasonText ? " " + reasonText : ""}

Thank you for your help. Please let me know if you need anything further from me.

Respectfully,
Rolan Chowdhury
Eli's father`;
  return { subject, body };
}
export async function loadExcuses(): Promise<Excuse[] | "missing"> {
  const { data, error } = await sb().from("edu_attendance_excuses").select("id,dates,periods,kind,reason_choice,created_at,outbox_id,mail_outbox(status,queued_at,sent_at,error)").order("created_at", { ascending: false });
  if (error) { if (/PGRST205|PGRST200|schema cache|does not exist/i.test(error.message + error.code)) return "missing"; throw error; }
  return (data ?? []) as unknown as Excuse[];
}
/** Rolan pressed Send: queue a NEW message (no thread / in_reply_to) in the 012 outbox, then link it. Never auto-sent. */
export async function queueExcuse(o: { to: string; subject: string; body: string; dates: string[]; periods: number[]; kind: "absence" | "tardy"; reason: Reason }) {
  const { data, error } = await sb().from("mail_outbox").insert({ to: o.to, subject: o.subject, body: o.body, status: "queued" }).select("id").single();
  if (error) throw error;
  const { error: e2 } = await sb().from("edu_attendance_excuses").insert({ dates: o.dates, periods: o.periods.join(",") || null, kind: o.kind, reason_choice: o.reason, outbox_id: data.id });
  if (e2) { await sb().from("mail_outbox").update({ status: "cancelled" }).eq("id", data.id); throw e2; }
}
export async function cancelExcuse(outboxId: string) { const { error } = await sb().from("mail_outbox").update({ status: "cancelled" }).eq("id", outboxId).eq("status", "queued"); if (error) throw error; }
export async function studentIdentity(): Promise<{ name: string; permId: string | null }> {
  const { data } = await sb().from("edu_students").select("name,full_name,perm_id").limit(1).maybeSingle();
  const d = data as { name?: string; full_name?: string | null; perm_id?: string | null } | null;
  return { name: d?.full_name || d?.name || "Eli", permId: d?.perm_id ?? null };
}
