"use client";
// /join?code=K7Q4-M9TX (also accepts ?token=). Sign in → enter the code → show the 6-digit match → wait for the owner's Approve.
import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import SpaceBackground from "@/components/SpaceBackground";
import { sb } from "@/lib/supabase"; import { joinWithCode, loadAccess, isMissing } from "@/lib/family"; import { lsRaw, lsSet } from "@/lib/safe";
const AuthPanel = dynamic(() => import("@/components/AuthPanel"), { ssr: false });
const ERR: Record<string, string> = { bad_code: "That code didn't match. Check the letters and try again.", used: "That code was already used. Ask for a new one.", expired: "That code expired. Ask for a new one.",
  revoked: "That invite was cancelled. Ask for a new one.", locked: "Too many wrong tries. Wait an hour, then try again.", parent_account: "This account already runs its own family, so it can't join as a child.",
  already_member: "This account is already in a family.", own_list: "That's your own list.", own_child: "That's your own child.", child_account: "Child accounts can't be trusted adults.", wrong_account: "This invite was sent to a different email. Sign in with the invited email address." };
const fmt = (s: string) => { const c = s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; };
export default function Join() {
  const [me, setMe] = useState<string | null | undefined>(undefined); const [code, setCode] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof joinWithCode>> | null>(null); const [approved, setApproved] = useState(false);
  useEffect(() => { const q = new URLSearchParams(location.search); const c = q.get("code") || q.get("token") || lsRaw("crystal-join-code", ""); if (c) { setCode(fmt(c)); lsSet("crystal-join-code", fmt(c)); }
    // Strip the invite ?code= before the Supabase client starts: with PKCE + detectSessionInUrl it would treat it as an auth code.
    if (q.has("code") || q.has("token")) history.replaceState(null, "", "/join/");
    sb().auth.getSession().then(({ data }) => setMe(data.session?.user.email ?? null)); }, []);
  const [auto, setAuto] = useState(false);
  useEffect(() => { if (me && !auto && !res && code.replace("-", "").length === 8) { setAuto(true); submit(); } }); // eslint-disable-line
  // poll until approved
  const poll = useCallback(async () => { const a = await loadAccess(); if (!a) return;
    if ((a.status.role === "child" && a.status.status === "active") || a.viewing.some(v => v.status === "active")) setApproved(true); }, []);
  useEffect(() => { if (!res?.ok) return; const t = setInterval(poll, 5000); return () => clearInterval(t); }, [res, poll]);
  const submit = async (e?: React.FormEvent) => { e?.preventDefault(); setBusy(true); setMsg("");
    try { const r = await joinWithCode(code); if (r.ok) { setRes(r); try { localStorage.removeItem("crystal-join-code"); } catch {} }
      else setMsg((ERR[r.error ?? ""] ?? "That code didn't work.") + (r.tries_left !== undefined && r.error === "bad_code" ? ` ${r.tries_left} tries left.` : "")); }
    catch (er) { setMsg(isMissing(er) || /017/.test(String(er)) ? "Family sharing isn't switched on yet. Ask the person who invited you to finish setup." : (er as Error).message); } finally { setBusy(false); } };
  const what = res?.kind === "list" ? `${res.owner_name}'s ${res.list === "wish" ? "Wish List" : "Shopping List"}` : res?.kind === "viewer" ? `${res.child_name}'s school information` : `${res?.owner_name ?? "your parent"}'s family`;
  const Steps = ({ at }: { at: number }) => <ol className="grid grid-cols-3 gap-2 text-center text-[11px] leading-snug">{["Sign in or create your free account", "Confirm your invite code", "They approve, and you're in"].map((t, i) =>
    <li key={t} className={`rounded-xl border px-2 py-2 ${i + 1 === at ? "border-cyan/60 bg-cyan/10 text-snow" : i + 1 < at ? "border-mint/40 text-mint" : "border-white/10 text-ash"}`}><span className="mb-0.5 block font-mono text-base font-bold">{i + 1 < at ? "✓" : i + 1}</span>{t}</li>)}</ol>;
  const chip = code && <div className="flex justify-center"><span className="rounded-full border border-cyan/40 bg-cyan/10 px-3 py-1 font-mono text-sm tracking-[.2em] text-cyan" aria-label={`Invite code ${code}`}>{code}</span></div>;
  const step = me === null ? 1 : approved ? 4 : res?.ok ? 3 : 2;
  return <><SpaceBackground calm />
  <main className="relative z-10 flex min-h-dvh items-center justify-center px-4" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))", paddingLeft: "max(1rem, env(safe-area-inset-left))", paddingRight: "max(1rem, env(safe-area-inset-right))" }}>
   <div className="glass w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-black/45 p-5 shadow-[0_0_40px_rgba(34,211,238,.15)] backdrop-blur-xl sm:p-7">
    <div className="text-center"><a href="/" className="neon text-sm font-bold tracking-[.3em]">◆ CRYSTAL</a>
      <h1 className="mt-3 text-3xl font-bold text-snow">{approved ? "Welcome aboard! 🎉" : "You're invited! ✨"}</h1>
      <p className="mt-1.5 text-sm text-ash">{approved ? `You now have access to ${what}.` : res?.ok ? `You're joining ${what}.` : "Someone you know invited you to share their family's space on Crystal: school updates, lists and more, all in one place."}</p></div>
    {chip}
    {!approved && <Steps at={step} />}
    {me === undefined ? <p className="text-center text-ash">Loading…</p>
     : me === null ? <><p className="text-center text-sm text-ash">Sign in to continue. Your code is saved and fills in automatically afterward.</p><AuthPanel title="Sign in to join" next="/join/" /></>
     : approved ? <div className="text-center"><a className="btn btn-primary inline-block" href="/app/">OPEN CRYSTAL</a></div>
     : res?.ok ? <div className="text-center" role="status">
        <p className="text-snow">Show or read this number to {res.owner_name ?? "the person who invited you"}. They&apos;ll tap APPROVE when it matches.</p>
        <div className="my-4 font-mono text-5xl font-bold tracking-[.3em] text-snow">{res.confirm_code}</div><p className="text-sm text-ash">Waiting for approval… this page updates by itself.</p></div>
     : <form onSubmit={submit} className="space-y-3"><p className="text-sm text-ash">Signed in as <b className="text-snow">{me}</b></p>
        <label className="block text-xs font-semibold uppercase tracking-[.05em] text-ash" htmlFor="code">Invite Code</label>
        <input id="code" className="input text-center font-mono text-3xl tracking-[.15em]" placeholder="K7Q4-M9TX" value={code} onChange={e => setCode(fmt(e.target.value))} autoComplete="off" autoCapitalize="characters" inputMode="text" required />
        <button className="btn btn-primary w-full" disabled={busy || code.replace("-", "").length !== 8}>{busy ? "CHECKING…" : "JOIN"}</button>
        {msg && <p className="text-sm text-alert" role="alert">{msg}</p>}
        <button type="button" className="w-full text-xs text-ash hover:text-cyan" onClick={() => sb().auth.signOut().then(() => location.reload())}>Use a Different Account</button></form>}
   </div></main></>;
}
