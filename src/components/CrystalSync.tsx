"use client";
// Crystal Sync (020): per-child status light, SYNC NOW (queues a command the paired device polls), live command-center console,
// and the Downloads/pairing panel. All reads go through RLS (family owner only); writes via sync_* RPCs.
import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "@/lib/supabase";

export type ChildSync = { child_id: string; name: string; grade: string | null; devices: number; device_seen_at: string | null; last_ok_at: string | null;
  last: { id: string; status: string; trigger: string; at: string; error: string | null } | null };
type Line = { id: number; at: string; level: string; step: string | null; msg: string };
const H13 = 13 * 3600_000;
export const syncColor = (c: ChildSync) => {
  if (c.last && ["failed", "quarantined"].includes(c.last.status) && (!c.last_ok_at || c.last.at > c.last_ok_at)) return { hue: "#ff3b5c", label: "FAILED" };
  if (!c.last_ok_at) return { hue: "#ff3b5c", label: "NEVER SYNCED" };
  return Date.now() - new Date(c.last_ok_at).getTime() < H13 ? { hue: "#7dffc8", label: "OK" } : { hue: "#ffd166", label: "LATE" };
};
const et = (s?: string | null) => s ? new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "never";
const LV: Record<string, string> = { debug: "#7a8aa6", info: "#cfe8ff", warn: "#ffd166", error: "#ff3b5c", ok: "#7dffc8" };

export async function loadChildSync(): Promise<ChildSync[] | null> {
  const { data, error } = await sb().rpc("sync_status");
  if (error) return null; return (data as ChildSync[]) ?? [];
}

export function SyncConsole({ runId, title, onClose }: { runId: string; title: string; onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([]); const [run, setRun] = useState<{ status: string; counts: Record<string, unknown>; error: string | null } | null>(null);
  const last = useRef(0); const box = useRef<HTMLDivElement>(null);
  useEffect(() => { let stop = false; const tick = async () => {
    const [{ data: l }, { data: r }] = await Promise.all([
      sb().from("sync_logs").select("id,at,level,step,msg").eq("run_id", runId).gt("id", last.current).order("id").limit(500),
      sb().from("sync_runs").select("status,counts,error").eq("id", runId).maybeSingle()]);
    if (stop) return;
    if (l?.length) { last.current = (l[l.length - 1] as Line).id; setLines(x => [...x, ...(l as Line[])].slice(-2000)); }
    if (r) setRun(r as typeof run);
    if (!r || ["queued", "running"].includes((r as { status: string }).status)) setTimeout(tick, 1500);
  }; tick(); return () => { stop = true; }; }, [runId]);
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight); }, [lines]);
  const st = run?.status ?? "queued";
  return (<div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-3" role="dialog" aria-label="Sync console" onClick={onClose}>
    <div className="glass flex h-[min(80vh,640px)] w-[min(96vw,900px)] flex-col overflow-hidden rounded-2xl border border-cyan/30" onClick={e => e.stopPropagation()} style={{ boxShadow: "0 0 40px #3ef2e033" }}>
      <div className="flex items-center gap-3 border-b border-cyan/20 px-4 py-2">
        <span className="font-mono text-xs font-bold tracking-[.18em] text-cyan">SYNC COMMAND CENTER</span><span className="text-xs text-ash">{title}</span>
        <span className="ml-auto rounded px-2 py-0.5 font-mono text-[11px] font-bold" style={{ color: st === "ok" ? "#7dffc8" : st === "running" || st === "queued" ? "#ffd166" : "#ff3b5c", border: "1px solid currentColor" }}>{st.toUpperCase()}</span>
        <button onClick={onClose} className="text-ash hover:text-snow" aria-label="Close">✕</button></div>
      <div ref={box} className="flex-1 overflow-auto bg-black/40 p-3 font-mono text-[12px] leading-5" aria-live="polite">
        {st === "queued" && !lines.length && <div className="text-[#ffd166]">» Waiting for the Crystal Sync app on the paired computer to pick up the command (it checks every 30 s; the computer must be on)…</div>}
        {lines.map(l => <div key={l.id} style={{ color: LV[l.level] ?? "#cfe8ff" }}><span className="text-slate">{new Date(l.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })}</span> <span className="inline-block w-16 uppercase opacity-80">{l.step ?? ""}</span> {l.msg}</div>)}
        {run?.error && <div className="text-[#ff3b5c]">✖ {run.error}</div>}
      </div>
      {run?.counts && Object.keys(run.counts).length > 0 && <div className="flex flex-wrap gap-2 border-t border-cyan/20 px-4 py-2 font-mono text-[11px] text-ash">{Object.entries(run.counts).filter(([, v]) => typeof v !== "object").map(([k, v]) => <span key={k} className="rounded bg-cyan/10 px-1.5 py-0.5"><b className="text-snow">{String(v)}</b> {k}</span>)}</div>}
    </div></div>);
}

export function SyncLights({ compact = false }: { compact?: boolean }) {
  const [kids, setKids] = useState<ChildSync[] | null>(null); const [open, setOpen] = useState<{ id: string; title: string } | null>(null); const [msg, setMsg] = useState("");
  const load = useCallback(async () => setKids(await loadChildSync()), []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  if (!kids?.length) return null;
  const now = async (c: ChildSync) => {
    setMsg(""); const { data, error } = await sb().rpc("sync_request_now", { p_child: c.child_id });
    if (error) { setMsg(error.message.includes("no Crystal Sync device") ? `Pair a computer for ${c.name} first: open Downloads.` : error.message); return; }
    setOpen({ id: (data as { run_id: string }).run_id, title: `${c.name} · manual sync` }); load();
  };
  return (<div className="flex flex-wrap items-center gap-2" data-testid="sync-lights">
    {kids.map(c => { const s = syncColor(c); return (<div key={c.child_id} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: `${s.hue}66`, background: `${s.hue}12` }}
      title={`${c.name}: ${s.label}. Last good sync ${et(c.last_ok_at)}${c.last?.error ? ` · last error: ${c.last.error}` : ""}${c.devices ? ` · ${c.devices} device(s), seen ${et(c.device_seen_at)}` : " · no Crystal Sync device paired"}`}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.label === "FAILED" || s.label === "NEVER SYNCED" ? "motion-safe:animate-pulse" : ""}`} style={{ background: s.hue, boxShadow: `0 0 8px ${s.hue}` }} aria-hidden />
      <span className="font-bold tracking-wide text-snow">{c.name.toUpperCase()}</span>{!compact && <span style={{ color: s.hue }}>SYNC {s.label}</span>}
      <button onClick={() => now(c)} className="ml-1 rounded-full px-2 py-px font-bold tracking-wider text-[#04121a]" style={{ background: s.hue }}>SYNC NOW</button>
      {c.last && <button onClick={() => setOpen({ id: c.last!.id, title: `${c.name} · last run ${et(c.last!.at)}` })} className="text-ash underline-offset-2 hover:underline">LOG</button>}
    </div>); })}
    <a href="/downloads/" className="text-[11px] font-bold tracking-wider text-cyan hover:underline">DOWNLOADS</a>
    {msg && <span className="text-[11px] text-[#ffd166]">{msg}</span>}
    {open && <SyncConsole runId={open.id} title={open.title} onClose={() => { setOpen(null); load(); }} />}
  </div>);
}
