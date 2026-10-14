"use client";
// Comm > Email: school inbox (mirrored from Gmail every 5 min), thread reader, reply composer with a 5-minute send queue,
// and Crystal's auto-drafted teacher replies (never sent until you press Send).
import { useCallback, useEffect, useMemo, useState } from "react";
import { listMail, getThread, markRead, attachmentUrl, listOutbox, queueReply, sendDraft, saveDraft, cancelOut, subscribeMail, fromName, fromAddr, reSubject, type Mail, type Att, type Out, type Tag } from "@/lib/mail";
import { Skeleton, Empty, ErrorNote, toast } from "@/components/ui/kit";
import { sfx } from "@/lib/synth";

const TAGS: (Tag | "all")[] = ["all", "teacher", "school", "CTLS", "district"];
const TAGC: Record<Tag, string> = { teacher: "bg-cyan/20 text-cyan", school: "bg-emerald-400/20 text-emerald-200", CTLS: "bg-violet-400/20 text-violet-200", district: "bg-amber-400/20 text-amber-200" };
const OWNER = "iamrolan@gmail.com";
const when = (d: string | null) => { if (!d) return ""; const x = new Date(d); return x.toDateString() === new Date().toDateString() ? x.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : x.toLocaleDateString([], { month: "short", day: "numeric" }); };
const kb = (n: number | null) => n == null ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const STAT: Record<string, [string, string]> = { draft: ["Draft", "text-ash"], queued: ["Queued: sends within 5 min", "text-amber-200"], sending: ["Sending…", "text-amber-200"], sent: ["Sent", "text-emerald-300"], failed: ["Failed", "text-alert"], cancelled: ["Cancelled", "text-slate"] };

function Body({ m }: { m: Mail }) {
  // HTML is sanitized on ingest (nh3); render it in a fully sandboxed iframe (no scripts, no same-origin, no remote loads).
  if (!m.body_html) return <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-snow">{m.body_text || m.snippet || "(no content)"}</pre>;
  const doc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><base target="_blank"><style>html,body{margin:0;background:#0b1424;color:#e8f1ff;font:15px/1.55 system-ui,sans-serif;overflow-wrap:anywhere;word-break:normal}a{color:#6ff3e6}img{max-width:100%;height:auto}table{max-width:100%!important;border-collapse:collapse}td,th{padding:2px 4px}*{color:inherit!important;background:transparent!important;font-family:inherit!important;max-width:100%}</style>${m.body_html}`;
  return <iframe title={`Email: ${m.subject ?? ""}`} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="h-[45vh] min-h-[220px] w-full rounded-md border border-cyan/15 bg-[#0b1424] md:h-[50vh]" />;
}

function Composer({ base, draft, onDone }: { base: Mail; draft?: Out; onDone: () => void }) {
  const all = useMemo(() => [...new Set([fromAddr(base.from), ...(`${base.to ?? ""},${base.cc ?? ""}`.match(/[\w.%+'-]+@[\w.-]+\.\w+/g) ?? []).map(s => s.toLowerCase())])].filter(a => a && a !== OWNER), [base]);
  const [mode, setMode] = useState<"reply" | "all">("reply");
  const [to, setTo] = useState(draft?.to ?? fromAddr(base.from)); const [cc, setCc] = useState(draft?.cc ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? reSubject(base.subject)); const [body, setBody] = useState(draft?.body ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (draft) { setTo(draft.to); setCc(draft.cc ?? ""); setSubject(draft.subject); setBody(draft.body); } }, [draft?.id, draft?.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (m: "reply" | "all") => { setMode(m); setTo(fromAddr(base.from)); setCc(m === "all" ? all.filter(a => a !== fromAddr(base.from)).join(", ") : ""); };
  const ok = /@/.test(to) && body.trim().length > 0;
  const send = async () => { if (!ok || busy) return; setBusy(true); try {
      const p = { to: to.trim(), cc: cc.trim() || null, subject: subject.trim() || reSubject(base.subject), body };
      if (draft) await sendDraft(draft.id, p); else await queueReply({ ...p, thread_id: base.thread_id, in_reply_to: base.gmail_id });
      sfx("success"); toast("Queued: sends within 5 min"); onDone(); if (!draft) setBody("");
    } catch (e) { toast((e as Error).message, "warn"); } finally { setBusy(false); } };
  const regen = async () => { if (!draft) return; try { await saveDraft(draft.id, { regen_requested: true }); toast("Crystal will redraft this within 5 min"); onDone(); } catch (e) { toast((e as Error).message, "warn"); } };
  return (<form className="glass mt-3 space-y-2 rounded-lg p-3" onSubmit={e => { e.preventDefault(); send(); }}>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {draft?.drafted_by === "crystal" ? <span className="rounded-full bg-cyan/20 px-2 py-0.5 font-semibold text-cyan" title="Auto-drafted. Nothing is sent until you press Send.">✦ Drafted by Crystal</span> : null}
      {!draft && <div role="radiogroup" className="flex gap-1">{(["reply", "all"] as const).map(m => <button type="button" key={m} role="radio" aria-checked={mode === m} onClick={() => pick(m)} className={`rounded px-2 py-0.5 ${mode === m ? "bg-cyan/20 text-cyan" : "text-ash hover:text-cyan"}`}>{m === "reply" ? "Reply" : "Reply all"}</button>)}</div>}
      {draft?.regen_requested && <span className="text-amber-200">Redraft requested…</span>}
    </div>
    <label className="flex items-center gap-2 text-xs text-ash"><span className="w-8 shrink-0">To</span><input className="input min-w-0 flex-1 text-sm" value={to} onChange={e => setTo(e.target.value)} inputMode="email" aria-label="To" /></label>
    <label className="flex items-center gap-2 text-xs text-ash"><span className="w-8 shrink-0">Cc</span><input className="input min-w-0 flex-1 text-sm" value={cc} onChange={e => setCc(e.target.value)} inputMode="email" aria-label="Cc" /></label>
    <input className="input w-full text-sm" value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject" />
    <textarea className="input min-h-[8rem] w-full resize-y text-sm leading-relaxed" value={body} onChange={e => setBody(e.target.value)} placeholder="Write your reply…" aria-label="Reply body" />
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn btn-primary text-sm" disabled={!ok || busy}>{busy ? "Queuing…" : "Send"}</button>
      {draft && <><button type="button" className="btn text-sm" onClick={regen} disabled={draft.regen_requested}>↻ Regenerate</button>
        <button type="button" className="btn text-sm" onClick={() => saveDraft(draft.id, { to, cc: cc || null, subject, body }).then(() => { toast("Draft saved"); onDone(); }, e => toast((e as Error).message, "warn"))}>Save Draft</button>
        <button type="button" className="text-xs text-ash hover:text-alert" onClick={() => cancelOut(draft.id).then(onDone)}>Discard</button></>}
      <span className="text-[10px] text-slate">Sent from your Gmail by the 5-minute queue. You can cancel until it goes.</span>
    </div>
  </form>);
}

export default function MailInbox() {
  const [mail, setMail] = useState<Mail[] | null>(null); const [out, setOut] = useState<Out[]>([]); const [err, setErr] = useState<{ message: string; kind?: string } | null>(null);
  const [tag, setTag] = useState<Tag | "all">("all"); const [q, setQ] = useState(""); const [unreadOnly, setUnreadOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null); const [th, setTh] = useState<{ msgs: Mail[]; atts: Att[] } | null>(null);
  const load = useCallback(async () => { try { const [m, o] = await Promise.all([listMail(), listOutbox().catch(() => [] as Out[])]); setMail(m); setOut(o); setErr(null); } catch (e) { setErr(e as Error); setMail([]); } }, []);
  useEffect(() => { load(); return subscribeMail(load); }, [load]);
  useEffect(() => { if (!open) { setTh(null); return; } let on = true; getThread(open).then(t => { if (!on) return; setTh(t); const un = t.msgs.filter(m => !m.is_read).map(m => m.id); if (un.length) markRead(un).then(() => setMail(ms => ms?.map(m => un.includes(m.id) ? { ...m, is_read: true } : m) ?? ms)).catch(() => {}); }).catch(e => setErr(e)); return () => { on = false; }; }, [open]);
  const threads = useMemo(() => { const by = new Map<string, Mail[]>(); for (const m of mail ?? []) by.set(m.thread_id, [...(by.get(m.thread_id) ?? []), m]);
    const s = q.trim().toLowerCase();
    return [...by.values()].map(ms => ({ id: ms[0].thread_id, last: ms[0], n: ms.length, unread: ms.some(m => !m.is_read), att: ms.some(m => m.has_attachments), draft: out.some(o => o.thread_id === ms[0].thread_id && o.status === "draft") }))
      .filter(t => (tag === "all" || t.last.school_tag === tag) && (!unreadOnly || t.unread) && (!s || `${t.last.subject} ${t.last.from} ${t.last.snippet}`.toLowerCase().includes(s))); }, [mail, out, tag, q, unreadOnly]);
  const unread = (mail ?? []).filter(m => !m.is_read).length;
  const tOut = out.filter(o => o.thread_id === open && o.status !== "draft"); const draft = out.find(o => o.thread_id === open && o.status === "draft");
  const last = th?.msgs.filter(m => fromAddr(m.from) !== OWNER).at(-1) ?? th?.msgs.at(-1);
  const dl = async (a: Att) => { try { const u = await attachmentUrl(a); const l = document.createElement("a"); l.href = u; l.download = a.filename; l.rel = "noopener"; l.target = "_blank"; l.click(); } catch (e) { toast((e as Error).message, "warn"); } };

  return (<div className="text-snow">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <input className="input min-w-0 flex-1 text-sm" type="search" placeholder="Search school email" value={q} onChange={e => setQ(e.target.value)} aria-label="Search email" />
      <label className="flex items-center gap-1 text-xs text-ash"><input type="checkbox" className="accent-[#3ef2e0]" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />Unread{unread ? ` (${unread})` : ""}</label>
    </div>
    <div role="tablist" aria-label="School category" className="pill-tabs mb-2">{TAGS.map((t, i) => <button key={t} role="tab" style={{ "--i": i } as React.CSSProperties} aria-selected={tag === t} onClick={() => setTag(t)} className="pill-tab">{t === "all" ? "All" : t}</button>)}</div>
    <ErrorNote err={err} />
    <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <ul className={`max-h-[60vh] space-y-1 overflow-y-auto pr-1 ${open ? "hidden md:block" : ""}`} aria-label="School inbox">
        {mail === null ? <Skeleton rows={5} /> : threads.length === 0 ? <Empty title={mail.length ? "No matching email" : "No school email yet"} hint={mail.length ? "Try another filter" : "The Gmail sync adds school email every 5 minutes"} /> :
          threads.map(t => <li key={t.id}><button onClick={() => setOpen(t.id)} aria-current={open === t.id} className={`glass block w-full rounded-lg px-3 py-2 text-left hover:border-cyan/50 ${open === t.id ? "border-cyan/60" : ""}`}>
            <div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-cyan" : "bg-transparent"}`} aria-label={t.unread ? "unread" : undefined} />
              <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-semibold text-snow" : "text-ash"}`}>{fromName(t.last.from)}{t.n > 1 ? ` (${t.n})` : ""}</span>
              <span className="shrink-0 text-[10px] text-slate">{when(t.last.date)}</span></div>
            <div className={`truncate text-sm ${t.unread ? "text-snow" : "text-ash"}`}>{t.last.subject || "(no subject)"}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate"><span className="min-w-0 flex-1 truncate">{t.last.snippet}</span>{t.att && <span aria-label="has attachments">📎</span>}{t.draft && <span className="rounded bg-cyan/15 px-1 text-cyan">✦ draft</span>}{t.last.school_tag && <span className={`rounded px-1 ${TAGC[t.last.school_tag]}`}>{t.last.school_tag}</span>}</div>
          </button></li>)}
      </ul>
      <section className={`min-w-0 ${open ? "" : "hidden md:block"}`} aria-label="Email reader">
        {!open ? <p className="p-4 text-sm text-ash">Select an email to read it.</p> : !th ? <Skeleton rows={6} /> : (<div>
          <button className="mb-2 text-xs text-cyan md:hidden" onClick={() => setOpen(null)}>← Inbox</button>
          <h3 className="mb-2 break-words text-base font-semibold leading-snug text-snow">{th.msgs[0]?.subject || "(no subject)"}</h3>
          <div className="space-y-3">{th.msgs.map(m => <article key={m.id} className="glass rounded-lg p-3">
            <header className="mb-2 flex flex-wrap items-baseline gap-x-2 text-xs"><span className="font-semibold text-snow">{fromName(m.from)}</span><span className="break-all text-slate">{fromAddr(m.from)}</span><span className="ml-auto text-ash">{m.date ? new Date(m.date).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}</span>
              <span className="w-full break-words text-slate">To {m.to}{m.cc ? ` · Cc ${m.cc}` : ""}</span></header>
            <Body m={m} />
            {th.atts.filter(a => a.message_id === m.id).length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{th.atts.filter(a => a.message_id === m.id).map(a => <li key={a.id}><button onClick={() => dl(a)} className="glass flex max-w-[16rem] items-center gap-1 rounded px-2 py-1 text-xs hover:border-cyan/50"><span>📎</span><span className="truncate">{a.filename}</span><span className="text-slate">{kb(a.size)}</span></button></li>)}</ul>}
          </article>)}</div>
          {tOut.length > 0 && <ul className="mt-3 space-y-1">{tOut.map(o => <li key={o.id} className="glass flex flex-wrap items-center gap-2 rounded px-3 py-1.5 text-xs">
            <span className={STAT[o.status][1]}>{STAT[o.status][0]}</span><span className="min-w-0 flex-1 truncate text-ash">to {o.to}: {o.body.slice(0, 80)}</span>
            {o.status === "failed" && o.error && <span className="w-full text-alert">{o.error}</span>}
            {o.status === "sent" && o.sent_at && <span className="text-slate">{when(o.sent_at)}</span>}
            {o.status === "queued" && <button className="text-ash underline hover:text-alert" onClick={() => cancelOut(o.id).then(() => { toast("Cancelled"); load(); }, e => toast((e as Error).message, "warn"))}>Cancel</button>}</li>)}</ul>}
          {last && <Composer key={(draft?.id ?? "") + last.id} base={last} draft={draft} onDone={load} />}
        </div>)}
      </section>
    </div>
  </div>);
}
