"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { sfx } from "@/lib/synth";
export interface PaletteAction { id: string; label: string; icon: string; hint?: string; run: () => void }
export default function CommandPalette({ open, onClose, actions, onFreeText }: { open: boolean; onClose: () => void; actions: PaletteAction[]; onFreeText: (t: string) => void }) {
  const [q, setQ] = useState(""); const [i, setI] = useState(0); const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => inp.current?.focus(), 10); sfx("palette"); } }, [open]);
  const list = useMemo(() => { const s = q.toLowerCase().trim(); const m = s ? actions.filter(a => (a.label + " " + (a.hint || "")).toLowerCase().includes(s)) : actions; return s ? [...m, { id: "__nl", label: `Ask Crystal: “${q}”`, icon: "🤖", hint: "natural language", run: () => onFreeText(q) }] : m; }, [q, actions, onFreeText]);
  if (!open) return null;
  const go = (a: PaletteAction) => { onClose(); sfx("click"); a.run(); };
  return (<div className="fade-in fixed inset-0 z-[70] flex items-start justify-center bg-navy/60 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
    <div role="dialog" aria-modal="true" aria-label="Command palette" className="win-in glass neon-frame w-full max-w-xl overflow-hidden rounded-2xl" onMouseDown={e => e.stopPropagation()}>
      <div className="flex items-center gap-2 border-b border-cyan/20 px-4 py-3"><span className="neon">⌘</span>
        <input ref={inp} value={q} onChange={e => { setQ(e.target.value); setI(0); }} placeholder="Type a command, module, or ask Crystal…" aria-label="Command palette search" className="flex-1 bg-transparent text-snow outline-none placeholder:text-slate"
          onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); setI(x => Math.min(list.length - 1, x + 1)); sfx("hover"); } else if (e.key === "ArrowUp") { e.preventDefault(); setI(x => Math.max(0, x - 1)); sfx("hover"); } else if (e.key === "Enter" && list[i]) go(list[i]); else if (e.key === "Escape") onClose(); }} />
        <kbd className="rounded border border-slate/50 px-1.5 text-[10px] text-slate">ESC</kbd></div>
      <ul role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">{list.map((a, k) => (
        <li key={a.id} role="option" aria-selected={k === i}><button onMouseEnter={() => setI(k)} onClick={() => go(a)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${k === i ? "bg-cyan/15 text-cyan" : "text-ice"}`}>
          <span className="w-5 text-center">{a.icon}</span><span className="flex-1">{a.label}</span>{a.hint && <span className="text-[10px] uppercase tracking-wider text-slate">{a.hint}</span>}</button></li>))}
        {!list.length && <li className="px-3 py-4 text-center text-sm text-slate">No matches.</li>}</ul>
    </div></div>);
}
