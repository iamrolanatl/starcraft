"use client";
// Settings › Family: children (Add / Edit / Remove), child logins (code + QR + approve), trusted adults (Share Child's Education),
// pending approvals with the 6-digit match, and the activity log. All server rules live in migration 017 (RLS + RPCs).
import { useCallback, useEffect, useState } from "react";
import * as F from "@/lib/family"; import { toast } from "@/components/ui/kit"; import QrCode from "@/components/QrCode";
const H = ({ children }: { children: React.ReactNode }) => <h3 className="mt-5 mb-2 text-sm font-bold uppercase tracking-[.06em] text-cyan">{children}</h3>;
const Lbl = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[.05em] text-ash">{t}{children}</label>;
const when = (d?: string | null) => d ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Never";
const nm = (c?: F.Child) => c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "Child";
export function Avatar({ c, size = 32 }: { c: Pick<F.Child, "first_name" | "avatar_color">; size?: number }) {
  return <span aria-hidden className="grid shrink-0 place-items-center rounded-full font-bold text-navy" style={{ width: size, height: size, background: c.avatar_color, fontSize: size * 0.45 }}>{c.first_name.slice(0, 1).toUpperCase()}</span>;
}
const EVENT: Record<string, string> = { invite: "Created a child login invite", invite_revoked: "Revoked a child login invite", join: "Entered a code (waiting for approval)", join_failed: "Wrong or expired code", locked: "Locked after 5 wrong codes",
  approve: "Approved a child login", deny: "Denied a child login", revoke: "Removed a child login", leave: "Left the family", view: "Viewed school information",
  viewer_invite: "Invited a trusted adult", viewer_join: "Trusted adult entered a code", viewer_approve: "Approved a trusted adult", viewer_deny: "Denied a trusted adult", viewer_pause: "Paused access",
  viewer_resume: "Resumed access", viewer_revoke: "Revoked access", viewer_edit: "Changed access", viewer_leave: "Trusted adult left", viewer_invite_revoked: "Cancelled a trusted adult invite",
  share_invite: "Shared a list", share_join: "Entered a list code", share_approve: "Approved list access", share_deny: "Denied list access", share_revoke: "Removed list access", share_perm: "Changed list permission", share_leave: "Left a shared list", share_invite_revoked: "Cancelled a list invite" };

export function Approvals({ onDone }: { onDone?: () => void }) {
  const [p, setP] = useState<Awaited<ReturnType<typeof F.pendingApprovals>>>([]);
  const load = useCallback(() => { F.pendingApprovals().then(setP); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); addEventListener("crystal-family", load); return () => { clearInterval(t); removeEventListener("crystal-family", load); }; }, [load]);
  if (!p.length) return null;
  return <div className="space-y-2" role="region" aria-label="Waiting for your approval">{p.map(x =>
    <div key={x.kind + x.id} className="glass rounded-xl border border-amber-300/40 p-3">
      <div className="text-xs font-bold uppercase tracking-[.06em] text-amber-200">Approval Needed · {x.what}</div>
      <div className="mt-1 text-snow"><b>{x.name}</b> <span className="text-ash">{x.email}</span></div>
      <div className="mt-2 text-sm text-ash">Check that their screen shows this same number:</div>
      <div className="my-1 font-mono text-3xl font-bold tracking-[.3em] text-snow" aria-label={`Confirmation code ${x.code.split("").join(" ")}`}>{x.code.slice(0, 3)} {x.code.slice(3)}</div>
      <div className="flex gap-2"><button className="btn btn-primary" onClick={async () => { try { await F.decide(x, true); toast(`Approved ${x.name}`); load(); onDone?.(); } catch (e) { toast((e as Error).message, "warn"); } }}>APPROVE</button>
        <button className="btn btn-ghost" onClick={async () => { await F.decide(x, false).catch(() => {}); toast(`Denied ${x.name}`, "info"); load(); onDone?.(); }}>DENY</button></div>
    </div>)}</div>;
}

function CodeCard({ code, title, onClose }: { code: string; title: string; onClose: () => void }) {
  const link = F.joinLink(code);
  return <div className="glass mt-2 rounded-xl border border-cyan/30 p-3">
    <div className="text-xs font-bold uppercase tracking-[.06em] text-cyan">{title}</div>
    <div className="mt-2 flex flex-wrap items-center gap-4"><QrCode text={link} label={`QR code for invite ${code}`} />
      <div className="min-w-0 flex-1 space-y-2"><div className="font-mono text-4xl font-bold tracking-[.12em] text-snow">{code}</div>
        <div className="break-all text-sm text-ash">{link}</div>
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Link copied"))}>COPY LINK</button>
          <button className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(code).then(() => toast("Code copied"))}>COPY CODE</button>
          <a className="btn btn-ghost" href={`mailto:?subject=${encodeURIComponent("Join our family on Crystal")}&body=${encodeURIComponent(`Your Crystal invite code: ${code}\nOpen: ${link}\n\nSign in, enter the code, then tell me the 6-digit number you see.`)}`}>OPEN IN MY EMAIL APP</a>
          <button className="btn btn-ghost" onClick={onClose}>DONE</button></div>
        <p className="text-xs text-ash">Works once, expires in 7 days. Nothing is emailed automatically. This code is shown only now.</p></div></div></div>;
}

function ChildForm({ c, onSave, onCancel }: { c: Partial<F.Child>; onSave: (c: Partial<F.Child>) => void; onCancel: () => void }) {
  const [f, setF] = useState<Partial<F.Child>>({ avatar_color: F.COLORS[0], ...c });
  const inp = (k: keyof F.Child, t: string, ph: string) => <Lbl t={t}><input className="input" value={(f[k] as string) ?? ""} placeholder={ph} onChange={e => setF({ ...f, [k]: e.target.value })} /></Lbl>;
  return <form className="glass mt-2 grid grid-cols-1 gap-3 rounded-xl p-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (f.first_name?.trim()) onSave(f); }}>
    {inp("first_name", "First Name (required)", "e.g. Eli")}{inp("last_name", "Last Name", "e.g. Chowdhury")}{inp("grade", "Grade", "e.g. 7")}{inp("school", "School", "e.g. Dickerson Middle School")}
    {inp("district", "District", "e.g. Cobb")}{inp("student_id", "Student ID", "e.g. 1351101")}
    <Lbl t="Avatar Color"><span className="flex gap-2">{F.COLORS.map(x => <button type="button" key={x} aria-label={`Color ${x}`} aria-pressed={f.avatar_color === x} onClick={() => setF({ ...f, avatar_color: x })} className={`h-8 w-8 rounded-full border-2 ${f.avatar_color === x ? "border-snow" : "border-transparent"}`} style={{ background: x }} />)}</span></Lbl>
    <div className="flex items-end gap-2"><button className="btn btn-primary">SAVE CHILD</button><button type="button" className="btn btn-ghost" onClick={onCancel}>CANCEL</button></div></form>;
}

function ViewerForm({ kids, onSent }: { kids: F.Child[]; onSent: () => void }) {
  const [child, setChild] = useState(kids[0]?.id ?? ""); const [email, setEmail] = useState(""); const [rel, setRel] = useState("Grandmother");
  const [scopes, setScopes] = useState<F.Scope[]>(F.PRESETS["Full School View"]); const [exp, setExp] = useState(""); const [busy, setBusy] = useState(false);
  const pick = (r: string) => { setRel(r); setScopes(F.PRESETS[F.presetFor(r)]); };
  const preset = Object.entries(F.PRESETS).find(([, v]) => v.length === scopes.length && v.every(s => scopes.includes(s)))?.[0] ?? "Custom";
  return <form className="glass grid grid-cols-1 gap-3 rounded-xl p-3 sm:grid-cols-2" onSubmit={async e => { e.preventDefault(); setBusy(true);
      try { await F.inviteViewer(child, email, rel, scopes, exp || null); toast(`Invite queued to ${email}. It sends from your email shortly.`); setEmail(""); onSent(); } catch (er) { toast((er as Error).message, "warn"); } finally { setBusy(false); } }}>
    <Lbl t="Child"><select className="input" value={child} onChange={e => setChild(e.target.value)}>{kids.map(k => <option key={k.id} value={k.id}>{nm(k)}</option>)}</select></Lbl>
    <Lbl t="Their Email"><input className="input" type="email" required placeholder="e.g. grandma@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Lbl>
    <Lbl t="Relationship"><select className="input" value={rel} onChange={e => pick(e.target.value)}>{F.RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}</select></Lbl>
    <Lbl t="Access Level"><select className="input" value={preset} onChange={e => e.target.value !== "Custom" && setScopes(F.PRESETS[e.target.value])}>{["Full School View", "Homework Helper", "Custom"].map(r => <option key={r}>{r}</option>)}</select></Lbl>
    <fieldset className="sm:col-span-2"><legend className="mb-1 text-xs font-semibold uppercase tracking-[.05em] text-ash">Sections They Can See</legend>
      <div className="flex flex-wrap gap-2">{F.SCOPES.map(s => <label key={s} className={`tap flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${scopes.includes(s) ? "border-cyan bg-cyan/10 text-snow" : "border-cyan/20 text-ash"}`}>
        <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes(scopes.includes(s) ? scopes.filter(x => x !== s) : [...scopes, s])} />{F.SCOPE_LABEL[s]}</label>)}</div></fieldset>
    <Lbl t="Access Ends (Optional)"><input className="input" type="date" value={exp} min={new Date().toISOString().slice(0, 10)} onChange={e => setExp(e.target.value)} /></Lbl>
    <div className="flex items-end"><button className="btn btn-primary w-full" disabled={busy || !scopes.length || !child}>{busy ? "QUEUING…" : "SEND INVITE"}</button></div>
    <p className="text-xs text-ash sm:col-span-2">Pressing SEND INVITE emails them a one-time code from your Gmail. They are read-only, never see Finance, Mail, Health, other children or excuse letters, and can&apos;t start a sync. You approve them after matching a 6-digit number.</p></form>;
}

export default function Family() {
  const [ready, setReady] = useState<boolean | null>(null); const [kids, setKids] = useState<F.Child[]>([]); const [mem, setMem] = useState<F.Member[]>([]);
  const [inv, setInv] = useState<F.Invite[]>([]); const [vw, setVw] = useState<F.Viewer[]>([]); const [vinv, setVinv] = useState<Awaited<ReturnType<typeof F.listViewerInvites>>>([]);
  const [ob, setOb] = useState<Record<string, string>>({}); const [ev, setEv] = useState<F.FamEvent[]>([]); const [edit, setEdit] = useState<Partial<F.Child> | null>(null);
  const [code, setCode] = useState<{ code: string; title: string } | null>(null); const [acc, setAcc] = useState<F.Access | null>(null); const [ve, setVe] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const a = await F.loadAccess(); setAcc(a); if (!a) { setReady(false); return; }
      if (a.status.role === "child") { setReady(true); return; }
      // Each list loads on its own: one failing section (e.g. a missing column grant) must never hide the children.
      const r = await Promise.allSettled([F.listChildren(), F.listMembers(), F.listFamilyInvites(), F.listViewers(), F.listViewerInvites(), F.listEvents()]);
      const bad = r.find(x => x.status === "rejected") as PromiseRejectedResult | undefined;
      if (r[0].status === "rejected") throw r[0].reason;
      const ok = <T,>(x: PromiseSettledResult<T>, d: T) => x.status === "fulfilled" ? x.value : d;
      const vi = ok(r[4], []);
      setKids(ok(r[0], [])); setMem(ok(r[1], [])); setInv(ok(r[2], [])); setVw(ok(r[3], []).filter(x => x.owner !== x.user_id)); setVinv(vi); setEv(ok(r[5], []));
      setOb(await F.outboxStatus(vi.map(x => x.outbox_id!).filter(Boolean)).catch(() => ({}))); setReady(true);
      if (bad) console.warn("Family: a section failed to load", bad.reason);
    } catch (e) { setReady(e instanceof F.NotReady ? false : true); if (!(e instanceof F.NotReady)) toast((e as Error).message, "warn"); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); load(); } catch (e) { toast((e as Error).message, "warn"); } };
  if (ready === null) return <p className="py-4 text-ash">Loading family…</p>;
  if (!ready) return <div className="glass mt-3 rounded-xl p-4 text-ash"><b className="text-snow">Family sharing is almost ready.</b> It needs one database update (migration 017) in the Supabase SQL Editor. Until then, everything else in Crystal works as before.</div>;
  if (acc?.status.role === "child") return <div className="mt-3 space-y-3"><div className="glass rounded-xl p-4 text-snow">You&apos;re in <b>{acc.status.owner_name}</b>&apos;s family as a child ({acc.status.status === "pending" ? "waiting for approval" : acc.status.status}).</div>
    {acc.status.status === "pending" && acc.status.confirm_code && <div className="glass rounded-xl p-4"><div className="text-sm text-ash">Show this number to your parent:</div><div className="font-mono text-4xl font-bold tracking-[.3em] text-snow">{acc.status.confirm_code}</div></div>}
    <button className="btn btn-ghost" onClick={run(F.leaveFamily, "You left the family")}>LEAVE FAMILY</button></div>;
  const kid = (id?: string | null) => kids.find(k => k.id === id);
  const openInv = inv.filter(i => !i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  return <div className="pb-4">
    <Approvals onDone={load} />
    <H>Children</H>
    <ul className="space-y-2">{kids.map(c => { const login = mem.find(m => m.child_id === c.id && m.status !== "revoked" && m.status !== "denied");
      return <li key={c.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-3"><Avatar c={c} size={40} />
        <div className="min-w-0 flex-1"><div className="font-semibold text-snow">{nm(c)}</div><div className="text-sm text-ash">{[c.grade && `Grade ${c.grade}`, c.school, c.district, c.student_id && `ID ${c.student_id}`].filter(Boolean).join(" · ") || "No school details yet"}</div>
          <div className="text-xs text-ash">{login ? `Login: ${login.display_name || login.email} (${login.status === "active" ? "Active" : "Waiting for approval"})` : "No login yet"}</div></div>
        <span className="flex flex-wrap gap-2">{!login && <button className="btn btn-primary" onClick={async () => { try { const r = await F.createChildInvite(c.id); setCode({ code: r.code, title: `Login invite for ${c.first_name}` }); load(); } catch (e) { toast((e as Error).message, "warn"); } }}>INVITE YOUR CHILD</button>}
          {login && <button className="btn btn-ghost" onClick={() => confirm(`Remove ${c.first_name}'s login? Their access ends now.`) && run(() => F.revokeMember(login.user_id), "Login removed")()}>REMOVE LOGIN</button>}
          <button className="btn btn-ghost" onClick={() => setEdit(c)}>EDIT</button>
          <button className="btn btn-ghost text-alert" onClick={() => confirm(`Remove ${c.first_name}? Their school history stays, but it is no longer tagged to this child.`) && run(() => F.removeChild(c.id), "Child removed")()}>REMOVE</button></span></li>; })}</ul>
    {edit ? <ChildForm c={edit} onCancel={() => setEdit(null)} onSave={c => run(() => F.saveChild(c), "Child saved")().then(() => setEdit(null))} /> : <button className="btn btn-primary mt-2" onClick={() => setEdit({})}>ADD CHILD</button>}
    {code && <CodeCard code={code.code} title={code.title} onClose={() => setCode(null)} />}
    {openInv.length > 0 && <><H>Open Child Login Invites</H><ul className="space-y-1">{openInv.map(i => <li key={i.id} className="flex items-center gap-2 text-sm text-ash">
      <span className="flex-1">{kid(i.child_id)?.first_name ?? "Child"} · code ending {i.hint} · expires {when(i.expires_at)}</span><button className="btn btn-ghost" onClick={run(() => F.revokeFamilyInvite(i.id), "Invite revoked")}>REVOKE INVITE</button></li>)}</ul></>}

    <H>Share Child&apos;s Education</H>
    {kids.length ? <ViewerForm kids={kids} onSent={load} /> : <p className="text-sm text-ash">Add a child first.</p>}
    <H>Shared With</H>
    {!vw.length && !vinv.some(i => !i.used_at && !i.revoked_at) && <p className="text-sm text-ash">No one yet.</p>}
    <ul className="space-y-2">{vw.filter(v => v.status !== "revoked" && v.status !== "denied").map(v => <li key={v.id} className="glass rounded-xl p-3">
      <div className="flex flex-wrap items-center gap-2"><b className="text-snow">{v.viewer_name || v.viewer_email}</b><span className="rounded-full bg-cyan/15 px-2 py-0.5 text-xs font-semibold uppercase text-cyan">{v.relationship}</span>
        <span className="text-sm text-ash">for {kid(v.child_id)?.first_name}</span><span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold uppercase ${v.status === "active" ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-300/15 text-amber-200"}`}>{v.status === "pending" ? "Waiting for approval" : v.status}</span></div>
      <div className="mt-1 text-sm text-ash">{v.scopes.map(s => F.SCOPE_LABEL[s]).join(", ")}{v.expires_at ? ` · access ends ${when(v.expires_at)}` : ""} · last viewed {when(v.last_viewed_at)}</div>
      {ve === v.id ? <EditViewer v={v} onDone={() => { setVe(null); load(); }} /> :
      <div className="mt-2 flex flex-wrap gap-2"><button className="btn btn-ghost" onClick={() => setVe(v.id)}>EDIT</button>
        {v.status === "active" && <button className="btn btn-ghost" onClick={run(() => F.manageViewer(v.id, "pause"), "Access paused")}>PAUSE</button>}
        {v.status === "paused" && <button className="btn btn-ghost" onClick={run(() => F.manageViewer(v.id, "resume"), "Access resumed")}>RESUME</button>}
        <button className="btn btn-ghost text-alert" onClick={() => confirm("Revoke access now?") && run(() => F.manageViewer(v.id, "revoke"), "Access revoked")()}>REVOKE</button></div>}</li>)}
      {vinv.filter(i => !i.used_at && !i.revoked_at).map(i => { const st = i.outbox_id ? ob[i.outbox_id] : undefined; return <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm text-ash">
        <span className="flex-1">{i.email} · {i.relationship} · invite {st === "sent" ? "sent" : st === "failed" ? "failed to send" : st === "cancelled" ? "cancelled" : "queued"} · expires {when(i.expires_at)}</span>
        <button className="btn btn-ghost" onClick={run(() => F.revokeViewerInvite(i.id), st === "queued" ? "Invite cancelled" : "Invite revoked")}>{st === "queued" ? "CANCEL" : "REVOKE INVITE"}</button></li>; })}</ul>

    <H>Family Activity</H>
    <ul className="space-y-1 text-sm">{ev.slice(0, 20).map(e => <li key={e.id} className="flex gap-2 text-ash"><span className="w-36 shrink-0">{when(e.at)}</span><span className="text-snow">{EVENT[e.kind] ?? e.kind}</span></li>)}
      {!ev.length && <li className="text-ash">Nothing yet.</li>}</ul>
  </div>;
}

function EditViewer({ v, onDone }: { v: F.Viewer; onDone: () => void }) {
  const [s, setS] = useState<F.Scope[]>(v.scopes); const [rel, setRel] = useState(v.relationship); const [exp, setExp] = useState(v.expires_at?.slice(0, 10) ?? "");
  return <div className="mt-2 space-y-2"><div className="flex flex-wrap gap-2">{F.SCOPES.map(k => <label key={k} className="flex items-center gap-1 text-sm text-snow"><input type="checkbox" checked={s.includes(k)} onChange={() => setS(s.includes(k) ? s.filter(x => x !== k) : [...s, k])} />{F.SCOPE_LABEL[k]}</label>)}</div>
    <div className="flex flex-wrap gap-2"><select className="input w-44" value={rel} onChange={e => setRel(e.target.value)} aria-label="Relationship">{F.RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}</select>
      <input className="input w-44" type="date" value={exp} onChange={e => setExp(e.target.value)} aria-label="Access ends" />
      <button className="btn btn-primary" disabled={!s.length} onClick={async () => { try { await F.manageViewer(v.id, "edit", { scopes: s, relationship: rel, expires: exp || null }); toast("Access updated"); onDone(); } catch (e) { toast((e as Error).message, "warn"); } }}>SAVE</button>
      <button className="btn btn-ghost" onClick={onDone}>CANCEL</button></div></div>;
}
