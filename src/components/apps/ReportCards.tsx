"use client";
import { useEffect, useState } from "react";
import { listReportCards, reportCardUrl, type ReportCard } from "@/lib/reportcards";

const fmt = (d: string | null) => d ? new Date(d + "T12:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "date not listed";

export default function ReportCards({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<ReportCard[] | "missing" | null>(null); const [err, setErr] = useState("");
  const [open, setOpen] = useState<{ rc: ReportCard; url: string } | null>(null); const [zoom, setZoom] = useState(1); const [busy, setBusy] = useState("");
  useEffect(() => { listReportCards(demo).then(setRows).catch(e => setErr(String(e?.message || e))); }, [demo]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); setOpen(null); } };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }, [open]);
  async function view(rc: ReportCard) {
    setBusy(rc.id); setErr("");
    try { setOpen({ rc, url: await reportCardUrl(rc.id) }); setZoom(1); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(""); }
  }
  if (err && !open) return <p className="rounded-lg border border-alert/30 bg-alert/10 px-2 py-1 text-xs text-snow">Couldn&apos;t load report cards: {err}</p>;
  if (rows === null) return <p className="text-xs text-ash">Loading report cards…</p>;
  if (rows === "missing") return <p className="text-xs text-ash">Report cards aren&apos;t set up yet (migration 013 needs to be run).</p>;
  if (!rows.length) return <div className="rounded-lg border border-cyan/15 bg-navy-2/50 px-3 py-4 text-center text-xs text-ash">No report cards have been published yet in ParentVUE.<div className="mt-1 text-[10px] text-slate">Crystal checks on every school sync (5:40 AM / PM).</div></div>;
  const years = [...new Set(rows.map(r => r.school_year || "Unknown year"))];
  return (<div className="space-y-3">
    {years.map(y => <div key={y}><div className="hud-label mb-1">{y}</div><ul className="grid gap-1.5 sm:grid-cols-2">
      {rows.filter(r => (r.school_year || "Unknown year") === y).map(r => <li key={r.id}>
        <button onClick={() => view(r)} disabled={!!busy} className="flex w-full items-center gap-2 rounded-lg border border-cyan/15 bg-navy-2/60 px-2 py-2 text-left hover:border-cyan/50 focus-visible:outline focus-visible:outline-cyan">
          <span aria-hidden className="text-lg">📄</span>
          <span className="min-w-0 flex-1"><span className="block break-words text-snow">{r.period || r.file_name || "Report card"}</span>
            <span className="block text-[10px] text-ash">{fmt(r.issue_date)}{r.source === "document" ? " · from Documents" : ""}</span></span>
          <span className="text-[11px] text-cyan">{busy === r.id ? "…" : "View ⤢"}</span>
        </button></li>)}
    </ul></div>)}
    {open && <div role="dialog" aria-modal="true" aria-label={`Report card ${open.rc.period ?? ""}`} className="fixed inset-0 z-[200] flex flex-col bg-black/90 backdrop-blur-sm" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-cyan/20 bg-navy-2/80 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-semibold text-snow">{open.rc.period || "Report card"} · <span className="text-ash">{open.rc.school_year} · {fmt(open.rc.issue_date)}</span></span>
        <button className="btn btn-ghost !px-2 !py-0.5" onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom Out">−</button>
        <span className="w-10 text-center font-mono text-cyan">{Math.round(zoom * 100)}%</span>
        <button className="btn btn-ghost !px-2 !py-0.5" onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Zoom In">+</button>
        <a className="btn btn-ghost !px-2 !py-0.5" href={open.url} target="_blank" rel="noreferrer" download>⤓ Download</a>
        <button className="btn btn-ghost !px-2 !py-0.5" onClick={() => setOpen(null)} aria-label="Close (Esc)">✕ Esc</button>
      </div>
      <div className="flex-1 overflow-auto">
        <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, minWidth: "100%", minHeight: "100%" }}>
          <iframe title="Report card PDF" src={`${open.url}#view=FitH`} className="h-full w-full bg-white" />
        </div>
      </div>
    </div>}
  </div>);
}
