"use client";
// HEALTH tab of the command center: status banner, synthetic checks, uptime, errors, logs live tail, usage vs quotas, deps, pipeline, security.
import { useCallback, useEffect, useState } from "react";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Api = (path: string) => Promise<{ status: number; data: J }>;
const et = (s?: string | number | null) => s ? new Date(typeof s === "number" ? s * 1000 : s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—";
const ago = (s?: string | null) => { if (!s) return "never"; const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const mb = (b?: number | null) => b == null ? "—" : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`;
const COL = { green: "#7dffc8", yellow: "#ffd166", red: "#ff3b5c" } as const;
const pctCol = (p: number) => p >= 90 ? COL.red : p >= 70 ? COL.yellow : COL.green;
const upCol = (u?: number | null) => u == null ? "#94a3b8" : u >= 99.5 ? COL.green : u >= 97 ? COL.yellow : COL.red;
const Card = ({ title, hue = "#3ef2e0", children, className = "" }: { title: string; hue?: string; children: React.ReactNode; className?: string }) =>
  <section className={`glass min-w-0 rounded-xl p-3 ${className}`} style={{ borderColor: `${hue}44` }}><h2 className="mb-2 text-xs font-bold uppercase tracking-[.14em]" style={{ color: hue }}>{title}</h2>{children}</section>;
function Spark({ s, w = 120, h = 26 }: { s: [number, number, boolean][]; w?: number; h?: number }) {
  if (!s?.length) return <span className="text-[10px] text-ash">no data</span>;
  const max = Math.max(200, ...s.map(x => x[1] || 0)); const step = w / Math.max(1, s.length - 1);
  const pts = s.map((x, i) => `${(i * step).toFixed(1)},${(h - ((x[1] || 0) / max) * (h - 2) - 1).toFixed(1)}`).join(" ");
  return <svg width={w} height={h} className="overflow-visible" aria-hidden><polyline points={pts} fill="none" stroke="#3ef2e0" strokeWidth="1.2" style={{ filter: "drop-shadow(0 0 3px #3ef2e0)" }} />
    {s.map((x, i) => !x[2] && <circle key={i} cx={i * step} cy={h - 3} r="2" fill={COL.red} />)}</svg>;
}
function Meter({ name, used, limit, unit, pct }: { name: string; used: number; limit: number; unit?: string; pct: number }) {
  const c = pctCol(pct);
  return <div className="mb-2"><div className="flex justify-between text-xs"><span>{name}</span><span className="font-mono tabular-nums" style={{ color: c }}>{pct.toFixed(1)}%{pct >= 100 ? " OVER" : ""}</span></div>
    <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: c, boxShadow: `0 0 10px ${c}` }} />
      <span className="absolute inset-y-0 left-[70%] w-px bg-[#ffd16688]" /><span className="absolute inset-y-0 left-[90%] w-px bg-[#ff3b5c88]" /></div>
    <div className="mt-0.5 font-mono text-[10px] text-ash">{unit === "bytes" ? `${mb(used)} / ${mb(limit)}` : `${Math.round(used).toLocaleString()} / ${limit.toLocaleString()} ${unit || ""}`}</div></div>;
}
function Bars({ rows }: { rows: [number, number, number, number][] }) {
  const max = Math.max(1, ...rows.map(r => r[1] + r[2] + r[3]));
  return <div className="flex h-24 items-end gap-0.5">{rows.length ? rows.map(r => <div key={r[0]} className="flex h-full flex-1 flex-col justify-end" title={`${et(r[0])}: 4xx ${r[1]} · 5xx ${r[2]} · JS ${r[3]}`}>
    <div style={{ height: `${(r[2] / max) * 100}%`, background: COL.red }} /><div style={{ height: `${(r[1] / max) * 100}%`, background: COL.yellow }} /><div style={{ height: `${(r[3] / max) * 100}%`, background: "#a78bfa" }} /></div>)
    : <p className="text-xs text-ash">No errors in 24h.</p>}</div>;
}
export default function Health({ api }: { api: Api }) {
  const [d, setD] = useState<J | null>(null); const [pending, setPending] = useState(""); const [logs, setLogs] = useState<J[]>([]); const [live, setLive] = useState(true);
  const [f, setF] = useState({ q: "", sev: "", src: "", rid: "" });
  const load = useCallback(async () => { const r = await api("health"); if (r.status === 503) setPending(r.data.error || "pending"); else if (r.status === 200) { setPending(""); setD(r.data); } }, [api]);
  const loadLogs = useCallback(async () => { const p = new URLSearchParams({ ...f, limit: "200" }); const r = await api(`logs?${p}`); if (r.status === 200 && Array.isArray(r.data)) setLogs(r.data); }, [api, f]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { loadLogs(); if (!live) return; const t = setInterval(loadLogs, 5000); return () => clearInterval(t); }, [loadLogs, live]);
  if (pending) return <div className="glass rounded-xl p-6 text-center"><div className="font-mono text-sm uppercase tracking-[.12em] text-[#ffd166]">Health standby</div><p className="mt-2">{pending} Run <b>021_health.sql</b> in the Supabase SQL Editor; checks start arriving within 5 minutes.</p></div>;
  if (!d) return <p className="text-ash">Loading health…</p>;
  const st = d.status || {}; const col = COL[(st.state as keyof typeof COL) || "yellow"]; const targets: J[] = d.targets || [];
  const cf = d.snapshots?.cloudflare || {}; const quotas: J[] = d.snapshots?.quotas?.items || []; const db = d.db || {}; const pl = d.pipeline || {}; const sec = d.security || {};
  const dbItems = [{ name: "Supabase database (500 MB free)", used: db.size_bytes, limit: db.limit_bytes, unit: "bytes" }, { name: "Supabase storage (1 GB free)", used: db.storage_bytes || 0, limit: 1024 ** 3, unit: "bytes" },
    { name: "Monthly active users (50k free)", used: db.mau_30d || 0, limit: 50000, unit: "MAU" }, { name: "DB connections", used: db.connections || 0, limit: db.max_connections || 60, unit: "conns" }].map(x => ({ ...x, pct: Math.round((1000 * Number(x.used || 0)) / Number(x.limit || 1)) / 10 }));
  const groups: [string, string, J[]][] = [["Application", "#3ef2e0", targets.filter(t => ["route", "api", "core"].includes(t.kind))], ["Dependencies", "#a78bfa", targets.filter(t => t.kind === "dep")]];
  const fresh = [["School sync (ParentVUE)", pl.school?.[0]?.finished_at || pl.school?.[0]?.started_at || pl.school?.[0]?.created_at, 36], ["Gmail sync", pl.gmail_last, 6], ["Calendar / ext sync", pl.calendar_last, 36]] as [string, string, number][];
  return <div className="grid gap-3">
    <div className="glass flex flex-wrap items-center gap-4 rounded-xl p-4" style={{ borderColor: col, boxShadow: `0 0 30px ${col}33` }} role="status">
      <span className={`h-5 w-5 rounded-full ${st.state !== "green" ? "animate-pulse" : ""}`} style={{ background: col, boxShadow: `0 0 18px ${col}` }} />
      <div><div className="font-mono text-2xl font-bold tracking-[.14em]" style={{ color: col }}>{st.state === "green" ? "ALL SYSTEMS NOMINAL" : st.state === "red" ? "RED ALERT" : "DEGRADED"}</div>
        <div className="text-xs text-ash">{[...(st.red || []), ...(st.yellow || [])].join(" · ") || "No open issues"} · since {et(d.state?.since)} · alerts email iamrolan@gmail.com on state change</div></div>
      <div className="ml-auto text-right font-mono text-xs text-ash">checked {et(d.at)}<br />{targets.length} monitors</div></div>

    <div className="grid gap-3 xl:grid-cols-2">{groups.map(([g, hue, ts]) => <Card key={g} title={`${g} · synthetic checks (every 5 min)`} hue={hue}>
      <table className="w-full whitespace-nowrap font-mono text-xs"><thead><tr className="text-left text-ash"><th>target</th><th>status</th><th>p50</th><th>p95</th><th>24h</th><th>7d</th><th>30d</th><th>latency 24h</th><th>last</th></tr></thead>
        <tbody>{ts.map(t => <tr key={t.target} className="border-t border-white/5"><td className="py-1"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: t.ok ? COL.green : COL.red, boxShadow: `0 0 6px ${t.ok ? COL.green : COL.red}` }} />{t.target}</td>
          <td className={t.ok ? "" : "text-[#ff8fa3]"} title={t.detail || ""}>{t.status ?? "ERR"}</td><td>{t.p50 != null ? Math.round(t.p50) : "—"}</td><td className={t.p95 > 2000 ? "text-[#ffd166]" : ""}>{t.p95 != null ? Math.round(t.p95) : "—"}</td>
          {[t.up_24h, t.up_7d, t.up_30d].map((u, i) => <td key={i} style={{ color: upCol(u) }}>{u != null ? `${u}%` : "—"}</td>)}<td><Spark s={t.series} /></td><td className="text-ash">{ago(t.last_at)}</td></tr>)}
          {!ts.length && <tr><td colSpan={9} className="py-2 text-ash">No checks yet. The crystal-health cron writes every 5 minutes.</td></tr>}</tbody></table></Card>)}</div>

    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Error rates · 24h (4xx yellow · 5xx red · JS purple)" hue="#ff8fa3" className="lg:col-span-2"><Bars rows={d.errors_hourly || []} />
        <div className="mt-2 max-h-40 overflow-auto"><table className="w-full font-mono text-xs"><tbody>{(d.errors_by_route || []).map((e: J, i: number) => <tr key={i} className="border-t border-white/5"><td className="py-0.5">{e.route}</td><td style={{ color: e.code >= 500 ? COL.red : COL.yellow }}>{e.code ?? e.source}</td><td>{e.source}</td><td className="tabular-nums">{e.n}</td><td className="text-ash">{ago(e.last)}</td></tr>)}</tbody></table></div></Card>
      <Card title="Incidents · 30d" hue={COL.red}><div className="max-h-56 overflow-auto">{(d.incidents || []).map((i: J, k: number) => <div key={k} className="mb-1 border-l-2 border-[#ff3b5c] pl-2 text-xs"><b>{i.target}</b> down {i.checks}× · {et(i.started)} → {et(i.last_fail)}<div className="truncate text-ash">{i.detail}</div></div>)}{!(d.incidents || []).length && <p className="text-xs text-ash">No incidents.</p>}</div></Card></div>

    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Supabase usage vs free tier" hue="#7dffc8">{dbItems.map(m => <Meter key={m.name} {...m} />)}
        <div className="mt-1 text-[10px] text-ash">Buckets: {(db.buckets || []).map((b: J) => `${b.bucket} ${b.objects} obj ${mb(b.bytes)}`).join(" · ") || "none"} · {db.auth_users} auth users</div>
        <details className="mt-1 text-xs"><summary className="cursor-pointer text-cyan">Largest tables</summary>{(db.top_tables || []).map((t: J) => <div key={t.name} className="flex justify-between font-mono text-[11px]"><span>{t.name}</span><span>{mb(t.bytes)} · {t.rows} rows</span></div>)}</details></Card>
      <Card title="Cloudflare usage + quotas" hue="#ffd166">{quotas.map(q => <Meter key={q.name} name={q.name} used={q.used} limit={q.limit} unit={q.unit} pct={q.pct} />)}
        {(cf.pages || []).map((p: J) => <div key={p.dimensions?.scriptName} className="font-mono text-[11px]">{String(p.dimensions?.scriptName).replace(/pages-worker--\d+-/, "pages ")}: {p.sum?.requests} req · {p.sum?.errors} err · CPU p50 {(p.quantiles?.cpuTimeP50 / 1000).toFixed(1)}ms p99 {(p.quantiles?.cpuTimeP99 / 1000).toFixed(1)}ms (24h)</div>)}
        {(cf.ai || []).map((a: J) => <div key={a.dimensions?.modelId} className="font-mono text-[10px] text-ash">{String(a.dimensions?.modelId).replace("@cf/", "")} {Math.round(a.sum?.totalNeurons)} neurons · {a.count} calls</div>)}
        {(cf.graphql_error || cf.error) && <p className="text-xs text-[#ff8fa3]">{cf.graphql_error || cf.error}</p>}<div className="mt-1 text-[10px] text-ash">snapshot {ago(cf._at)}</div></Card>
      <Card title="Deploys (Pages)" hue="#7dd3fc">{(cf.deployments || []).map((x: J) => <div key={x.id} className="flex justify-between font-mono text-[11px]"><span>{x.id} {x.env === "production" ? "PROD" : x.branch}</span><span style={{ color: x.status === "success" ? COL.green : x.status === "failure" ? COL.red : COL.yellow }}>{x.stage}:{x.status}</span><span className="text-ash">{ago(x.at)}</span></div>)}
        {cf.deployments_error && <p className="text-xs text-[#ff8fa3]">{cf.deployments_error}</p>}</Card></div>

    <div className="grid gap-3 lg:grid-cols-3">
      <Card title="Data pipeline" hue="#a78bfa">{fresh.map(([n, at, h]) => { const stale = !at || Date.now() - new Date(at).getTime() > h * 3600e3; return <div key={n} className="flex justify-between text-xs"><span>{n}</span><span style={{ color: stale ? COL.yellow : COL.green }}>{ago(at)}</span></div>; })}
        {(pl.ext || []).map((x: J) => <div key={x.source + x.kind} className="flex justify-between font-mono text-[11px]"><span>{x.source}/{x.kind}</span><span style={{ color: /fail|quar/.test(x.status) ? COL.red : COL.green }}>{x.status} · {x.pulled ?? "—"} · {ago(x.last)}</span></div>)}
        <div className="mt-2 text-xs">Rows added 24h: <span className="font-mono text-[11px] text-ash">{Object.entries(pl.deltas_24h || {}).map(([k, v]) => `${k} +${v ?? "?"}`).join(" · ")}</span></div>
        <div className="text-xs">Quarantined: <b style={{ color: pl.quarantine ? COL.yellow : COL.green }}>{pl.quarantine ?? "—"}</b></div></Card>
      <Card title="Queues + Crystal Sync" hue="#7dd3fc">
        <div className="grid grid-cols-2 gap-2 text-xs"><div>Outbox queued <b className="font-mono">{pl.outbox?.queued ?? "—"}</b> · failed <b className="font-mono" style={{ color: pl.outbox?.failed ? COL.red : undefined }}>{pl.outbox?.failed ?? "—"}</b><div className="text-ash">oldest {ago(pl.outbox?.oldest_queued)}</div></div>
          <div>Support open <b className="font-mono" style={{ color: pl.support_open ? COL.yellow : undefined }}>{pl.support_open ?? "—"}</b> · <a href="/support/" className="text-cyan underline">queue</a></div>
          <div>Devices {pl.devices?.active ?? "—"} active / {pl.devices?.total ?? "—"}<div className="text-ash">{pl.devices?.seen_1h ?? 0} seen in 1h</div></div></div>
        {(pl.crystal_sync || []).map((s: J) => <div key={s.child_id} className="mt-1 font-mono text-[11px]">child {String(s.child_id).slice(0, 6)} · <span style={{ color: s.status === "ok" ? COL.green : s.status === "failed" ? COL.red : COL.yellow }}>{s.status}</span> · {ago(s.finished_at || s.requested_at)}{s.error ? ` · ${String(s.error).slice(0, 60)}` : ""}</div>)}</Card>
      <Card title="Security signals · 24h" hue="#f0abfc"><div className="grid grid-cols-2 gap-2 font-mono text-xs">
        {[["Failed sign-ins", sec.failed_logins_24h], ["Rate-limit hits", sec.rate_limited_24h], ["401/403 responses", sec.forbidden_24h], ["Admin actions", sec.admin_actions_24h], ["Devices revoked 7d", sec.revoked_devices_7d]].map(([k, v]) => <div key={k as string}><div className="text-[10px] uppercase text-ash">{k}</div><div className="text-xl" style={{ color: Number(v) > 0 && k !== "Admin actions" ? COL.yellow : "#f4f8ff" }}>{v ?? "—"}</div></div>)}</div>
        <div className="mt-2 max-h-24 overflow-auto">{(sec.admin_recent || []).map((a: J, i: number) => <div key={i} className="font-mono text-[10px] text-ash">{et(a.at)} {a.action}</div>)}</div></Card></div>

    <Card title="Logs · live tail" hue="#7dffc8">
      <form className="mb-2 flex flex-wrap gap-1" onSubmit={e => { e.preventDefault(); loadLogs(); }}>
        <input aria-label="Search logs" style={{ width: "14rem" }} className="input py-1 text-xs" placeholder="search message / route" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        <select aria-label="Severity" style={{ width: "8rem" }} className="input py-1 text-xs" value={f.sev} onChange={e => setF({ ...f, sev: e.target.value })}><option value="">all severities</option>{["critical", "error", "security", "warn", "info", "debug"].map(s => <option key={s}>{s}</option>)}</select>
        <select aria-label="Source" style={{ width: "8rem" }} className="input py-1 text-xs" value={f.src} onChange={e => setF({ ...f, src: e.target.value })}><option value="">all sources</option>{["api", "client", "auth", "ratelimit", "cron"].map(s => <option key={s}>{s}</option>)}</select>
        <input aria-label="Request id" style={{ width: "14rem" }} className="input py-1 font-mono text-xs" placeholder="x-request-id" value={f.rid} onChange={e => setF({ ...f, rid: e.target.value })} />
        <button className="btn btn-ghost px-2 py-1 text-xs">APPLY</button><button type="button" onClick={() => setLive(v => !v)} className="btn btn-ghost px-2 py-1 text-xs" aria-pressed={live}><span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-[#7dffc8]" : "bg-ash"}`} />{live ? "LIVE" : "PAUSED"}</button></form>
      <div className="max-h-72 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px]">{logs.map(l => <div key={l.id} className="whitespace-nowrap" style={{ color: { critical: COL.red, error: "#ff8fa3", security: "#f0abfc", warn: COL.yellow, info: "#c7ccd4", debug: "#64748b" }[l.severity as string] }}>
        <span className="text-ash">{et(l.at)}</span> [{l.severity.toUpperCase()}] {l.source} {l.code ?? ""} {l.route ?? ""} {l.message} {l.meta?.ms != null ? `${l.meta.ms}ms` : ""} {l.request_id && <button className="text-cyan underline" onClick={() => setF({ ...f, rid: l.request_id })}>{l.request_id.slice(0, 16)}</button>}</div>)}
        {!logs.length && <span className="text-ash">No events match.</span>}</div></Card>
  </div>;
}
