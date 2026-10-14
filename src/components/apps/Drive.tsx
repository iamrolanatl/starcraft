"use client";
// Comm › Drive: browse, search, recent, in-app preview, open in Drive, pin to a module (pins show in School Hub).
import { useCallback, useEffect, useState } from "react";
import { driveList, drivePreview, isFolder, listPins, pin, unpin, type DFile, type Pin } from "@/lib/drive";
import { connectGoogle } from "@/lib/ext";
import { isDemo } from "@/lib/store";
import { toast } from "@/components/ui/kit";

/** Shown when Drive answers "connect": Google isn't connected yet, or was connected before Drive access was added. */
function ConnectNote({ msg }: { msg: string }) {
  if (isDemo()) return <p className="text-xs text-slate">Sign in to use Drive.</p>;
  return (<div className="rounded-lg border border-[#ffd166]/50 p-2 text-sm"><p className="text-[#E8F4FF]">{msg}</p>
    <button className="btn btn-primary mt-2 text-sm" onClick={() => connectGoogle().catch(e => toast((e as Error).message, "warn"))}>Connect Google (Tasks, Calendar, Drive)</button></div>);
}

const icon = (f: DFile) => isFolder(f) ? "📁" : /pdf/.test(f.mimeType) ? "📄" : /image/.test(f.mimeType) ? "🖼" : /document/.test(f.mimeType) ? "📝" : /spreadsheet/.test(f.mimeType) ? "📊" : /presentation/.test(f.mimeType) ? "📽" : "📎";
export default function Drive() {
  const [path, setPath] = useState<{ id: string; name: string }[]>([]); const [mode, setMode] = useState<"browse" | "recent" | "search">("recent");
  const [q, setQ] = useState(""); const [files, setFiles] = useState<DFile[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ msg: string; code?: string } | null>(null);
  const [pv, setPv] = useState<{ f: DFile; url?: string; type?: string; err?: string } | null>(null); const [pins, setPins] = useState<Pin[]>([]);
  const folder = path[path.length - 1]?.id;
  const load = useCallback(async () => { setBusy(true); setErr(null); try { const r = await driveList(mode === "search" ? { q } : mode === "recent" ? { recent: true } : { folder }); setFiles(r.files || []); } catch (e) { setErr({ msg: (e as Error).message, code: (e as { code?: string }).code }); setFiles([]); } finally { setBusy(false); } }, [mode, q, folder]);
  useEffect(() => { if (mode !== "search" || q) load(); }, [mode, folder]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listPins().then(setPins).catch(() => {}); }, []);
  useEffect(() => () => { if (pv?.url) URL.revokeObjectURL(pv.url); }, [pv]);
  const open = (f: DFile) => { if (isFolder(f)) { setMode("browse"); setPath(p => [...p, { id: f.id, name: f.name }]); return; } setPv({ f }); drivePreview(f.id).then(r => setPv({ f, ...r })).catch(e => setPv({ f, err: (e as Error).message })); };
  const doPin = (f: DFile, m: string) => pin(f, m).then(() => listPins().then(setPins)).then(() => toast(`Pinned to ${m === "school" ? "School Hub" : m}`)).catch(e => toast((e as Error).message, "warn"));
  return (<div className="text-sm text-[#E8F4FF]">
    <div className="mb-2 flex flex-wrap gap-2">
      <button className="btn btn-ghost !py-1 text-xs" aria-pressed={mode === "recent"} onClick={() => setMode("recent")}>Recent</button>
      <button className="btn btn-ghost !py-1 text-xs" aria-pressed={mode === "browse"} onClick={() => { setMode("browse"); setPath([]); }}>My Drive</button>
      <form className="flex flex-1 gap-1" onSubmit={e => { e.preventDefault(); if (q.trim()) { setMode("search"); load(); } }}><input className="input min-w-[8rem] flex-1 py-1 text-sm" placeholder="Search Drive…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search Drive" /><button className="btn btn-primary !py-1 text-xs">Search</button></form>
    </div>
    {mode === "browse" && <div className="mb-1 flex flex-wrap gap-1 text-xs text-ash"><button className="underline" onClick={() => setPath([])}>My Drive</button>{path.map((p, i) => <span key={p.id}>› <button className="underline" onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</button></span>)}</div>}
    {pins.length > 0 && <details className="mb-2"><summary className="cursor-pointer text-xs text-ash">📌 Pinned ({pins.length})</summary><ul>{pins.map(p => <li key={p.id} className="flex items-center gap-2 text-xs"><span className="flex-1 truncate">{p.name}</span><span className="text-slate">{p.module}</span><button className="text-alert" aria-label={`Unpin ${p.name}`} onClick={() => unpin(p.id).then(() => setPins(x => x.filter(y => y.id !== p.id)))}>✕</button></li>)}</ul></details>}
    {err ? (err.code === "connect" ? <ConnectNote msg={err.msg} /> : <p className="text-alert">{err.msg}</p>) : busy ? <p className="text-ash">Loading…</p> : !files.length ? <p className="text-ash">No files here.</p> : null}
    <ul className="max-h-80 space-y-0.5 overflow-auto">{files.map(f => <li key={f.id} className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-cyan/5">
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => open(f)}><span aria-hidden>{icon(f)}</span><span className="truncate">{f.name}</span></button>
      {f.modifiedTime && <span className="hidden text-xs text-slate sm:inline">{new Date(f.modifiedTime).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
      {!isFolder(f) && <button className="text-xs text-ash hover:text-cyan" title="Pin to School Hub" aria-label={`Pin ${f.name} to School Hub`} onClick={() => doPin(f, "school")}>📌</button>}
      {f.webViewLink && <a className="text-xs text-cyan" href={f.webViewLink} target="_blank" rel="noopener noreferrer" aria-label={`Open ${f.name} in Drive`}>↗</a>}</li>)}</ul>
    {pv && <div role="dialog" aria-label={`Preview ${pv.f.name}`} className="fixed inset-0 z-[90] flex flex-col bg-black/80 p-3" onClick={() => setPv(null)}>
      <div className="mx-auto flex w-full max-w-4xl items-center gap-2 rounded-t-lg bg-[#0a1122] p-2" onClick={e => e.stopPropagation()}><span className="flex-1 truncate font-semibold">{pv.f.name}</span>{pv.f.webViewLink && <a className="btn btn-ghost !py-1 text-xs" href={pv.f.webViewLink} target="_blank" rel="noopener noreferrer">Open in Drive ↗</a>}<button className="btn btn-ghost !py-1 text-xs" onClick={() => setPv(null)} aria-label="Close Preview">✕</button></div>
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-auto rounded-b-lg bg-white" onClick={e => e.stopPropagation()}>
        {pv.err ? <p className="p-4 text-black">{pv.err}</p> : !pv.url ? <p className="p-4 text-black">Loading preview…</p> : /^image\//.test(pv.type || "") ? <img src={pv.url} alt={pv.f.name} className="mx-auto max-h-full" /> : <iframe title={pv.f.name} src={pv.url} className="h-full min-h-[70vh] w-full" />}
      </div></div>}
  </div>);
}

export function PinnedDocs({ module }: { module: string }) {
  const [pins, setPins] = useState<Pin[]>([]);
  useEffect(() => { listPins(module).then(setPins).catch(() => {}); }, [module]);
  if (!pins.length) return null;
  return (<div className="mt-2"><div className="text-xs font-semibold text-[#a9b7cc]">📌 Pinned Drive docs</div><ul className="mt-1 flex flex-wrap gap-2">{pins.map(p => <li key={p.id}><a className="rounded border border-[#ffd166]/50 px-2 py-0.5 text-sm hover:bg-[#ffd166]/10" href={p.web_link || `https://drive.google.com/open?id=${p.file_id}`} target="_blank" rel="noopener noreferrer">{p.name}</a></li>)}</ul></div>);
}
