"use client";
import { useEffect, useState } from "react";
import CrystalBot from "@/components/CrystalBot";
import { sfx } from "@/lib/synth";
const STEPS: { sel: string; title: string; body: string }[] = [
  { sel: "", title: "Welcome aboard, pilot!", body: "I'm Crystal, your co-pilot. Quick 30-second tour of the cockpit?" },
  { sel: 'input[aria-label="Command bar"]', title: "Talk to me", body: "Type plain English: “add milk to shopping list”, “log 8000 steps”, “bill: water $45 friday”. Press ⌘K / Ctrl-K anywhere for the command palette." },
  { sel: '[aria-label="Command matrix"]', title: "Ability grid", body: "Nine abilities with cooldowns. Keys 1–9 fire them." },
  { sel: '[aria-label^="Radar"]', title: "Radar", body: "Every blip is a real open task; red blips are overdue. The tactical radar maps bills, meds, mail and more by sector." },
  { sel: '[aria-label="Modules"]', title: "Modules", body: "Health, Comms, Education, Finance, Shopping, OCR. Drag windows by their title bar and resize from the corner. On phones they open as sheets." },
  { sel: 'button[aria-pressed]', title: "Red Alert", body: "DEFCON 1 filters to overdue and high-priority missions. Shift+A toggles it. Press ? for all shortcuts." },
];
export default function Tour({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [i, setI] = useState(0); const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => { if (!open) return; const s = STEPS[i].sel; const el = s ? document.querySelector(s) : null; if (el) { el.scrollIntoView({ block: "nearest" }); setBox(el.getBoundingClientRect()); } else setBox(null); }, [i, open]);
  if (!open) return null;
  const st = STEPS[i]; const last = i === STEPS.length - 1;
  const end = () => { try { localStorage.setItem("crystal-tour", "done"); } catch {} setI(0); onDone(); sfx("success"); };
  const pos = box ? { top: Math.min(innerHeight - 220, box.bottom + 12 > innerHeight - 200 ? Math.max(8, box.top - 200) : box.bottom + 12), left: Math.max(8, Math.min(innerWidth - 340, box.left)) } : { top: innerHeight / 2 - 110, left: innerWidth / 2 - 165 };
  return (<div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Onboarding tour">
    <div className="absolute inset-0 bg-navy/70" style={box ? { clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 ${box.top - 6}px,${box.left - 6}px ${box.top - 6}px,${box.left - 6}px ${box.bottom + 6}px,${box.right + 6}px ${box.bottom + 6}px,${box.right + 6}px ${box.top - 6}px,0 ${box.top - 6}px)` } : undefined} />
    {box && <div className="pointer-events-none absolute rounded-xl neon-border" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12, transition: "all .35s cubic-bezier(.2,.9,.3,1)" }} />}
    <div key={i} className="win-in glass neon-frame absolute w-[330px] max-w-[calc(100vw-16px)] rounded-2xl p-4" style={{ ...pos, transition: "top .35s, left .35s" }}>
      <div className="flex gap-3"><CrystalBot size={52} mood={i === 0 ? "wave" : "happy"} label="Crystal" /><div><div className="hud-label">Tour {i + 1}/{STEPS.length}</div><h3 className="font-semibold text-snow">{st.title}</h3></div></div>
      <p className="mt-2 text-sm text-ice">{st.body}</p>
      <div className="mt-3 flex items-center gap-2"><button className="text-xs text-slate hover:text-snow" onClick={end}>Skip</button><span className="flex-1" />
        {i > 0 && <button className="btn btn-ghost !py-1 text-xs" onClick={() => { setI(i - 1); sfx("click"); }}>Back</button>}
        <button autoFocus className="btn btn-primary !py-1 text-xs" onClick={() => { if (last) end(); else { setI(i + 1); sfx("click"); } }}>{last ? "Launch!" : "Next"}</button></div>
    </div></div>);
}
