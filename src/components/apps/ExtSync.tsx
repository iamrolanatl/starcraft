"use client";
// Unified external to-dos (Rolan Google Tasks, Eli Microsoft To Do) + sync status / Connect Google.
import { useEffect, useState } from "react";
import { SRC, type Src, type ExtItem, useExt, requestAction, connectGoogle, googleStatus, lastRuns, type ExtRun } from "@/lib/ext";
import { toast, TrashBtn } from "@/components/ui/kit";
import { sfx } from "@/lib/synth";
const fmt = (d: string | null) => d ? new Date(d + "T12:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "";
const today = () => new Date().toLocaleDateString("en-CA");

export function SrcBadge({ src }: { src: Src }) {
  const s = SRC[src];
  return <span className="shrink-0 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-semibold leading-tight" style={{ color: s.color, borderColor: s.color + "99" }} title={s.label}>{s.short}</span>;
}
export function SrcLegend() {
  return <>{(Object.keys(SRC) as Src[]).map(k => <li key={k} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: SRC[k].color }} />{SRC[k].label}</li>)}</>;
}

export function ExtTasks() {
  const [items, reload] = useExt(); const [filter, setFilter] = useState<"all" | "google" | "o365">("all"); const [showDone, setShowDone] = useState(false);
  const tasks = items.filter(x => x.kind === "task" && (filter === "all" || x.source === filter));
  const view = tasks.filter(x => showDone || !(x.pending_action ? x.pending_action === "complete" : x.done))
    .sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9"));
  const act = async (x: ExtItem, a: ExtItem["pending_action"], label: string) => {
    try { await requestAction(x.id, a, a === "delete"); sfx(a === "delete" ? "close" : "success"); await reload();
      toast(`${label} (syncs to ${x.source === "google" ? "Google" : "school"} within 15 min)`, "info", { ms: 6000, action: { label: "Undo", run: async () => { await requestAction(x.id, null, false).catch(() => {}); await reload(); } } });
    } catch (e) { toast(`Couldn't update: ${(e as Error).message}`, "warn"); }
  };
  const nG = items.filter(x => x.kind === "task" && x.source === "google").length, nO = items.filter(x => x.kind === "task" && x.source === "o365").length;
  return (<section className="mt-4 space-y-2" aria-label="Synced to-dos">
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="hud-label mr-1">Synced</span>
      {(["all", "google", "o365"] as const).map(f => <button key={f} className="btn btn-ghost !py-1 text-xs" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? `All (${nG + nO})` : f === "google" ? `${SRC.google.short} (${nG})` : `${SRC.o365.short} (${nO})`}</button>)}
      <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Show done</label>
    </div>
    <ul className="space-y-1">{view.map(x => { const done = x.pending_action ? x.pending_action === "complete" : x.done; const ro = x.source === "o365";
      return <li key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-cyan/5" style={{ borderLeft: `3px solid ${SRC[x.source].color}` }}>
        <input type="checkbox" checked={done} disabled={ro} title={ro ? "Eli's school list is read-only here" : undefined} onChange={() => act(x, done ? "uncomplete" : "complete", done ? `Reopened "${x.title}"` : `Completed "${x.title}"`)} aria-label={`Mark ${x.title} done`} className="h-4 w-4 accent-[#3ef2e0]" />
        <span className={`min-w-0 flex-1 break-words ${done ? "text-[var(--text-muted)] line-through" : "text-[#E8F4FF]"}`}>{x.title}{x.list_name && <span className="ml-1 text-[11px] text-[var(--text-muted)]">· {x.list_name}</span>}
          {x.pending_action && <span className="ml-1 text-[11px] text-cyan">· syncing…</span>}{x.writeback_error && <span className="ml-1 text-[11px] text-alert">· {x.writeback_error}</span>}</span>
        {x.due_date && <span className={`text-xs ${!done && x.due_date < today() ? "text-alert" : "text-ash"}`}>{fmt(x.due_date)}</span>}
        <SrcBadge src={x.source} />
        {!ro && <TrashBtn onClick={() => act(x, "delete", `Deleted "${x.title}"`)} label={x.title} />}
      </li>; })}
      {!view.length && <li className="text-sm text-[var(--text-muted)]">{items.length ? "Nothing open here." : "No synced to-dos yet. Connect Google below; Eli's school list appears once it's linked."}</li>}
    </ul>
    <SyncStatus />
  </section>);
}

export function SyncStatus() {
  const [g, setG] = useState<{ connected: boolean } | null | undefined>(undefined); const [runs, setRuns] = useState<ExtRun[]>([]);
  useEffect(() => { googleStatus().then(setG).catch(() => setG(null)); lastRuns().then(setRuns).catch(() => {}); }, []);
  const latest = (s: string, k: string) => runs.find(r => r.source === s && r.kind === k);
  const line = (s: "google" | "o365", k: string, label: string) => { const r = latest(s, k); return <li key={s + k}>{label}: {r ? <><span className={r.status === "ok" ? "text-[#7dffc8]" : "text-alert"}>{r.status === "quarantined" ? "held back (looked wrong, kept old data)" : r.status}</span> · {new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</> : "not synced yet"}</li>; };
  return (<details className="rounded-lg bg-[#060b18] p-2 text-xs"><summary className="cursor-pointer font-semibold">Sync sources</summary>
    <ul className="mt-1 space-y-0.5">{line("google", "task", "Google Tasks")}{line("google", "event", "Google Calendar")}{line("o365", "event", "Eli's Outlook calendar")}{line("o365", "task", "Eli's Microsoft To Do")}</ul>
    {g === null ? <p className="mt-1 text-[var(--text-muted)]">Run migration 009 to enable sync.</p>
      : <button className="btn btn-ghost mt-2 !py-1 text-xs" onClick={() => connectGoogle().catch(e => toast((e as Error).message, "warn"))}>{g?.connected ? "Reconnect Google" : "Connect Google (Tasks + Calendar)"}</button>}
  </details>);
}
