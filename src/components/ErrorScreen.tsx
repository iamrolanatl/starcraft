"use client";
// Crystal's styled error pages (401/403/404/429/500/502/503/crash) with a "Talk to support" chat that queues a ticket for Rolan.
import { useEffect, useRef, useState } from "react";
import { sb } from "@/lib/supabase";

type Info = { title: string; msg: string; icon: string; hue: string };
export const ERRORS: Record<string, Info> = {
  "401": { title: "Sign-in needed", msg: "Your session ended or you're not signed in yet. Sign in again and you'll be right back.", icon: "🔑", hue: "#ffd166" },
  "403": { title: "Access denied", msg: "This area is locked for your account. If you think you should have access, ask the family owner or talk to support below.", icon: "🛡", hue: "#ff9f5a" },
  "404": { title: "Page not found", msg: "That page drifted out of range. Check the address, or head home.", icon: "🛰", hue: "#7cc8ff" },
  "429": { title: "Slow down, pilot", msg: "Too many requests in a short time. Wait about a minute, then try again.", icon: "⏳", hue: "#ffd166" },
  "500": { title: "Crystal hit a snag", msg: "Something broke on our side. Your data is safe. Try again in a moment.", icon: "⚠", hue: "#ff6b7a" },
  "502": { title: "Signal lost upstream", msg: "A service Crystal depends on didn't answer. This is usually brief, so try again shortly.", icon: "📡", hue: "#ff6b7a" },
  "503": { title: "Down for maintenance", msg: "Crystal is temporarily unavailable. Please try again in a few minutes.", icon: "🛠", hue: "#c39bff" },
  error: { title: "Crystal lost signal", msg: "Something unexpected happened. Your data is safe.", icon: "🛰", hue: "#3ef2e0" },
};

type Msg = { role: "user" | "assistant"; content: string; at?: string };
const TK = "crystal-support-ticket";

export default function ErrorScreen({ code, detail, onRetry, chatOpen = false }: { code: string; detail?: string; onRetry?: () => void; chatOpen?: boolean }) {
  const info = ERRORS[code] ?? ERRORS.error; const [open, setOpen] = useState(chatOpen);
  useEffect(() => { document.title = `${/^\d+$/.test(code) ? code + " · " : ""}${info.title} · Crystal`; }, [code, info.title]);
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-navy p-4 text-ice" style={{ ["--hue" as string]: info.hue }}>
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(60% 50% at 50% 20%, ${info.hue}22, transparent 70%), radial-gradient(40% 40% at 80% 90%, #3ef2e014, transparent 70%)` }} />
      <div className={`relative grid w-full gap-4 ${open ? "max-w-5xl md:grid-cols-[1fr_1.1fr]" : "max-w-lg"}`}>
        <section className="glass rounded-2xl p-6 text-center sm:p-8" role="alert" aria-live="assertive">
          <div className="text-5xl" aria-hidden>{info.icon}</div>
          {/^\d+$/.test(code) && <div className="mt-2 font-mono text-6xl font-bold tracking-widest" style={{ color: info.hue, textShadow: `0 0 18px ${info.hue}99, 0 0 42px ${info.hue}44` }}>{code}</div>}
          <h1 className="neon mt-2 text-2xl font-semibold">{info.title}</h1>
          <p className="mx-auto mt-3 max-w-sm text-base leading-relaxed text-ice/90">{info.msg}</p>
          {detail && <p className="mx-auto mt-2 max-w-sm break-words font-mono text-xs text-ice/50">{detail.slice(0, 160)}</p>}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary" onClick={() => (onRetry ? onRetry() : location.reload())}>↻ Try again</button>
            {code === "401" && <a className="btn btn-ghost" href="/app/">Sign in</a>}
            <a className="btn btn-ghost" href="/">⌂ Home</a>
            <button className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}>💬 {open ? "Hide support" : "Talk to support"}</button>
          </div>
        </section>
        {open && <SupportChat code={code} />}
      </div>
    </main>);
}

export function SupportChat({ code }: { code: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: "Hi, I'm Crystal Support. Tell me what you were trying to do, and I'll help and add this to Rolan's support queue." }]);
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  const [who, setWho] = useState<{ name: string; email: string; signed: boolean }>({ name: "", email: "", signed: false });
  const ticket = useRef<{ id: string; secret: string } | null>(null); const end = useRef<HTMLDivElement>(null); const token = useRef<string | undefined>(undefined);
  useEffect(() => { (async () => { try { const { data } = await sb().auth.getSession(); const s = data.session; if (s) { token.current = s.access_token; const m = s.user.user_metadata || {}; setWho({ name: String(m.full_name || m.name || ""), email: s.user.email || "", signed: true }); } } catch { /* anonymous */ } })(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);
  const send = async () => {
    const t = text.trim().slice(0, 1500); if (!t || busy) return;
    const next = [...msgs, { role: "user" as const, content: t, at: new Date().toISOString() }]; setMsgs(next); setText(""); setBusy(true);
    try {
      const r = await fetch("/api/support", { method: "POST", headers: { "content-type": "application/json", ...(token.current ? { authorization: `Bearer ${token.current}` } : {}) },
        body: JSON.stringify({ messages: next.slice(1), code, url: location.pathname + location.search, ticket: ticket.current, name: who.signed ? undefined : who.name, email: who.signed ? undefined : who.email }) });
      const j = await r.json().catch(() => ({})) as { reply?: string; ticket?: { id: string; secret: string }; queued?: boolean; error?: string };
      if (r.status === 429) { setMsgs(m => [...m, { role: "assistant", content: "That's a lot of messages at once. Give me a minute, then try again." }]); return; }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.ticket) { ticket.current = j.ticket; try { sessionStorage.setItem(TK, JSON.stringify(j.ticket)); } catch {} }
      setMsgs(m => [...m, { role: "assistant", content: j.reply || "Noted." }]);
      setStatus(j.queued ? `In the support queue · ticket ${j.ticket?.id.slice(0, 8)} · Rolan has been emailed` : "Logged for Rolan (queue offline right now)");
    } catch { setMsgs(m => [...m, { role: "assistant", content: "I couldn't reach the support desk. Check your connection and try again." }]); }
    finally { setBusy(false); }
  };
  return (
    <section className="glass flex max-h-[80dvh] min-h-[420px] flex-col rounded-2xl p-4" aria-label="Support chat">
      <header className="flex items-center justify-between border-b border-cyan/15 pb-2">
        <h2 className="neon text-lg font-semibold">💬 Crystal Support</h2>
        <span className="text-xs text-ice/60">{who.signed ? `Signed in${who.name ? ` as ${who.name.split(" ")[0]}` : ""}` : "Guest"}</span>
      </header>
      {!who.signed && <div className="mt-2 grid grid-cols-2 gap-2">
        <input aria-label="Your name (optional)" className="rounded-lg border border-cyan/20 bg-black/30 px-3 py-2 text-sm" placeholder="Name (optional)" maxLength={60} value={who.name} onChange={e => setWho(w => ({ ...w, name: e.target.value }))} />
        <input aria-label="Email for a reply (optional)" type="email" className="rounded-lg border border-cyan/20 bg-black/30 px-3 py-2 text-sm" placeholder="Email for a reply (optional)" maxLength={200} value={who.email} onChange={e => setWho(w => ({ ...w, email: e.target.value }))} />
      </div>}
      <div className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1" role="log" aria-live="polite">
        {msgs.map((m, i) => <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[15px] leading-snug ${m.role === "user" ? "ml-auto bg-cyan/15 text-ice" : "border border-cyan/15 bg-black/30 text-ice/90"}`}>{m.content}</div>)}
        {busy && <div className="w-fit rounded-xl border border-cyan/15 bg-black/30 px-3 py-2 text-sm text-ice/60">Crystal is typing…</div>}
        <div ref={end} />
      </div>
      {status && <p className="mt-2 text-xs text-[#7dffc8]">✓ {status}</p>}
      <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); send(); }}>
        <input aria-label="Message" className="flex-1 rounded-lg border border-cyan/25 bg-black/30 px-3 py-2" placeholder="Describe what happened…" maxLength={1500} value={text} onChange={e => setText(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>);
}
