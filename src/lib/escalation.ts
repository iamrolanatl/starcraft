"use client";
// Watches an escalated chat question (chat_escalations row, owner-only RLS) until the box worker answers.
// Supabase Realtime for instant delivery, plus a 3 s poll as a fallback. Resolves with the final row.
import { sb } from "./supabase";
export interface EscRow { id: string; status: "queued" | "working" | "answered" | "failed"; answer: string | null; error: string | null; model: string | null }
export function waitEscalation(id: string, onStatus?: (s: EscRow["status"]) => void, timeoutMs = 180000): Promise<EscRow> {
  return new Promise(resolve => {
    let done = false; let last = "";
    const finish = (r: EscRow) => { if (done) return; done = true; clearInterval(t); clearTimeout(to); try { void sb().removeChannel(ch); } catch { /* ignore */ } resolve(r); };
    const seen = (r: EscRow | null) => { if (!r || done) return; if (r.status !== last) { last = r.status; onStatus?.(r.status); } if (r.status === "answered" || r.status === "failed") finish(r); };
    const poll = async () => { try { const { data } = await sb().from("chat_escalations").select("id,status,answer,error,model").eq("id", id).maybeSingle(); seen(data as EscRow | null); } catch { /* keep polling */ } };
    const ch = sb().channel(`esc-${id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_escalations", filter: `id=eq.${id}` }, p => seen(p.new as EscRow)).subscribe();
    const t = setInterval(poll, 3000); void poll();
    const to = setTimeout(() => finish({ id, status: "failed", answer: null, error: "timed out", model: null }), timeoutMs);
  });
}
export const escText = (r: EscRow) => r.status === "answered" && r.answer ? r.answer : "I couldn't finish that escalated question. Please try asking again.";
