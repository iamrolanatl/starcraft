"use client";
// Owner-only support queue (RLS on support_tickets: only iamrolan@gmail.com can read/update).
import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
type Msg = { role: string; content: string; at?: string };
type T = { id: string; user_name: string | null; user_email: string | null; error_code: string | null; url: string | null; ua: string | null; messages: Msg[]; status: "queued" | "open" | "closed"; created_at: string; updated_at: string };
const fmt = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
const HUE: Record<string, string> = { queued: "#ffd166", open: "#3ef2e0", closed: "#7a8aa6" };
export default function SupportQueue() {
  const [rows, setRows] = useState<T[] | null>(null); const [err, setErr] = useState(""); const [sel, setSel] = useState<string | null>(null); const [filter, setFilter] = useState<"active" | "all">("active");
  const load = useCallback(async () => {
    const { data: s } = await sb().auth.getSession(); if (!s.session) { setErr("Sign in as the owner to view the support queue."); setRows([]); return; }
    let q = sb().from("support_tickets").select("id,user_name,user_email,error_code,url,ua,messages,status,created_at,updated_at").order("created_at", { ascending: false }).limit(100);
    if (filter === "active") q = q.neq("status", "closed");
    const { data, error } = await q;
    if (error) { setErr(/does not exist|schema cache/.test(error.message) ? "Support queue table isn't set up yet (run migration 018_support.sql)." : error.message); setRows([]); return; }
    setErr(data.length ? "" : "No tickets. (Only the owner account can see tickets.)"); setRows(data as T[]); setSel(v => v ?? new URLSearchParams(location.search).get("t"));
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  const setStatus = async (id: string, status: T["status"]) => { const { error } = await sb().from("support_tickets").update({ status, updated_at: new Date().toISOString() }).eq("id", id); if (error) setErr(error.message); else load(); };
  const cur = rows?.find(r => r.id === sel);
  return (
    <main className="min-h-dvh bg-navy p-4 text-ice sm:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4 flex flex-wrap items-center gap-3"><a href="/app/" className="btn btn-ghost">← Crystal</a><h1 className="neon text-2xl font-semibold">SUPPORT QUEUE</h1>
          <div className="ml-auto flex gap-2">{(["active", "all"] as const).map(f => <button key={f} className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>)}<button className="btn btn-ghost" onClick={load}>↻ REFRESH</button></div></header>
        {err && <p className="glass mb-3 rounded-xl p-3 text-sm">{err}</p>}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul className="space-y-2">{(rows ?? []).map(r => <li key={r.id}><button onClick={() => setSel(r.id)} className={`glass w-full rounded-xl p-3 text-left ${sel === r.id ? "neon-border" : ""}`}>
            <div className="flex items-center gap-2"><span className="rounded px-2 py-0.5 font-mono text-sm font-bold" style={{ color: "#04121a", background: "#3ef2e0" }}>{r.error_code}</span><span className="font-semibold">{r.user_name || r.user_email || "Guest"}</span><span className="ml-auto text-xs font-semibold" style={{ color: HUE[r.status] }}>{r.status.toUpperCase()}</span></div>
            <p className="mt-1 truncate text-sm text-ice/80">{r.messages.find(m => m.role === "user")?.content}</p><p className="mt-1 text-xs text-ice/50">{fmt(r.created_at)} · {r.url}</p></button></li>)}</ul>
          {cur ? <section className="glass rounded-2xl p-4">
            <div className="text-sm text-ice/70">{cur.user_name || "Guest"}{cur.user_email && <> · <a className="text-cyan underline" href={`mailto:${cur.user_email}?subject=Re: Crystal support (${cur.error_code})`}>{cur.user_email}</a></>} · {cur.ua}</div>
            <div className="text-xs text-ice/50">{fmt(cur.created_at)} · {cur.url} · {cur.id}</div>
            <div className="mt-3 max-h-[60dvh] space-y-2 overflow-y-auto">{cur.messages.map((m, i) => <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[15px] ${m.role === "user" ? "ml-auto bg-cyan/15" : "border border-cyan/15 bg-black/30"}`}>{m.content}</div>)}</div>
            <div className="mt-3 flex gap-2">{(["queued", "open", "closed"] as const).map(s => <button key={s} disabled={cur.status === s} className={`btn ${cur.status === s ? "btn-primary" : "btn-ghost"}`} onClick={() => setStatus(cur.id, s)}>{s.toUpperCase()}</button>)}</div>
          </section> : <p className="text-sm text-ice/60">Select a ticket.</p>}
        </div>
      </div>
    </main>);
}
