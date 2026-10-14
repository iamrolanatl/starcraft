"use client";
// Comm > Email: school-related Gmail mirrored by the box routine (mail_ingest.py) + reply outbox sent every 5 min.
// Signed in: Supabase with RLS (migration 012). Demo mode: fake sample data in localStorage only.
import { sb } from "./supabase";
import { isDemo } from "./store";
import { lsGet, lsSet } from "./safe";

export type Tag = "teacher" | "school" | "CTLS" | "district";
export interface Mail { id: string; gmail_id: string; thread_id: string; from: string | null; to: string | null; cc: string | null; subject: string | null; date: string | null; snippet: string | null; body_text: string | null; body_html: string | null; labels: string[]; is_read: boolean; school_tag: Tag | null; has_attachments: boolean }
export interface Att { id: string; message_id: string; filename: string; mime_type: string | null; size: number | null; storage_path: string }
export type OutStatus = "draft" | "queued" | "sending" | "sent" | "failed" | "cancelled";
export interface Out { id: string; thread_id: string | null; in_reply_to: string | null; to: string; cc: string | null; subject: string; body: string; status: OutStatus; error: string | null; sent_gmail_id: string | null; queued_at: string; sent_at: string | null; drafted_by: "crystal" | null; regen_requested: boolean }

const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));
export class MailError extends Error { constructor(m: string, public kind: "signin" | "migration" | "db") { super(m); } }
const err = (e: { code?: string; message?: string }) => missing(e) ? new MailError("The school inbox isn't set up yet. Run migration 012_mail.sql in Supabase.", "migration") : /jwt|401/i.test(`${e.code} ${e.message}`) ? new MailError("Your session expired. Please sign in again.", "signin") : new MailError(e.message || "Database error", "db");
async function guard() { if (isDemo()) return true; const { data } = await sb().auth.getSession(); if (!data.session) throw new MailError("Sign in to see your school email.", "signin"); return false; }

/* ---------- demo (fake) data ---------- */
type Demo = { mail: Mail[]; att: Att[]; out: Out[] };
const DK = "crystal-demo-mail-v1";
function demo(): Demo {
  const have = lsGet<Demo | null>(DK, null); if (have && Array.isArray(have.mail)) return have;
  const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  const m = (i: number, o: Partial<Mail>): Mail => ({ id: `dm${i}`, gmail_id: `demo${i}`, thread_id: `dt${i}`, from: null, to: "parent@example.com", cc: null, subject: null, date: ago(i * 7), snippet: null, body_text: null, body_html: null, labels: ["INBOX"], is_read: i > 2, school_tag: "teacher", has_attachments: false, ...o });
  const d: Demo = {
    mail: [
      m(1, { from: "Ms. Demo Sparks <sparks.demo@example.edu>", subject: "Unit 3 math test Friday (DEMO)", snippet: "Study guide attached. Test covers ratios.", body_text: "Hello,\nThe Unit 3 test is Friday. Study guide attached.\nMs. Sparks (demo)", body_html: "<p>Hello,</p><p>The <b>Unit 3 test</b> is Friday. Study guide attached.</p><p>Ms. Sparks (demo)</p>", has_attachments: true }),
      m(2, { from: "Mr. Demo Lee <lee.demo@example.edu>", subject: "Science lab permission slip (DEMO)", snippet: "Please sign by Wednesday.", body_text: "Please sign the lab permission slip by Wednesday. (demo)" }),
      m(3, { from: "CTLS Demo <noreply@ctls.example>", subject: "New assignment posted: Reading log (DEMO)", snippet: "Due next Monday.", body_text: "A new assignment was posted. (demo)", school_tag: "CTLS" }),
      m(4, { from: "District Demo <news@district.example>", subject: "Early release reminder (DEMO)", snippet: "Students dismiss 2 hours early.", body_text: "Early release reminder. (demo)", school_tag: "district" }),
      m(5, { from: "School Demo Office <office@school.example>", subject: "Picture day (DEMO)", snippet: "Order forms are online.", body_text: "Picture day is next week. (demo)", school_tag: "school" }),
    ],
    att: [{ id: "da1", message_id: "dm1", filename: "Demo study guide.pdf", mime_type: "application/pdf", size: 1200, storage_path: "demo" }],
    out: [{ id: "do1", thread_id: "dt1", in_reply_to: "demo1", to: "sparks.demo@example.edu", cc: null, subject: "Re: Unit 3 math test Friday (DEMO)", body: "Hi Ms. Sparks,\nThank you for the heads-up. Eli will work through the study guide this week.\nRolan (Eli's father)", status: "draft", error: null, sent_gmail_id: null, queued_at: ago(6), sent_at: null, drafted_by: "crystal", regen_requested: false }],
  };
  lsSet(DK, d); return d;
}
const saveDemo = (d: Demo) => lsSet(DK, d);

/* ---------- API ---------- */
export async function listMail(): Promise<Mail[]> {
  if (await guard()) return demo().mail;
  const { data, error } = await sb().from("mail_messages").select("id,gmail_id,thread_id,from,to,cc,subject,date,snippet,labels,is_read,school_tag,has_attachments").order("date", { ascending: false }).limit(300);
  if (error) throw err(error); return (data ?? []) as Mail[];
}
export async function getThread(thread_id: string): Promise<{ msgs: Mail[]; atts: Att[] }> {
  if (await guard()) { const d = demo(); const msgs = d.mail.filter(m => m.thread_id === thread_id); return { msgs, atts: d.att.filter(a => msgs.some(m => m.id === a.message_id)) }; }
  const { data, error } = await sb().from("mail_messages").select("*").eq("thread_id", thread_id).order("date"); if (error) throw err(error);
  const msgs = (data ?? []) as Mail[]; if (!msgs.length) return { msgs, atts: [] };
  const a = await sb().from("mail_attachments").select("id,message_id,filename,mime_type,size,storage_path").in("message_id", msgs.map(m => m.id)); if (a.error) throw err(a.error);
  return { msgs, atts: (a.data ?? []) as Att[] };
}
export async function markRead(ids: string[], read = true) {
  if (!ids.length) return; if (await guard()) { const d = demo(); d.mail.forEach(m => { if (ids.includes(m.id)) m.is_read = read; }); return saveDemo(d); }
  const { error } = await sb().from("mail_messages").update({ is_read: read }).in("id", ids); if (error) throw err(error);
}
export async function attachmentUrl(a: Att): Promise<string> {
  if (await guard()) return URL.createObjectURL(new Blob(["%PDF-1.4\n% Crystal demo attachment (fake)\n"], { type: a.mime_type || "application/pdf" }));
  const { data, error } = await sb().storage.from("mail").createSignedUrl(a.storage_path, 300, { download: a.filename });
  if (error || !data) throw new MailError(error?.message || "Could not open attachment", "db"); return data.signedUrl;
}
export async function listOutbox(): Promise<Out[]> {
  if (await guard()) return demo().out;
  const { data, error } = await sb().from("mail_outbox").select("id,thread_id,in_reply_to,to,cc,subject,body,status,error,sent_gmail_id,queued_at,sent_at,drafted_by,regen_requested").order("queued_at", { ascending: false }).limit(200);
  if (error) throw err(error); return (data ?? []) as Out[];
}
export async function queueReply(r: { thread_id: string; in_reply_to: string; to: string; cc: string | null; subject: string; body: string }) {
  if (await guard()) { const d = demo(); d.out.unshift({ ...r, id: crypto.randomUUID(), status: "queued", error: null, sent_gmail_id: null, queued_at: new Date().toISOString(), sent_at: null, drafted_by: null, regen_requested: false }); return saveDemo(d); }
  const { error } = await sb().from("mail_outbox").insert({ ...r, status: "queued" }); if (error) throw err(error);
}
/** Send a Crystal draft (draft -> queued). The DB trigger records Crystal's original vs. your final text to learn your style. */
export async function sendDraft(id: string, p: { to: string; cc: string | null; subject: string; body: string }) {
  if (await guard()) { const d = demo(); d.out = d.out.map(o => o.id === id ? { ...o, ...p, status: "queued", queued_at: new Date().toISOString() } : o); return saveDemo(d); }
  const { error } = await sb().from("mail_outbox").update({ ...p, status: "queued" }).eq("id", id).eq("status", "draft"); if (error) throw err(error);
}
export async function saveDraft(id: string, p: Partial<Pick<Out, "to" | "cc" | "subject" | "body" | "regen_requested">>) {
  if (await guard()) { const d = demo(); d.out = d.out.map(o => o.id === id ? { ...o, ...p, regen_requested: false } : o); return saveDemo(d); }
  const { error } = await sb().from("mail_outbox").update(p).eq("id", id).eq("status", "draft"); if (error) throw err(error);
}
export async function cancelOut(id: string) {
  if (await guard()) { const d = demo(); d.out = d.out.map(o => o.id === id && (o.status === "queued" || o.status === "draft") ? { ...o, status: "cancelled" } : o); return saveDemo(d); }
  const { error } = await sb().from("mail_outbox").update({ status: "cancelled" }).eq("id", id).in("status", ["queued", "draft"]); if (error) throw err(error);
}
/** Live updates (outbox status, new mail). Returns an unsubscribe. */
export function subscribeMail(fn: () => void): () => void {
  if (isDemo()) return () => {};
  const ch = sb().channel("crystal-mail").on("postgres_changes", { event: "*", schema: "public", table: "mail_outbox" }, fn).on("postgres_changes", { event: "*", schema: "public", table: "mail_messages" }, fn).subscribe();
  const t = setInterval(fn, 60000);
  return () => { clearInterval(t); sb().removeChannel(ch); };
}
export const fromName = (f: string | null) => (f || "").replace(/<[^>]+>/, "").replace(/"/g, "").trim() || (f || "unknown");
export const fromAddr = (f: string | null) => (f?.match(/[\w.%+'-]+@[\w.-]+\.\w+/)?.[0] || "").toLowerCase();
export const reSubject = (s: string | null) => /^\s*re:/i.test(s || "") ? (s || "") : `Re: ${s || ""}`.trim();
