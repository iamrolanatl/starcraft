"use client";
// Pilot chat: sends the Supabase session token so the server answers from the user's own data (RLS).
// In demo mode, sends the fake demo dataset instead (labelled demo server-side).
import { sb } from "./supabase";
import { isDemo } from "./store";
import { loadEducation, loadSyncStatus } from "./education";
import { listTasks } from "./tasks";
import type { ChatMessage, ChatResponse } from "@/contracts/api";
export type GroundedResponse = ChatResponse & { grounded?: boolean };
export async function askPilot(messages: ChatMessage[]): Promise<GroundedResponse> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-supabase-anon": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" };
  let demoFacts: unknown;
  if (isDemo()) {
    const [e, s, t] = await Promise.all([loadEducation(true), loadSyncStatus(true), listTasks()]);
    const ok = s.runs.find(r => r.status === "ok") ?? null;
    demoFacts = { student: e ? { name: e.student.name, grade: e.student.grade, school: e.student.school } : null, grades: e?.grades ?? [], assignments: e?.assignments ?? [], lastSync: ok ? { ran_at: ok.ran_at, fetched_at: ok.fetched_at } : null, lastRun: s.runs[0] ?? null, alerts: s.alerts, tasks: t.map(x => ({ title: x.title, due_date: x.due_date, done: x.done })) };
  } else { const { data } = await sb().auth.getSession(); if (data.session) headers.authorization = `Bearer ${data.session.access_token}`; }
  const r = await fetch("/api/chat", { method: "POST", headers, body: JSON.stringify({ mode: "pilot", messages: messages.slice(-12), demoFacts }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j as GroundedResponse;
}
