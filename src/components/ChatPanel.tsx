"use client";
import { useEffect, useRef, useState } from "react";
import { call, Routes, type ChatMessage, type ChatRequest, type ChatResponse } from "@/contracts/api";
import { sfx, speak, isMuted } from "@/lib/synth";
import { waitEscalation, escText } from "@/lib/escalation";
import { askPilot } from "@/lib/ask";
import type { Mood } from "./CrystalBot";

export default function ChatPanel({ mode, greeting, onMood, className = "" }: { mode: ChatRequest["mode"]; greeting: string; onMood?: (m: Mood) => void; className?: string }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([{ role: "assistant", content: greeting }]);
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [meta, setMeta] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); const q = text.trim(); if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }]; setMsgs(next); setText(""); setBusy(true); onMood?.("thinking"); sfx("click");
    try {
      const r = mode === "pilot" ? await askPilot(next.slice(1)) : await call<ChatRequest, ChatResponse>(Routes.chat, { mode, messages: next.slice(1) });
      setMsgs([...next, { role: "assistant", content: r.reply }]);
      if (r.escalation) { const id = r.escalation.id; const at = next.length; setMeta("escalated · queued");
        void waitEscalation(id, st => setMeta(`escalated · ${st}`)).then(x => { const a = escText(x); setMsgs(m => m.map((y, i) => i === at ? { ...y, content: `${a}` } : y)); setMeta(x.status === "answered" ? `escalated · answered${x.model ? ` · ${x.model.split("/").pop()}` : ""}` : "escalation failed"); sfx(x.status === "answered" ? "chirp" : "error"); if (x.status === "answered" && !isMuted()) speak(a.replace(/\[source:[^\]]*\]/g, "").slice(0, 400)); }); return; } setMeta(r.model === "grounded-db" ? "your synced data (no AI)" : r.provider === "workers-ai" ? `Workers AI · ${r.model.split("/").pop()}` : r.provider); onMood?.("happy"); sfx("chirp");
    } catch { setMsgs([...next, { role: "assistant", content: "Signal lost. Try again?" }]); onMood?.("alert"); sfx("error"); }
    finally { setBusy(false); setTimeout(() => onMood?.("idle"), 1800); }
  }
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 ${m.role === "user" ? "ml-auto bg-cyan/15 text-snow" : "bg-navy-2/80 text-ice border border-cyan/15"}`}>{m.content}</div>
        ))}
        {busy && <div className="text-xs text-slate">Crystal is thinking…</div>}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-cyan/15 p-2">
        <input className="input text-sm" value={text} onChange={e => setText(e.target.value)} placeholder="Ask Crystal anything…" aria-label="Message Crystal" maxLength={1000} />
        <button className="btn btn-primary px-3 text-sm" disabled={busy}>Send</button>
      </form>
      {meta && <div className="px-3 pb-1 text-[10px] text-slate">via {meta}</div>}
    </div>
  );
}
