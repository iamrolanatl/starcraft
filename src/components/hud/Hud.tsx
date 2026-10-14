"use client";
import { useEffect, useState } from "react";
import type { AppId } from "@/contracts/api";
import { sfx, isMuted, setMuted } from "@/lib/synth";

export interface Ability { id: string; icon: string; label: string; cooldown: number; run: () => void }
export interface FeedItem { t: number; text: string; tone?: "info" | "ok" | "warn" }

export function Radar({ blips, alert }: { blips: number; alert: boolean }) {
  const pts = Array.from({ length: Math.min(blips, 12) }, (_, i) => { const a = (i * 137.5) * Math.PI / 180, r = 18 + ((i * 29) % 22); return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; });
  const c = alert ? "#ff3b5c" : "#3ef2e0";
  return (
    <div className="relative aspect-square h-full" role="img" aria-label={`Radar: ${blips} open tasks`}>
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle cx="50" cy="50" r="48" fill="rgba(6,11,26,.7)" stroke={c} strokeOpacity=".5" />
        {[16, 32].map(r => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={c} strokeOpacity=".2" />)}
        <line x1="2" y1="50" x2="98" y2="50" stroke={c} strokeOpacity=".15" /><line x1="50" y1="2" x2="50" y2="98" stroke={c} strokeOpacity=".15" />
        {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.2" fill={i === 0 ? "#7dffc8" : c} className="animate-glow" style={{ animationDelay: `${i * .3}s` }} />)}
      </svg>
      <div className="animate-sweep absolute inset-[2%] rounded-full" style={{ background: `conic-gradient(from 0deg, ${c}88, transparent 25%)` }} />
    </div>
  );
}

export function AbilityGrid({ abilities }: { abilities: Ability[] }) {
  const [cd, setCd] = useState<Record<string, number>>({}); const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(i); }, []);
  return (
    <div className="grid h-full grid-cols-3 gap-1" role="toolbar" aria-label="Command matrix">
      {abilities.slice(0, 9).map((a, idx) => {
        const until = cd[a.id] || 0; const left = Math.max(0, until - now); const pct = a.cooldown ? left / (a.cooldown * 1000) : 0;
        return (
          <button key={a.id} title={`${a.label} (${idx + 1})`} aria-label={a.label} disabled={left > 0}
            onClick={() => { a.run(); if (a.cooldown) setCd(c => ({ ...c, [a.id]: Date.now() + a.cooldown * 1000 })); }}
            className="relative flex flex-col items-center justify-center overflow-hidden rounded-md border border-cyan/25 bg-navy-2/70 text-cyan transition hover:border-cyan hover:bg-cyan/10 hover:shadow-[0_0_12px_rgba(62,242,224,.4)] disabled:cursor-wait">
            <span className="text-base leading-none sm:text-lg">{a.icon}</span>
            <span className="hidden text-[9px] uppercase tracking-wider text-ash sm:block">{a.label}</span>
            {left > 0 && (<>
              <span className="absolute inset-0" style={{ background: `conic-gradient(rgba(6,11,26,.8) ${pct * 360}deg, transparent 0)` }} />
              <span className="absolute font-mono text-xs text-snow">{Math.ceil(left / 1000)}</span>
            </>)}
          </button>
        );
      })}
    </div>
  );
}

export function CommFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-cyan/20 bg-navy/60 p-2 font-mono text-[10px] leading-snug" aria-live="polite" aria-label="Tactical comm feed">
      <div className="hud-label mb-1 !text-[9px]">Tactical comm feed</div>
      <div className="flex flex-1 flex-col-reverse overflow-y-auto">
        {items.slice(-30).reverse().map(i => (
          <div key={i.t} className={i.tone === "warn" ? "text-alert" : i.tone === "ok" ? "text-mint" : "text-ice/80"}>
            <span className="text-slate">{new Date(i.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span> {i.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HudBar({ abilities, feed, blips, alert, onAlert, onHome, onLogout, open, onRestore }: {
  abilities: Ability[]; feed: FeedItem[]; blips: number; alert: boolean; onAlert: () => void; onHome: () => void; onLogout: () => void;
  open: { id: AppId; title: string; minimized: boolean }[]; onRestore: (id: AppId) => void;
}) {
  const [muted, setM] = useState(false); useEffect(() => setM(isMuted()), []);
  return (
    <nav aria-label="Cockpit HUD" className="glass fixed inset-x-0 bottom-0 z-30 !rounded-none border-x-0 border-b-0 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan to-transparent animate-glow" />
      {open.some(o => o.minimized) && (
        <div className="mb-1 flex gap-1 overflow-x-auto">{open.filter(o => o.minimized).map(o => <button key={o.id} onClick={() => onRestore(o.id)} className="rounded border border-cyan/30 px-2 py-0.5 text-[10px] text-cyan hover:bg-cyan/10">▣ {o.title}</button>)}</div>
      )}
      <div className="mx-auto flex h-[112px] max-w-7xl items-stretch gap-2 sm:h-[132px]">
        <div className="flex flex-col items-center gap-1"><div className="h-[84px] sm:h-[104px]"><Radar blips={blips} alert={alert} /></div><span className="hud-label !text-[8px]">{blips} targets</span></div>
        <div className="w-[132px] shrink-0 sm:w-[200px]"><AbilityGrid abilities={abilities} /></div>
        <div className="hidden min-w-0 flex-1 md:block"><CommFeed items={feed} /></div>
        <div className="ml-auto flex shrink-0 flex-col justify-between gap-1">
          <button onClick={onHome} className="btn btn-ghost !px-3 !py-1.5 text-xs" aria-label="Return home">⌂ Home</button>
          <button onClick={onAlert} aria-pressed={alert} className={`btn !px-3 !py-1.5 text-xs font-bold ${alert ? "bg-alert text-white shadow-[0_0_18px_#ff3b5c]" : "border border-alert/60 text-alert"}`}>{alert ? "DEFCON 1" : "Red Alert"}</button>
          <div className="flex gap-1">
            <button onClick={() => { setMuted(!muted); setM(!muted); if (muted) sfx("ping"); }} aria-label={muted ? "Unmute sounds" : "Mute sounds"} className="btn btn-ghost flex-1 !px-2 !py-1.5 text-xs">{muted ? "🔇" : "🔊"}</button>
            <button onClick={onLogout} className="btn btn-ghost flex-1 !px-2 !py-1.5 text-xs" aria-label="Log out">⏻</button>
          </div>
        </div>
      </div>
    </nav>
  );
}
