"use client";
// Pilot chat: sends the Supabase session token so the server answers from the user's own data (RLS).
// In demo mode, sends the fake demo dataset instead (labelled demo server-side).
import { sb } from "./supabase";
import { fetchJSON } from "./safe";
import { isDemo, list } from "./store";
import { loadEducation, loadSyncStatus } from "./education";
import { listTasks } from "./tasks";
import type { ChatMessage, ChatResponse } from "@/contracts/api";
export type GroundedResponse = ChatResponse & { grounded?: boolean };
export async function askPilot(messages: ChatMessage[], signal?: AbortSignal): Promise<GroundedResponse> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-supabase-anon": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" };
  let demoFacts: unknown;
  if (isDemo()) {
    const [e, s, t] = await Promise.all([loadEducation(true), loadSyncStatus(true), listTasks()]);
    const ok = s.runs.find(r => r.status === "ok") ?? null;
    demoFacts = { student: e ? { name: e.student.name, grade: e.student.grade, school: e.student.school } : null, grades: e?.grades ?? [], assignments: e?.assignments ?? [], lastSync: ok ? { ran_at: ok.ran_at, fetched_at: ok.fetched_at } : null, lastRun: s.runs[0] ?? null, alerts: s.alerts, tasks: t.map(x => ({ title: x.title, due_date: x.due_date, done: x.done })), life: await demoLife(t) };
  } else { const { data } = await sb().auth.getSession(); if (data.session) headers.authorization = `Bearer ${data.session.access_token}`; else { const r = await sb().auth.refreshSession().catch(() => null); if (r?.data.session) headers.authorization = `Bearer ${r.data.session.access_token}`; } }
  const j = await fetchJSON<GroundedResponse>("/api/chat", { method: "POST", headers, body: JSON.stringify({ mode: "pilot", messages: messages.slice(-12), demoFacts, coords: await coords() }), timeoutMs: 30000, retries: 1, signal });
  return { ...j, reply: typeof j?.reply === "string" && j.reply ? j.reply : "No signal from Crystal's core. Try again." };
}

/** Demo mode: the fake sample rows from every module, so demo answers are grounded too (labelled DEMO server-side). */
async function demoLife(t: { title: string; due_date: string | null; done: boolean }[]) {
  const g = async (n: Parameters<typeof list>[0]) => { try { return await list(n); } catch { return []; } };
  const [health, meds, bills, credit, stocks, shop, comms, checkins] = await Promise.all([g("health_logs"), g("meds"), g("bills"), g("credit_scores"), g("stocks"), g("shop_items"), g("comms_notes"), g("edu_checkins")]);
  const mail = await import("./mail").then(m => m.listMail()).catch(() => []);
  return { fetchedAt: new Date().toISOString(), tasks: t, health, meds, bills, credit, stocks, shop, comms, checkins, mail };
}
/** Location for weather answers: only if the user already granted it (never prompts from chat). */
async function coords(): Promise<{ lat: number; lon: number } | null> {
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName }); if (st?.state !== "granted") return null;
    return await new Promise(res => navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { maximumAge: 30 * 60e3, timeout: 4000 }));
  } catch { return null; }
}
