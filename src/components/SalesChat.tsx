"use client";
import { useState } from "react";
import CrystalBot, { type Mood } from "./CrystalBot";
import ChatPanel from "./ChatPanel";
import { sfx } from "@/lib/synth";
export default function SalesChat() {
  const [open, setOpen] = useState(false); const [mood, setMood] = useState<Mood>("idle");
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {open && (
        <div className="glass flex h-[min(480px,70dvh)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl" role="dialog" aria-label="Chat with Crystal">
          <div className="flex items-center justify-between border-b border-cyan/15 px-3 py-2">
            <span className="neon text-sm font-semibold">Crystal · Sales Support</span>
            <button onClick={() => { setOpen(false); sfx("close"); }} aria-label="Close chat" className="text-ash hover:text-cyan">✕</button>
          </div>
          <ChatPanel mode="sales" onMood={setMood} className="min-h-0 flex-1" greeting="Hi! I'm Crystal 🤖✨ Ask me anything about the cockpit — features, privacy, or how to get started." />
        </div>
      )}
      <div className="flex items-end gap-2">
        {!open && <span className="glass hidden rounded-xl px-3 py-2 text-xs sm:block">Questions? Ask me!</span>}
        <CrystalBot size={64} mood={open ? mood : "wave"} onClick={() => { setOpen(o => !o); sfx("open"); }} label={open ? "Close sales chat" : "Open sales chat with Crystal"} />
      </div>
    </div>
  );
}
