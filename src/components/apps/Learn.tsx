"use client";
import { useEffect, useState } from "react";
import { loadLearn, type LearnData, type LearnRes, type LearnUnit } from "@/lib/learn";

const GROUPS = ["Videos", "Practice/Games", "Readings", "Cobb resources"] as const;
const ORDER = ["Math 7", "Science 7", "Social Studies 7", "Language Arts 7", "Reading 7", "Chorus 7", "Phys Ed 7", "PLTW Design & Modeling"];
const conf = (c: string) => c.startsWith("high") ? "text-emerald-300 border-emerald-400/40" : c.startsWith("medium") ? "text-amber-200 border-amber-300/40" : "text-ash border-ash/30";
const fmtD = (s: string) => new Date(s.length === 10 ? s + "T12:00" : s).toLocaleDateString([], { month: "short", day: "numeric" });

function Links({ items }: { items: LearnRes[] }) {
  return <ul className="space-y-1">{items.map(r => <li key={r.url}>
    <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 rounded-md bg-navy-2/60 px-2 py-1.5 text-[13px] leading-snug text-snow hover:bg-navy-2 focus-visible:outline focus-visible:outline-cyan">
      <span className="min-w-0 flex-1 break-words">{r.title} <span aria-hidden className="text-cyan">↗</span></span>
      <span className="shrink-0 rounded border border-cyan/30 px-1 text-[10px] text-cyan" title={`Link checked ${fmtD(r.verified_at)}`}>{r.source}</span>
    </a></li>)}</ul>;
}

function ClassCard({ u, res, shared }: { u: LearnUnit; res: LearnRes[]; shared: LearnRes[] }) {
  const [open, setOpen] = useState(false);
  const prep = res.filter(r => r.for_assignment);
  const week = res.filter(r => !r.for_assignment && (r.type === "Videos" || r.type === "Practice/Games")).slice(0, 3);
  const all = [...res, ...shared];
  const inactive = u.status === "done" || u.status === "unknown";
  return <section className={`rounded-xl border ${inactive ? "border-ash/20" : "border-cyan/25"} bg-navy/70 backdrop-blur`}>
    <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-start gap-2 px-3 py-2.5 text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-snow">{u.class_name} <span className="font-normal text-ash">· {u.teacher}</span></span>
        <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[13px] leading-snug ${inactive ? "text-ash" : "bg-cyan/15 text-cyan ring-1 ring-cyan/40"}`}>{u.status === "current" ? "▶ Now: " : ""}{u.unit}</span>
      </span>
      <span className={`shrink-0 rounded border px-1 text-[10px] ${conf(u.confidence)}`}>{u.confidence}</span>
      <span aria-hidden className="shrink-0 text-ash">{open ? "▾" : "▸"}</span>
    </button>
    {open && <div className="space-y-3 border-t border-cyan/10 px-3 pb-3 pt-2 text-[13px] leading-relaxed">
      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[7rem_1fr]">
        {u.topic && <><dt className="text-ash">Topic</dt><dd className="text-snow">{u.topic}</dd></>}
        {u.book && <><dt className="text-ash">Book</dt><dd className="text-snow">{u.book}</dd></>}
        {u.pattern && <><dt className="text-ash">Class rhythm</dt><dd className="text-snow">{u.pattern}</dd></>}
        <dt className="text-ash">How we know</dt><dd className="text-snow"><span className="mr-1 rounded bg-navy-2 px-1 text-[10px] text-amber-200">{u.source}</span>{u.evidence}</dd>
      </dl>
      {u.timeline.length > 0 && <div><div className="hud-label mb-1">Unit timeline</div>
        <ol className="flex flex-wrap gap-1">{u.timeline.map(t => { const now = /\(now\)/.test(t), done = /\(done/.test(t);
          return <li key={t} className={`rounded-md px-1.5 py-0.5 text-[12px] ${now ? "bg-cyan/20 text-cyan ring-1 ring-cyan/50" : done ? "text-ash line-through decoration-ash/40" : "bg-navy-2/60 text-snow"}`}>{t}</li>; })}</ol></div>}
      {week.length > 0 && <div><div className="hud-label mb-1">This week</div><Links items={week} /></div>}
      {prep.length > 0 && <div><div className="hud-label mb-1">Upcoming assignment prep</div>
        {[...new Set(prep.map(p => p.for_assignment!))].map(a => <div key={a} className="mb-1"><div className="mb-0.5 text-[12px] text-amber-200">For: {a}</div><Links items={prep.filter(p => p.for_assignment === a)} /></div>)}</div>}
      {GROUPS.map(g => { const it = all.filter(r => r.type === g); return it.length ? <div key={g}><div className="hud-label mb-1">{g}</div><Links items={it} /></div> : null; })}
      {!res.length && <p className="text-xs text-ash">No class-specific links yet; this class needs research.</p>}
    </div>}
  </section>;
}

export default function Learn({ demo }: { demo: boolean }) {
  const [d, setD] = useState<LearnData | null>(null); const [err, setErr] = useState("");
  useEffect(() => { loadLearn(demo).then(setD).catch(e => setErr(String(e?.message || e))); }, [demo]);
  if (err) return <p className="rounded-lg border border-alert/30 bg-alert/10 px-2 py-1 text-xs text-snow">Couldn&apos;t load Learn: {err}</p>;
  if (!d) return <p className="text-xs text-ash">Loading Learn…</p>;
  if (d === "demo") return <p className="text-xs text-ash">Learn shows each class&apos;s current unit and checked study links. Sign in to see Eli&apos;s.</p>;
  if (d === "missing") return <p className="text-xs text-ash">Learn isn&apos;t set up yet (migration 015 needs to be run).</p>;
  if (d === "empty") return <p className="text-xs text-ash">No units researched yet. The weekly Learn refresh fills this in.</p>;
  const shared = d.resources.filter(r => r.class_name === "All");
  const units = [...d.units].sort((a, b) => (ORDER.indexOf(a.class_name) + 99) % 99 - (ORDER.indexOf(b.class_name) + 99) % 99);
  return <div className="space-y-2">
    <p className="text-[11px] text-ash">Current units are worked out from Eli&apos;s ParentVUE assignments and Cobb&apos;s curriculum maps. Last researched {fmtD(d.researched)}.Every link was checked before it was added.</p>
    {units.map(u => <ClassCard key={u.class_name} u={u} res={d.resources.filter(r => r.class_name === u.class_name)} shared={u.status === "current" ? shared : []} />)}
  </div>;
}
