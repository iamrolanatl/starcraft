"use client";
// /admin — Crystal Command Center. Owner-only: /api/admin/* verifies the JWT + ADMIN_EMAILS, and Postgres admin_guard() re-checks.
// This page holds no secrets; a non-admin who opens it gets the styled 403 page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { sb } from "@/lib/supabase";
const AuthPanel = dynamic(() => import("@/components/AuthPanel"), { ssr: false });
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const TABS = ["OVERVIEW", "USERS", "FAMILIES", "DATA", "SYNC", "AUDIT", "SUPPORT"] as const; type Tab = typeof TABS[number];
const HUE: Record<Tab, string> = { OVERVIEW: "#3ef2e0", USERS: "#7dd3fc", FAMILIES: "#a78bfa", DATA: "#7dffc8", SYNC: "#ffd166", AUDIT: "#f0abfc", SUPPORT: "#ff8fa3" };
const et = (s?: string | null) => s ? new Date(s).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "—";
const ago = (s?: string | null) => { if (!s) return "never"; const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const tsOf = (r: J) => r?.finished_at || r?.started_at || r?.created_at || r?.at || r?.ts || r?.ran_at || r?.sent_at || r?.updated_at;
const failed = (r: J) => /fail|error|denied|bounce/i.test(String(r?.status ?? r?.result ?? r?.ok ?? "")) || r?.ok === false || !!r?.error;
const short = (v: unknown) => v === null || v === undefined ? "∅" : typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) ? et(v) : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80);

async function api(path: string, init?: RequestInit): Promise<{ status: number; data: J }> {
  const { data: s } = await sb().auth.getSession(); const t = s.session?.access_token;
  const r = await fetch(`/api/admin/${path}`, { ...init, headers: { ...(init?.headers || {}), authorization: `Bearer ${t ?? ""}`, "content-type": "application/json", accept: "application/json" } });
  let data: J = {}; try { data = await r.json(); } catch { /* */ } return { status: r.status, data };
}

function Stat({ label, value, hue = "#3ef2e0", sub, warn }: { label: string; value: React.ReactNode; hue?: string; sub?: string; warn?: boolean }) {
  return <div className={`glass rounded-xl p-3 ${warn ? "animate-pulse" : ""}`} style={{ borderColor: warn ? "#ff3b5c" : `${hue}55` }}>
    <div className="text-[11px] font-bold uppercase tracking-[.12em] text-ash">{label}</div>
    <div className="mt-1 font-mono text-3xl font-bold tabular-nums" style={{ color: warn ? "#ff3b5c" : hue, textShadow: `0 0 12px ${warn ? "#ff3b5c" : hue}88` }}>{value ?? "—"}</div>
    {sub && <div className="mt-0.5 truncate text-xs text-ash">{sub}</div>}</div>;
}
function Rows({ rows, onPick, cols }: { rows: J[]; onPick?: (r: J) => void; cols?: string[] }) {
  const keys = cols ?? Array.from(new Set(rows.flatMap(r => Object.keys(r)))).slice(0, 10);
  if (!rows.length) return <p className="p-3 text-sm text-ash">No rows.</p>;
  return <div className="overflow-auto"><table className="w-full font-mono text-xs"><thead><tr>{keys.map(k => <th key={k} className="sticky top-0 bg-[#0b1430] px-2 py-1.5 text-left font-bold uppercase tracking-[.06em] text-cyan">{k}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} onClick={() => onPick?.(r)} className={`border-t border-white/5 ${onPick ? "cursor-pointer hover:bg-cyan/10" : ""} ${failed(r) ? "bg-[#ff3b5c18] text-[#ff8fa3]" : "text-snow"}`}>
      {keys.map(k => <td key={k} className="max-w-[18rem] truncate px-2 py-1" title={short(r[k])}>{short(r[k])}</td>)}</tr>)}</tbody></table></div>;
}

type Confirm = { title: string; word: string; danger?: boolean; run: (typed: string) => Promise<void>; detail?: string };
export default function Admin() {
  const [state, setState] = useState<"loading" | "signin" | "ok" | "pending">("loading"); const [me, setMe] = useState("");
  const [tab, setTab] = useState<Tab>("OVERVIEW"); const [ov, setOv] = useState<J | null>(null); const [log, setLog] = useState<string[]>(["CRYSTAL COMMAND CENTER v1 — type `help` or press ⌘K"]);
  const [users, setUsers] = useState<J[]>([]); const [q, setQ] = useState(""); const [user, setUser] = useState<J | null>(null); const [uid, setUid] = useState<string | null>(null);
  const [tables, setTables] = useState<J[]>([]); const [tsel, setTsel] = useState<string | null>(null); const [tinfo, setTinfo] = useState<J | null>(null); const [browse, setBrowse] = useState<J | null>(null);
  const [fcol, setFcol] = useState(""); const [fval, setFval] = useState(""); const [page, setPage] = useState(0); const [edit, setEdit] = useState<J | null>(null);
  const [sync, setSync] = useState<J | null>(null); const [audit, setAudit] = useState<J[]>([]); const [fam, setFam] = useState<{ families: J[]; children: J[]; viewers: J[]; invites: J[] } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null); const [typed, setTyped] = useState(""); const [palette, setPalette] = useState(false); const [cmd, setCmd] = useState("");
  const say = useCallback((s: string) => setLog(l => [...l.slice(-60), `${new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour12: false })} ${s}`]), []);
  const cmdRef = useRef<HTMLInputElement>(null);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const r = await api(path, init);
    if (r.status === 403) { location.replace("/oops/?code=403"); throw new Error("forbidden"); }
    if (r.status === 503 && r.data.pending) { setState("pending"); throw new Error(r.data.error); }
    if (r.status !== 200) throw new Error(r.data.error || `HTTP ${r.status}`); return r.data;
  }, []);
  const loadOv = useCallback(async () => { try { setOv(await call("overview")); } catch (e) { say(`ERR overview: ${(e as Error).message}`); } }, [call, say]);
  useEffect(() => { (async () => {
    const { data } = await sb().auth.getSession(); if (!data.session) { setState("signin"); return; }
    const r = await api("whoami"); if (r.status === 403) { location.replace("/oops/?code=403"); return; }
    if (r.status === 503) { setState("pending"); return; } if (r.status !== 200) { say(`ERR ${r.data.error}`); }
    setMe(r.data.email || data.session.user.email || ""); setState("ok"); loadOv();
  })(); }, [loadOv, say]);
  useEffect(() => { if (state !== "ok") return; const t = setInterval(loadOv, 30000); return () => clearInterval(t); }, [state, loadOv]);

  const loadUsers = useCallback(async (qq = q) => { try { const d = await call(`users?q=${encodeURIComponent(qq)}`); setUsers(Array.isArray(d) ? d : []); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, q, say]);
  const openUser = useCallback(async (id: string) => { setUid(id); setUser(null); try { setUser(await call(`user?id=${id}`)); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, say]);
  const loadTables = useCallback(async () => { try { const d = await call("tables"); setTables(Array.isArray(d) ? d : []); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, say]);
  const openTable = useCallback(async (t: string, pg = 0, col = fcol, val = fval) => { setTsel(t); setPage(pg); try {
    const [i, b] = await Promise.all([call(`table?t=${encodeURIComponent(t)}`), call(`browse?t=${encodeURIComponent(t)}&offset=${pg * 50}&limit=50${col ? `&col=${encodeURIComponent(col)}&val=${encodeURIComponent(val)}` : ""}`)]);
    setTinfo(i); setBrowse(b); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, fcol, fval, say]);
  const loadSync = useCallback(async () => { try { setSync(await call("sync")); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, say]);
  const loadAudit = useCallback(async (qq = "") => { try { const d = await call(`audit?q=${encodeURIComponent(qq)}`); setAudit(Array.isArray(d) ? d : []); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, say]);
  const loadFam = useCallback(async () => { try {
    const g = (t: string) => call(`browse?t=${t}&limit=200`).then(d => d.rows as J[]);
    const [families, children, viewers, invites] = await Promise.all([g("families"), g("children"), g("child_viewers"), g("family_invites")]); setFam({ families, children, viewers, invites });
    if (!users.length) loadUsers(""); } catch (e) { say(`ERR ${(e as Error).message}`); } }, [call, say, users.length, loadUsers]);
  useEffect(() => { if (state !== "ok") return; ({ USERS: () => loadUsers(), DATA: loadTables, SYNC: loadSync, AUDIT: () => loadAudit(), FAMILIES: loadFam } as Partial<Record<Tab, () => void>>)[tab]?.(); }, [tab, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = (action: string, target: string, word: string, args: J = {}, danger = true, detail?: string) => setConfirm({ title: `${action.replace(/_/g, " ").toUpperCase()}`, word, danger, detail, run: async (t) => {
    const d = await call("action", { method: "POST", body: JSON.stringify({ action, target, args, confirm: t }) }); say(`OK ${action} ${target.slice(0, 8)} rows=${d.rows ?? 0}`);
    if (uid) openUser(uid); if (tab === "FAMILIES") loadFam(); loadOv(); } });
  const emailOf = (id?: string) => users.find(u => u.id === id)?.email || id?.slice(0, 8) || "—";

  const run = useCallback(async (line: string) => {
    const [c, ...rest] = line.trim().split(/\s+/); const arg = rest.join(" "); say(`> ${line}`);
    switch ((c || "").toLowerCase()) {
      case "help": say("commands: overview | users [q] | user <email|id> | families | tables | table <name> | sync | audit [q] | support | refresh | clear"); break;
      case "overview": case "refresh": setTab("OVERVIEW"); await loadOv(); break;
      case "users": setTab("USERS"); setQ(arg); await loadUsers(arg); break;
      case "user": { setTab("USERS"); const d = await call(`users?q=${encodeURIComponent(arg)}`).catch(() => []); const list = Array.isArray(d) ? d : []; setUsers(list);
        if (list[0]) openUser(list[0].id); else say("no match"); break; }
      case "families": case "children": setTab("FAMILIES"); break;
      case "tables": setTab("DATA"); break;
      case "table": setTab("DATA"); if (arg) openTable(arg, 0, "", ""); break;
      case "sync": case "jobs": setTab("SYNC"); break;
      case "audit": setTab("AUDIT"); loadAudit(arg); break;
      case "support": location.href = "/support/"; break;
      case "clear": setLog([]); break;
      default: say(`unknown command: ${c} (try help)`);
    }
  }, [say, loadOv, loadUsers, call, openUser, openTable, loadAudit]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette(p => !p); } if (e.key === "Escape") { setPalette(false); setConfirm(null); } }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, []);
  const PAL = useMemo(() => [...TABS.map(t => ({ label: `Go to ${t}`, run: () => t === "SUPPORT" ? (location.href = "/support/") : setTab(t) })),
    { label: "Refresh overview", run: () => run("refresh") }, { label: "Search users…", run: () => { setTab("USERS"); } }, { label: "Browse table children", run: () => run("table children") },
    { label: "Browse table edu_sync_runs", run: () => run("table edu_sync_runs") }, { label: "Open audit log", run: () => run("audit") }, { label: "Back to Crystal", run: () => (location.href = "/app/") }], [run]);
  const palList = PAL.filter(p => p.label.toLowerCase().includes(cmd.toLowerCase()));

  if (state === "loading") return <main className="grid min-h-dvh place-items-center bg-navy font-mono text-cyan">AUTHENTICATING…</main>;
  if (state === "signin") return <main className="grid min-h-dvh place-items-center bg-navy p-4"><div className="w-full max-w-md"><h1 className="mb-4 text-center text-2xl font-bold tracking-[.12em] text-snow">COMMAND CENTER</h1><AuthPanel title="Owner sign-in" next="/admin/" /></div></main>;
  if (state === "pending") return <main className="grid min-h-dvh place-items-center bg-navy p-4"><div className="glass max-w-lg rounded-2xl p-6 text-center"><div className="font-mono text-sm uppercase tracking-[.12em] text-[#ffd166]">Standby</div><p className="mt-2 text-snow">The admin console is installed but its database part isn&apos;t yet. Run <b>019_admin.sql</b> in the Supabase SQL Editor, then reload.</p></div></main>;

  const o = ov || {}; const lastEdu = o.edu_sync?.[0]; const lastExt = o.ext_sync?.[0]; const ob = o.outbox || {};
  const stale = (s?: string) => !s || Date.now() - new Date(s).getTime() > 36 * 3600e3;
  return <main className="min-h-dvh bg-[radial-gradient(ellipse_at_top,#0b1430,#060b1a_60%)] text-snow">
    <div className="pointer-events-none fixed inset-0 opacity-[.06]" style={{ backgroundImage: "linear-gradient(#3ef2e0 1px,transparent 1px),linear-gradient(90deg,#3ef2e0 1px,transparent 1px)", backgroundSize: "40px 40px" }} />
    <header className="glass sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-2">
      <a href="/app/" className="font-mono text-lg font-bold tracking-[.2em] neon">CRYSTAL</a><span className="font-mono text-xs tracking-[.2em] text-[#ff8fa3]">{"// COMMAND CENTER"}</span>
      <span className="ml-2 flex items-center gap-1.5 font-mono text-[11px] text-[#7dffc8]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#7dffc8] shadow-[0_0_8px_#7dffc8]" />DEFCON {o.support_open ? 3 : 5}</span>
      <nav className="flex flex-wrap gap-1">{TABS.map(t => <button key={t} onClick={() => t === "SUPPORT" ? (location.href = "/support/") : setTab(t)} className="rounded-md px-3 py-1.5 text-xs font-bold tracking-[.1em]" style={{ color: tab === t ? "#04121a" : HUE[t], background: tab === t ? HUE[t] : `${HUE[t]}14`, border: `1px solid ${HUE[t]}66`, boxShadow: tab === t ? `0 0 14px ${HUE[t]}88` : "none" }}>{t}{t === "SUPPORT" && o.support_open ? ` (${o.support_open})` : ""}</button>)}</nav>
      <button onClick={() => setPalette(true)} className="ml-auto rounded-md border border-white/15 px-2 py-1 font-mono text-xs text-ash hover:text-cyan">⌘K</button><span className="font-mono text-xs text-ash" title={me}>{me}</span>
    </header>
    <div className="relative z-10 mx-auto grid max-w-[1400px] gap-3 p-3 pb-44">
      {tab === "OVERVIEW" && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Users" value={o.users} sub={`${o.users_7d ?? "—"} active in 7d`} />
          <Stat label="Active sessions" value={o.sessions ?? "n/a"} hue="#7dd3fc" />
          <Stat label="Families" value={o.families} hue="#a78bfa" sub={`${o.children ?? "—"} children`} />
          <Stat label="Trusted adults" value={o.viewers} hue="#c4b5fd" sub={`${o.list_shares ?? "—"} list shares`} />
          <Stat label="Support queue" value={o.support_open ?? "n/a"} hue="#ff8fa3" warn={(o.support_open ?? 0) > 0} sub="open tickets" />
          <Stat label="Disabled" value={o.disabled} hue="#94a3b8" sub={`${o.audit_24h ?? 0} admin actions 24h`} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="ParentVUE pull" value={ago(tsOf(lastEdu))} hue="#ffd166" warn={stale(tsOf(lastEdu)) || failed(lastEdu || {})} sub={lastEdu ? `${lastEdu.status ?? ""} · ${et(tsOf(lastEdu))}` : "no runs"} />
          <Stat label="Calendar / ext sync" value={ago(tsOf(lastExt))} hue="#7dffc8" warn={!!lastExt && failed(lastExt)} sub={lastExt ? `${lastExt.source ?? lastExt.kind ?? ""} ${lastExt.status ?? ""}` : "no runs"} />
          <Stat label="Mail outbox" value={Object.values(ob).reduce((a: number, b) => a + Number(b), 0)} hue="#7dd3fc" warn={!!(ob.failed || ob.error)} sub={Object.entries(ob).map(([k, v]) => `${k} ${v}`).join(" · ") || "empty"} />
        </div>
        <div className="glass rounded-xl p-3 text-xs text-ash">Workers AI usage isn&apos;t exposed to the app; see Cloudflare dashboard › AI › Workers AI. Refreshes every 30s · last {et(o.at)}</div>
      </>}

      {tab === "USERS" && <div className="grid gap-3 lg:grid-cols-[1fr_28rem]">
        <section className="glass rounded-xl p-3"><form onSubmit={e => { e.preventDefault(); loadUsers(); }} className="mb-2 flex gap-2"><input className="input font-mono" placeholder="search email, name or id" value={q} onChange={e => setQ(e.target.value)} /><button className="btn btn-ghost">SEARCH</button></form>
          <Rows rows={users.map(u => ({ ...u, status: u.deleted_at ? "deleted" : u.disabled_at || u.banned_until ? "disabled" : "active", family: u.family_owner ? "owner" : u.family_role ?? "" }))} cols={["email", "name", "status", "family", "last_sign_in_at", "created_at"]} onPick={r => openUser(r.id)} /></section>
        {uid && <aside className="glass max-h-[calc(100dvh-14rem)] overflow-auto rounded-xl p-3 text-sm" aria-label="User detail">
          {!user ? <p className="text-ash">Loading…</p> : <>
            <div className="flex items-start justify-between"><div><div className="text-lg font-bold">{user.auth?.meta?.full_name || user.auth?.email}</div><div className="font-mono text-xs text-ash">{user.auth?.email} · {user.auth?.provider}</div><div className="font-mono text-[10px] text-ash">{uid}</div></div><button onClick={() => setUid(null)} className="text-ash">✕</button></div>
            <dl className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs"><dt className="text-ash">created</dt><dd>{et(user.auth?.created_at)}</dd><dt className="text-ash">last sign-in</dt><dd>{et(user.auth?.last_sign_in_at)}</dd><dt className="text-ash">status</dt><dd className={user.flags?.deleted_at || user.auth?.banned_until ? "text-[#ff8fa3]" : "text-[#7dffc8]"}>{user.flags?.deleted_at ? "SOFT-DELETED" : user.auth?.banned_until ? "DISABLED" : "ACTIVE"}</dd><dt className="text-ash">sessions</dt><dd>{user.sessions?.length ?? "n/a"}</dd></dl>
            <div className="mt-3 flex flex-wrap gap-1.5">{(() => { const em = user.auth?.email as string; const dis = !!user.auth?.banned_until; return <>
              {dis ? <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act("enable", uid, "", {}, false)}>ENABLE</button> : <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act("disable", uid, em)}>DISABLE</button>}
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act("signout", uid, em)}>SIGN OUT SESSIONS</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act("reset_prefs", uid, em)}>RESET PREFS</button>
              {user.flags?.deleted_at ? <><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act("restore", uid, "", {}, false)}>RESTORE</button><button className="btn px-2 py-1 text-xs bg-[#ff3b5c] text-white" onClick={() => act("hard_delete", uid, em, {}, true, "PERMANENT. Deletes the account and everything it owns.")}>HARD DELETE</button></>
                : <button className="btn px-2 py-1 text-xs border border-[#ff3b5c] text-[#ff8fa3]" onClick={() => act("soft_delete", uid, em, {}, true, "Disables sign-in and marks for deletion. Reversible until hard delete.")}>DELETE USER</button>}</>; })()}</div>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-cyan">View as (read-only data summary)</h3>
            <div className="mt-1 flex flex-wrap gap-1">{Object.entries(user.view_as || {}).map(([k, v]) => <span key={k} className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px]">{k} <b className="text-cyan">{String(v)}</b></span>)}{!Object.keys(user.view_as || {}).length && <span className="text-xs text-ash">no data</span>}</div>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-[#a78bfa]">Family</h3>
            <p className="text-xs">{user.family ? `${user.family.name || "Family"} · owner ${user.family.owner === uid ? "(this user)" : user.family.owner?.slice(0, 8)}` : "none"}{user.membership ? ` · ${user.membership.role} (${user.membership.status})` : ""}</p>
            {(user.children || []).map((c: J) => <div key={c.id} className="mt-1 flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: c.avatar_color }} />{c.first_name} {c.last_name} · gr {c.grade || "?"} {c.user_id ? "· has login" : ""}</div>)}
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-[#c4b5fd]">Shares & viewers</h3>
            {(user.viewers || []).map((v: J) => <div key={v.id} className="flex items-center justify-between text-xs"><span>{v.child_name} → {v.viewer_email} ({v.relationship}, {v.status}) [{(v.scopes || []).join(",")}]</span>{v.status !== "revoked" && <button className="text-[#ff8fa3]" onClick={() => act("viewer_remove", v.id, "REVOKE")}>revoke</button>}</div>)}
            {(user.shares || []).map((s: J) => <div key={s.id} className="flex items-center justify-between text-xs"><span>{s.list} list · {s.perm} · {s.status}</span>{s.status !== "revoked" && <button className="text-[#ff8fa3]" onClick={() => act("share_revoke", s.id, "REVOKE")}>revoke</button>}</div>)}
            {(user.invites || []).map((i: J) => <div key={i.id} className="flex items-center justify-between text-xs"><span>invite …{i.hint} {i.email || ""} · {i.used_at ? "used" : i.revoked_at ? "revoked" : `expires ${et(i.expires_at)}`}</span>{!i.used_at && !i.revoked_at && <button className="text-[#ff8fa3]" onClick={() => act("invite_revoke", i.id, "REVOKE")}>revoke</button>}</div>)}
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-cyan">Prefs</h3><pre className="max-h-32 overflow-auto rounded bg-black/30 p-2 text-[10px]">{JSON.stringify(user.prefs?.prefs ?? user.prefs ?? {}, null, 1)}</pre>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-[.1em] text-cyan">Recent activity</h3>
            {(user.activity || []).map((e: J) => <div key={e.id} className="font-mono text-[11px] text-ash">{et(e.at)} <span className="text-snow">{e.kind}</span></div>)}
          </>}</aside>}
      </div>}

      {tab === "FAMILIES" && <section className="grid gap-3 lg:grid-cols-2">{!fam ? <p className="text-ash">Loading…</p> : <>
        <div className="glass rounded-xl p-3"><h2 className="mb-2 text-sm font-bold tracking-[.1em] text-[#a78bfa]">FAMILIES & CHILDREN</h2>
          {fam.families.map(f => <div key={f.id} className="mb-3 rounded-lg border border-white/10 p-2"><div className="text-sm font-bold">{f.name || "Family"} <span className="font-mono text-xs text-ash">owner {emailOf(f.owner)}</span></div>
            {fam.children.filter(c => c.family_id === f.id).map(c => <div key={c.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: c.avatar_color }} />{c.first_name} {c.last_name}
              <select aria-label={`Move ${c.first_name}`} className="input w-auto py-0.5 text-xs" defaultValue="" onChange={e => { const v = e.target.value; e.target.value = ""; if (v) act("move_child", c.id, "MOVE", v.startsWith("u:") ? { parent_user_id: v.slice(2) } : { family_id: v }, true, `Move ${c.first_name} to another family. Viewers follow the child.`); }}>
                <option value="">move to…</option>{fam.families.filter(x => x.id !== f.id).map(x => <option key={x.id} value={x.id}>{x.name || emailOf(x.owner)}</option>)}{users.filter(u => !fam.families.some(x => x.owner === u.id)).map(u => <option key={u.id} value={`u:${u.id}`}>new family: {u.email}</option>)}</select>
              <ViewerAdd users={users} onAdd={(args) => act("viewer_add", c.id, "GRANT", args, false, `Grant ${emailOf(args.user_id)} access to ${c.first_name}`)} /></div>)}</div>)}
          <AssignChild users={users} onCreate={(pid, args) => act("create_child", pid, "CREATE", args, false, `Create ${args.first_name} under ${emailOf(pid)}`)} /></div>
        <div className="glass rounded-xl p-3"><h2 className="mb-2 text-sm font-bold tracking-[.1em] text-[#c4b5fd]">VIEWERS</h2>
          <Rows rows={fam.viewers} cols={["child_name", "viewer_email", "relationship", "scopes", "status", "expires_at"]} onPick={v => v.status !== "revoked" && act("viewer_remove", v.id, "REVOKE", {}, true, `Revoke ${v.viewer_email}'s access to ${v.child_name}`)} />
          <h2 className="mb-2 mt-4 text-sm font-bold tracking-[.1em] text-[#c4b5fd]">INVITE CODES <span className="text-xs font-normal text-ash">(click to revoke; parents issue new codes from Family settings)</span></h2>
          <Rows rows={fam.invites} cols={["hint", "email", "created_at", "expires_at", "used_at", "revoked_at"]} onPick={i => !i.used_at && !i.revoked_at && act("invite_revoke", i.id, "REVOKE")} /></div></>}</section>}

      {tab === "DATA" && <div className="grid gap-3 lg:grid-cols-[19rem_1fr]">
        <section className="glass max-h-[calc(100dvh-14rem)] overflow-auto rounded-xl p-2">{tables.map(t => <button key={t.name} onClick={() => { setFcol(""); setFval(""); openTable(t.name, 0, "", ""); }} className={`flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-xs ${tsel === t.name ? "bg-cyan/15 text-cyan" : "hover:bg-white/5"}`}>
          <span className="truncate">{t.name}{t.editable ? " ✎" : ""}</span><span className="flex gap-2"><span className="tabular-nums text-ash">{t.rows}</span><span className={t.rls ? "text-[#7dffc8]" : "text-[#ff3b5c]"} title={`${t.policies} policies`}>{t.rls ? `RLS·${t.policies}` : "NO RLS"}</span></span></button>)}</section>
        <section className="glass min-w-0 rounded-xl p-3">{!tsel ? <p className="text-ash">Pick a table. ✎ = guarded row edit allowed.</p> : <>
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-mono text-lg font-bold text-[#7dffc8]">{tsel}</h2><span className="text-xs text-ash">{browse?.total} rows · pk {(tinfo?.pk || []).join(",")}</span>
            <form className="ml-auto flex gap-1" onSubmit={e => { e.preventDefault(); openTable(tsel, 0); }}><select aria-label="Filter column" className="input w-36 py-1 text-xs" value={fcol} onChange={e => setFcol(e.target.value)}><option value="">filter column…</option>{(tinfo?.columns || []).map((c: J) => <option key={c.name}>{c.name}</option>)}</select><input aria-label="Filter value" className="input w-40 py-1 text-xs" placeholder="contains…" value={fval} onChange={e => setFval(e.target.value)} /><button className="btn btn-ghost px-2 py-1 text-xs">APPLY</button></form></div>
          <details className="mt-2"><summary className="cursor-pointer text-xs text-cyan">Schema ({tinfo?.columns?.length}) · Policies ({tinfo?.policies?.length})</summary>
            <div className="mt-1 grid gap-2 md:grid-cols-2"><Rows rows={tinfo?.columns || []} cols={["name", "type", "nullable", "default"]} /><Rows rows={tinfo?.policies || []} cols={["name", "cmd", "using", "check"]} /></div></details>
          <div className="mt-2 max-h-[calc(100dvh-24rem)] overflow-auto"><Rows rows={browse?.rows || []} onPick={tinfo?.editable ? r => setEdit(r) : undefined} /></div>
          <div className="mt-2 flex items-center gap-2 text-xs"><button className="btn btn-ghost px-2 py-1" disabled={page === 0} onClick={() => openTable(tsel, page - 1)}>‹ PREV</button><span className="text-ash">page {page + 1} / {Math.max(1, Math.ceil((browse?.total || 0) / 50))}</span><button className="btn btn-ghost px-2 py-1" disabled={(page + 1) * 50 >= (browse?.total || 0)} onClick={() => openTable(tsel, page + 1)}>NEXT ›</button></div></>}</section></div>}

      {tab === "SYNC" && <section className="grid gap-3 lg:grid-cols-2">{!sync ? <p className="text-ash">Loading…</p> : Object.entries(sync).map(([k, v]) => <div key={k} className="glass rounded-xl p-3"><h2 className="mb-2 flex items-center justify-between text-sm font-bold tracking-[.1em] text-[#ffd166]">{k.toUpperCase()}<span className="text-xs font-normal text-ash">{Array.isArray(v) ? `${v.length} · ${v.filter(failed).length} failed` : "table missing"}</span></h2>
        {Array.isArray(v) && <div className="mb-2 flex h-6 items-end gap-px">{(v as J[]).slice().reverse().map((r, i) => <span key={i} title={`${et(tsOf(r))} ${r.status ?? ""}`} className="w-1.5 flex-1 rounded-sm" style={{ height: failed(r) ? "100%" : "55%", background: failed(r) ? "#ff3b5c" : "#7dffc8", boxShadow: failed(r) ? "0 0 6px #ff3b5c" : "none" }} />)}</div>}
        <div className="max-h-72 overflow-auto">{Array.isArray(v) && <Rows rows={v as J[]} />}</div></div>)}</section>}

      {tab === "AUDIT" && <section className="glass rounded-xl p-3"><form onSubmit={e => { e.preventDefault(); loadAudit((e.currentTarget.elements.namedItem("aq") as HTMLInputElement).value); }} className="mb-2 flex gap-2"><input name="aq" className="input font-mono" placeholder="filter action / target / actor" /><button className="btn btn-ghost">FILTER</button></form>
        <Rows rows={audit.map(a => ({ at: et(a.at), actor: a.actor_email, action: a.action, target: a.target, before: a.before, after: a.after }))} /></section>}
    </div>

    <footer className="glass fixed inset-x-0 bottom-0 z-20 rounded-none border-x-0 border-b-0 font-mono text-xs">
      <div className="h-24 overflow-auto px-3 py-1 text-[#7dffc8]" aria-live="polite">{log.map((l, i) => <div key={i} className={/ERR/.test(l) ? "text-[#ff8fa3]" : l.includes("> ") ? "text-snow" : ""}>{l}</div>)}</div>
      <form onSubmit={e => { e.preventDefault(); const v = cmdRef.current?.value || ""; if (cmdRef.current) cmdRef.current.value = ""; if (v.trim()) run(v); }} className="flex items-center gap-2 border-t border-white/10 px-3 py-2"><span className="neon">crystal@admin:~$</span><input ref={cmdRef} aria-label="Command" className="flex-1 bg-transparent text-snow outline-none" placeholder="help · users eli · table children · sync · audit" autoComplete="off" spellCheck={false} /></form>
    </footer>

    {palette && <div className="fixed inset-0 z-40 grid place-items-start justify-center bg-black/60 pt-[15vh]" onClick={() => setPalette(false)}><div className="glass w-[min(36rem,92vw)] rounded-xl p-2" onClick={e => e.stopPropagation()} role="dialog" aria-label="Command palette">
      <input autoFocus className="input font-mono" placeholder="Type a command…" value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { (palList[0]?.run ?? (() => run(cmd)))(); setPalette(false); setCmd(""); } }} />
      <ul className="mt-1 max-h-80 overflow-auto">{palList.map(p => <li key={p.label}><button className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-cyan/10" onClick={() => { p.run(); setPalette(false); setCmd(""); }}>{p.label}</button></li>)}{!palList.length && <li className="px-2 py-1.5 text-sm text-ash">Enter runs “{cmd}” in the terminal</li>}</ul></div></div>}

    {confirm && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label="Confirm action"><form className="glass w-[min(28rem,92vw)] rounded-xl p-4" style={{ borderColor: confirm.danger ? "#ff3b5c" : "#3ef2e055" }} onSubmit={async e => { e.preventDefault(); const c = confirm; try { await c.run(typed); setConfirm(null); setTyped(""); } catch (er) { say(`ERR ${c.title}: ${(er as Error).message}`); } }}>
      <div className={`font-mono text-sm font-bold tracking-[.12em] ${confirm.danger ? "text-[#ff3b5c]" : "text-cyan"}`}>{confirm.title}</div>{confirm.detail && <p className="mt-1 text-sm text-ash">{confirm.detail}</p>}
      {confirm.word ? <><p className="mt-3 text-sm">Type <b className="font-mono text-snow">{confirm.word}</b> to confirm.</p><input autoFocus className="input mt-1 font-mono" value={typed} onChange={e => setTyped(e.target.value)} aria-label="Confirmation" /></> : <p className="mt-3 text-sm">Proceed?</p>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => { setConfirm(null); setTyped(""); }}>CANCEL</button><button className="btn btn-primary" disabled={!!confirm.word && typed.toLowerCase() !== confirm.word.toLowerCase()}>CONFIRM</button></div><p className="mt-2 text-[11px] text-ash">Logged to the audit trail with before/after.</p></form></div>}

    {edit && tsel && <RowEdit table={tsel} row={edit} pk={(tinfo?.pk || ["id"])[0]} onClose={() => setEdit(null)} onSave={(patch) => setConfirm({ title: `EDIT ${tsel}`, word: "EDIT", danger: true, detail: Object.keys(patch).join(", "), run: async (t) => { await call("row", { method: "POST", body: JSON.stringify({ t: tsel, id: edit[(tinfo?.pk || ["id"])[0]], patch, confirm: t }) }); say(`OK edit ${tsel}`); setEdit(null); openTable(tsel, page); } })} />}
  </main>;
}

function RowEdit({ table, row, pk, onClose, onSave }: { table: string; row: J; pk: string; onClose: () => void; onSave: (p: J) => void }) {
  const [txt, setTxt] = useState(() => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== pk)), null, 2)); const [err, setErr] = useState("");
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4" role="dialog" aria-label="Edit row"><div className="glass w-[min(40rem,94vw)] rounded-xl p-4">
    <div className="font-mono text-sm font-bold text-[#7dffc8]">EDIT {table} · {pk}={String(row[pk])}</div><p className="text-xs text-ash">Only changed fields are sent.</p>
    <textarea aria-label="Row JSON" className="input mt-2 h-72 font-mono text-xs" value={txt} onChange={e => setTxt(e.target.value)} />{err && <p className="text-xs text-alert">{err}</p>}
    <div className="mt-3 flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>CANCEL</button><button className="btn btn-primary" onClick={() => { try { const n = JSON.parse(txt) as J; const patch = Object.fromEntries(Object.entries(n).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(row[k]))); if (!Object.keys(patch).length) return setErr("No changes."); onSave(patch); } catch { setErr("Invalid JSON"); } }}>REVIEW CHANGES</button></div></div></div>;
}
function ViewerAdd({ users, onAdd }: { users: J[]; onAdd: (a: J) => void }) {
  const [open, setOpen] = useState(false); const [u, setU] = useState(""); const [rel, setRel] = useState("Other"); const [sc, setSc] = useState<string[]>(["grades"]); const [exp, setExp] = useState("");
  if (!open) return <button className="text-[#c4b5fd] hover:underline" onClick={() => setOpen(true)}>+ viewer</button>;
  return <span className="flex flex-wrap items-center gap-1"><select aria-label="Viewer" className="input w-auto py-0.5 text-xs" value={u} onChange={e => setU(e.target.value)}><option value="">user…</option>{users.map(x => <option key={x.id} value={x.id}>{x.email}</option>)}</select>
    <select aria-label="Relationship" className="input w-auto py-0.5 text-xs" value={rel} onChange={e => setRel(e.target.value)}>{["Mother", "Father", "Grandmother", "Grandfather", "Aunt", "Uncle", "Babysitter", "Tutor", "Other"].map(r => <option key={r}>{r}</option>)}</select>
    {["grades", "assignments", "report_cards", "attendance", "schedule", "calendar", "learn"].map(s => <label key={s} className="flex items-center gap-0.5"><input type="checkbox" checked={sc.includes(s)} onChange={e => setSc(v => e.target.checked ? [...v, s] : v.filter(x => x !== s))} />{s}</label>)}
    <input aria-label="Expires" type="date" className="input w-auto py-0.5 text-xs" value={exp} onChange={e => setExp(e.target.value)} />
    <button className="btn btn-ghost px-2 py-0.5 text-xs" disabled={!u || !sc.length} onClick={() => { onAdd({ user_id: u, relationship: rel, scopes: sc, expires_at: exp ? `${exp}T23:59:00-04:00` : "" }); setOpen(false); }}>GRANT</button><button onClick={() => setOpen(false)}>✕</button></span>;
}
function AssignChild({ users, onCreate }: { users: J[]; onCreate: (pid: string, a: J) => void }) {
  const [p, setP] = useState(""); const [n, setN] = useState(""); const [g, setG] = useState("");
  return <form className="mt-2 flex flex-wrap gap-1 border-t border-white/10 pt-2" onSubmit={e => { e.preventDefault(); if (p && n) onCreate(p, { first_name: n, grade: g }); }}>
    <span className="w-full text-xs font-bold tracking-[.08em] text-[#a78bfa]">ASSIGN A NEW CHILD UNDER A PARENT</span>
    <select aria-label="Parent" className="input w-auto py-1 text-xs" value={p} onChange={e => setP(e.target.value)}><option value="">parent account…</option>{users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
    <input aria-label="Child first name" className="input w-36 py-1 text-xs" placeholder="first name (e.g. Eli)" value={n} onChange={e => setN(e.target.value)} /><input aria-label="Grade" className="input w-20 py-1 text-xs" placeholder="grade" value={g} onChange={e => setG(e.target.value)} />
    <button className="btn btn-ghost px-2 py-1 text-xs" disabled={!p || !n}>ASSIGN</button></form>;
}
