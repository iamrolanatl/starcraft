"use client";
import { useEffect, useState } from "react";
import type { AppId } from "@/contracts/api";
import { sfx, isMuted, setMuted } from "@/lib/synth";
import CrystalBot, { type Mood } from "@/components/CrystalBot";
import { DefconMeter, StatusBars } from "./Ops";
import { haptic } from "@/lib/synth";

export interface Ability { id: string; icon: string; label: string; cooldown: number; run: () => void }
export interface Squad { id: AppId; label: string; status: "ok" | "warn" | "off"; detail: string }
export interface Contact { label: string; sector: number; hot?: boolean }
export interface FeedItem { t: number; text: string; tone?: "info" | "ok" | "warn" }

export interface Blip { label: string; days: number | null; hot: boolean }
// 360 radar: each blip is a real task; distance from center = days until due (overdue at core), red = overdue/hot.
export function Radar({ blips, alert, items = [], pulse = 0 }: { blips: number; alert: boolean; items?: Blip[]; pulse?: number }) {
  const c = alert ? "#ff3b5c" : "#3ef2e0";
  const pts = items.slice(0, 24).map((b, i) => { const a = (i * 137.5) * Math.PI / 180, r = b.days == null ? 44 : Math.max(6, Math.min(44, 8 + b.days * 5)); return { ...b, x: 50 + r * Math.cos(a), y: 50 + r * Math.sin(a), ang: ((i * 137.5) % 360) }; });
  return (
    <div className="relative aspect-square h-full" role="img" aria-label={`Radar: ${blips} open tasks, ${items.filter(i => i.hot).length} overdue`}>
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle cx="50" cy="50" r="48" fill="rgba(6,11,26,.75)" stroke={c} strokeOpacity=".5" />
        {[12, 24, 36].map(r => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={c} strokeOpacity=".18" strokeDasharray={r === 24 ? "1 2" : undefined} />)}
        <line x1="2" y1="50" x2="98" y2="50" stroke={c} strokeOpacity=".15" /><line x1="50" y1="2" x2="50" y2="98" stroke={c} strokeOpacity=".15" />
        {pulse > 0 && <circle key={pulse} cx="50" cy="50" r="2" fill="none" stroke={c} strokeWidth="1.5"><animate attributeName="r" from="2" to="48" dur="1.4s" fill="freeze" /><animate attributeName="opacity" from="1" to="0" dur="1.4s" fill="freeze" /></circle>}
        {pts.map((p, i) => <g key={i}><title>{p.label}{p.days != null ? ` · ${p.days < 0 ? `${-p.days}d overdue` : p.days === 0 ? "due today" : `in ${p.days}d`}` : ""}</title>
          {p.hot && <circle cx={p.x} cy={p.y} r="1" fill="none" stroke="#ff3b5c" className="blip-ring" style={{ animationDelay: `${i * .2}s` }} />}
          <circle cx={p.x} cy={p.y} r={p.hot ? 2.6 : 2} fill={p.hot ? "#ff3b5c" : i === 0 ? "#7dffc8" : c} style={{ animation: `glow 4s ${(p.ang / 360) * 4}s infinite` }} /></g>)}
      </svg>
      <div className="animate-sweep absolute inset-[2%] rounded-full" style={{ background: `conic-gradient(from 0deg, ${c}88, transparent 25%)` }} />
    </div>
  );
}

export function AbilityGrid({ abilities }: { abilities: Ability[] }) {
  const [cd, setCd] = useState<Record<string, number>>({}); const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(i); }, []);
  const fire = (a: Ability) => { if ((cd[a.id] || 0) > Date.now()) { sfx("error"); haptic(40); return; } sfx("click"); haptic(10); a.run(); if (a.cooldown) setCd(c => ({ ...c, [a.id]: Date.now() + a.cooldown * 1000 })); };
  useEffect(() => { const h = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return; const n = Number(e.key); if (n >= 1 && n <= 9 && abilities[n - 1]) { e.preventDefault(); fire(abilities[n - 1]); } }; addEventListener("keydown", h); return () => removeEventListener("keydown", h); });
  return (
    <div className="grid h-full grid-cols-3 gap-1" role="toolbar" aria-label="Command matrix">
      {abilities.slice(0, 9).map((a, idx) => {
        const until = cd[a.id] || 0; const left = Math.max(0, until - now); const pct = a.cooldown ? left / (a.cooldown * 1000) : 0;
        return (
          <button key={a.id} title={`${a.label} (${idx + 1})`} aria-label={a.label} disabled={left > 0}
            onClick={() => fire(a)} onMouseEnter={() => sfx("hover")}
            className="relative flex flex-col items-center justify-center overflow-hidden rounded-md border border-cyan/25 bg-navy-2/70 text-cyan transition hover:border-cyan hover:bg-cyan/10 hover:shadow-[0_0_12px_rgba(62,242,224,.4)] disabled:cursor-wait">
            <span className="text-base leading-none sm:text-lg">{a.icon}</span>
            <span className="hidden text-[9px] uppercase tracking-wider text-ash sm:block">{a.label}</span>
            <span className="absolute left-0.5 top-0 font-mono text-[8px] text-slate">{idx + 1}</span>
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

export function TacticalFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-mint/20 bg-navy/60 p-2 font-mono text-[10px] leading-snug" aria-label="Tactical feed">
      <div className="hud-label mb-1 !text-[9px]">Tactical feed</div>
      <div className="flex-1 overflow-y-auto">{items.map(i => <div key={i.t} className={i.tone === "warn" ? "text-alert" : i.tone === "ok" ? "text-mint" : "text-ice/80"}>▸ {i.text}</div>)}{!items.length && <div className="text-slate">No contacts.</div>}</div>
    </div>
  );
}

export function CommFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-cyan/20 bg-navy/60 p-2 font-mono text-[10px] leading-snug" aria-live="polite" aria-label="Comm feed">
      <div className="hud-label mb-1 !text-[9px]">Comm feed</div>
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

export function TacticalRadar({ contacts, alert }: { contacts: Contact[]; alert: boolean }) {
  const c = alert ? "#ff3b5c" : "#7dffc8"; const SECT = ["HOME", "HLTH", "COMM", "EDU", "FIN", "SHOP"];
  return (
    <div className="relative aspect-square h-full" role="img" aria-label={`Tactical radar: ${contacts.length} contacts across modules`}>
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <rect x="2" y="2" width="96" height="96" rx="8" fill="rgba(6,11,26,.7)" stroke={c} strokeOpacity=".45" />
        {SECT.map((l, i) => { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; return <g key={l}><line x1="50" y1="50" x2={50 + 46 * Math.cos(a)} y2={50 + 46 * Math.sin(a)} stroke={c} strokeOpacity=".15" /><text x={50 + 38 * Math.cos(a + Math.PI / 6)} y={50 + 38 * Math.sin(a + Math.PI / 6) + 2} fontSize="6" fill={c} fillOpacity=".55" textAnchor="middle" fontFamily="monospace">{l}</text></g>; })}
        <polygon points="50,47 53,53 47,53" fill={c} />
        {contacts.slice(0, 24).map((k, i) => { const a = ((k.sector + .2 + ((i * 37) % 60) / 100) / 6) * Math.PI * 2 - Math.PI / 2, r = 12 + ((i * 13) % 26); return <rect key={i} x={50 + r * Math.cos(a) - 1.8} y={50 + r * Math.sin(a) - 1.8} width="3.6" height="3.6" fill={k.hot ? "#ff3b5c" : c} className="animate-glow" style={{ animationDelay: `${i * .2}s` }}><title>{k.label}</title></rect>; })}
      </svg>
      <div className="animate-sweep absolute inset-[6%] rounded-full opacity-60" style={{ background: `conic-gradient(from 90deg, ${c}55, transparent 18%)` }} />
    </div>
  );
}

export function PilotView({ name, mood, onClick, alert }: { name: string; mood: Mood; onClick: () => void; alert: boolean }) {
  return (
    <div className={`relative flex h-full w-[76px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-md border ${alert ? "border-alert/60" : "border-cyan/25"} bg-navy/70 scanlines`} aria-label="Pilot view">
      <span className="hud-label absolute left-1 top-0.5 !text-[7px]">Pilot</span>
      <CrystalBot size={48} mood={mood} onClick={onClick} label="Pilot view: Crystal" />
      <span className="max-w-full truncate px-1 text-[9px] text-ice">{name}</span>
      <span className={`text-[8px] font-mono ${alert ? "text-alert" : "text-mint"}`}>{alert ? "DEFCON 1" : "SHIELDS 100%"}</span>
    </div>
  );
}

export function SquadStatus({ squad, onOpen }: { squad: Squad[]; onOpen: (id: AppId) => void }) {
  return (
    <div className="flex h-full w-[150px] shrink-0 flex-col rounded-md border border-cyan/20 bg-navy/60 p-1.5" aria-label="Squad status">
      <div className="hud-label mb-0.5 !text-[8px]">Squad status</div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto">{squad.map(q => (
        <li key={q.id}><button onClick={() => onOpen(q.id)} className="flex w-full items-center gap-1.5 rounded px-1 text-left text-[10px] hover:bg-cyan/10">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${q.status === "ok" ? "bg-mint shadow-[0_0_6px_#7dffc8]" : q.status === "warn" ? "bg-alert shadow-[0_0_6px_#ff3b5c] animate-glow" : "bg-slate"}`} />
          <span className="w-12 shrink-0 text-ice">{q.label}</span><span className="truncate text-slate">{q.detail}</span></button></li>))}</ul>
    </div>
  );
}

export function HudBar({ abilities, feed, blips, alert, onAlert, onHome, onLogout, open, onRestore, pilot, mood, onPilot, squad, contacts, tactical, radar, pulse, defcon, bars, feedsMuted }: {
  abilities: Ability[]; feed: FeedItem[]; blips: number; alert: boolean; onAlert: () => void; onHome: () => void; onLogout: () => void;
  pilot: string; mood: Mood; onPilot: () => void; squad: Squad[]; contacts: Contact[]; tactical: FeedItem[];
  radar: Blip[]; pulse: number; defcon: { level: number; reasons: string[] }; bars: { shields: number; hull: number; energy: number; labels: [string, string, string] }; feedsMuted: boolean;
  open: { id: AppId; title: string; minimized: boolean }[]; onRestore: (id: AppId) => void;
}) {
  const [muted, setM] = useState(false); useEffect(() => setM(isMuted()), []);
  return (
    <nav data-safe-bottom aria-label="Cockpit HUD" className="glass fixed inset-x-0 bottom-0 z-30 !rounded-none border-x-0 border-b-0 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan to-transparent animate-glow" />
      {open.some(o => o.minimized) && (
        <div className="mb-1 flex gap-1 overflow-x-auto">{open.filter(o => o.minimized).map(o => <button key={o.id} onClick={() => onRestore(o.id)} className="rounded border border-cyan/30 px-2 py-0.5 text-[10px] text-cyan hover:bg-cyan/10">▣ {o.title}</button>)}</div>
      )}
      <div className="mx-auto flex h-[112px] max-w-[1600px] items-stretch gap-2 sm:h-[132px]">
        <div className="flex min-w-0 flex-1 snap-x items-stretch gap-2 overflow-x-auto [scrollbar-width:none]" aria-label="HUD panels (swipe on mobile)">
          <div className="snap-start"><DefconMeter level={defcon.level} reasons={defcon.reasons} manual={defcon.reasons[0] === "Manual red alert"} /></div>
          <div className="snap-start"><PilotView name={pilot} mood={mood} onClick={onPilot} alert={alert} /></div>
          <div className="flex snap-start flex-col items-center gap-1"><div className="h-[84px] sm:h-[104px]"><Radar blips={blips} alert={alert} items={radar} pulse={pulse} /></div><span className="hud-label !text-[8px]">360 · {blips} tgt</span></div>
          <div className="w-[132px] shrink-0 snap-start sm:w-[200px]"><AbilityGrid abilities={abilities} /></div>
          <div className="flex snap-start flex-col items-center gap-1"><div className="h-[84px] sm:h-[104px]"><TacticalRadar contacts={contacts} alert={alert} /></div><span className="hud-label !text-[8px]">Tactical · {contacts.length}</span></div>
          <div className="snap-start"><StatusBars {...bars} /></div>
          <div className="snap-start"><SquadStatus squad={squad} onOpen={onRestore} /></div>
          <div className="w-[220px] shrink-0 snap-start lg:w-auto lg:min-w-[180px] lg:flex-1"><TacticalFeed items={feedsMuted ? [{ t: 1, text: "Feeds muted: battle stations", tone: "info" }] : tactical} /></div>
          <div className="w-[220px] shrink-0 snap-start lg:w-auto lg:min-w-[180px] lg:flex-1"><CommFeed items={feedsMuted ? [] : feed} /></div>
        </div>
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
