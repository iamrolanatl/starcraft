"use client";
// /join?code=K7Q4-M9TX (also accepts ?token=). Sign in → enter the code → show the 6-digit match → wait for the owner's Approve.
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { sb } from "@/lib/supabase"; import { joinWithCode, loadAccess, isMissing } from "@/lib/family"; import { lsRaw, lsSet } from "@/lib/safe";
const AuthPanel = dynamic(() => import("@/components/AuthPanel"), { ssr: false });
const ERR: Record<string, string> = { bad_code: "That code didn't match. Check the letters and try again.", used: "That code was already used. Ask for a new one.", expired: "That code expired. Ask for a new one.",
  revoked: "That invite was cancelled. Ask for a new one.", locked: "Too many wrong tries. Wait an hour, then try again.", parent_account: "This account already runs its own family, so it can't join as a child.",
  already_member: "This account is already in a family.", own_list: "That's your own list.", own_child: "That's your own child.", child_account: "Child accounts can't be trusted adults." };
const fmt = (s: string) => { const c = s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; };
export default function Join() {
  const [me, setMe] = useState<string | null | undefined>(undefined); const [code, setCode] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof joinWithCode>> | null>(null); const [approved, setApproved] = useState(false);
  useEffect(() => { const q = new URLSearchParams(location.search); const c = q.get("code") || q.get("token") || lsRaw("crystal-join-code", ""); if (c) { setCode(fmt(c)); lsSet("crystal-join-code", fmt(c)); }
    sb().auth.getSession().then(({ data }) => setMe(data.session?.user.email ?? null)); }, []);
  // poll until approved
  const poll = useCallback(async () => { const a = await loadAccess(); if (!a) return;
    if ((a.status.role === "child" && a.status.status === "active") || a.viewing.some(v => v.status === "active")) setApproved(true); }, []);
  useEffect(() => { if (!res?.ok) return; const t = setInterval(poll, 5000); return () => clearInterval(t); }, [res, poll]);
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setBusy(true); setMsg("");
    try { const r = await joinWithCode(code); if (r.ok) { setRes(r); try { localStorage.removeItem("crystal-join-code"); } catch {} }
      else setMsg((ERR[r.error ?? ""] ?? "That code didn't work.") + (r.tries_left !== undefined && r.error === "bad_code" ? ` ${r.tries_left} tries left.` : "")); }
    catch (er) { setMsg(isMissing(er) || /017/.test(String(er)) ? "Family sharing isn't switched on yet. Ask the person who invited you to finish setup." : (er as Error).message); } finally { setBusy(false); } };
  const what = res?.kind === "list" ? `${res.owner_name}'s ${res.list === "wish" ? "Wish List" : "Shopping List"}` : res?.kind === "viewer" ? `${res.child_name}'s school information` : `${res?.owner_name ?? "your parent"}'s family`;
  return <main className="grid min-h-dvh place-items-center bg-navy p-4"><div className="w-full max-w-md space-y-4">
    <h1 className="text-center text-2xl font-bold uppercase tracking-[.08em] text-snow">Join on Crystal</h1>
    {me === undefined ? <p className="text-center text-ash">Loading…</p>
     : me === null ? <><p className="text-center text-ash">Sign in first. Your code is saved and fills in after you sign in.</p><AuthPanel title="Sign in to join" next="/join/" /></>
     : approved ? <div className="glass rounded-2xl p-6 text-center"><div className="text-xl font-bold text-snow">You&apos;re in!</div><p className="mt-2 text-ash">You now have access to {what}.</p><a className="btn btn-primary mt-4 inline-block" href="/app/">OPEN CRYSTAL</a></div>
     : res?.ok ? <div className="glass rounded-2xl p-6 text-center" role="status"><div className="text-sm font-bold uppercase tracking-[.06em] text-cyan">Almost done</div>
        <p className="mt-2 text-snow">Show or read this number to {res.owner_name ?? "the person who invited you"}. They&apos;ll tap APPROVE when it matches.</p>
        <div className="my-4 font-mono text-5xl font-bold tracking-[.3em] text-snow">{res.confirm_code}</div><p className="text-sm text-ash">Waiting for approval… this page updates by itself.</p></div>
     : <form onSubmit={submit} className="glass space-y-3 rounded-2xl p-6"><p className="text-sm text-ash">Signed in as <b className="text-snow">{me}</b></p>
        <label className="block text-xs font-semibold uppercase tracking-[.05em] text-ash" htmlFor="code">Invite Code</label>
        <input id="code" className="input text-center font-mono text-3xl tracking-[.15em]" placeholder="K7Q4-M9TX" value={code} onChange={e => setCode(fmt(e.target.value))} autoComplete="off" autoCapitalize="characters" inputMode="text" required />
        <button className="btn btn-primary w-full" disabled={busy || code.replace("-", "").length !== 8}>{busy ? "CHECKING…" : "JOIN"}</button>
        {msg && <p className="text-sm text-alert" role="alert">{msg}</p>}
        <button type="button" className="w-full text-xs text-ash hover:text-cyan" onClick={() => sb().auth.signOut().then(() => location.reload())}>Use a Different Account</button></form>}
  </div></main>;
}
