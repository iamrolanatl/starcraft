"use client";
// SHOPPING LIST + WISH LIST (redesign). Clean rows, labeled form, 5-second Undo, ACTIVITY log, SHARE (migration 017).
// Before 017 is applied it still works with the original columns (name / qty / price, hard delete) and hides sharing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sb } from "@/lib/supabase"; import { list as listRows, insert, update, remove, restore, onChange, isDemo, type Row } from "@/lib/store";
import { toast, Skeleton, ErrorNote } from "@/components/ui/kit"; import { sfx, haptic } from "@/lib/synth";
import * as F from "@/lib/family";
type L = "shopping" | "wish";
const PH: Record<L, { name: string; qty: string; store: string; price: string }> = {
  shopping: { name: "e.g. Whole milk", qty: "e.g. 2 gallons", store: "e.g. Kroger", price: "e.g. $3.49" },
  wish: { name: "e.g. LEGO Star Wars set", qty: "e.g. 1", store: "e.g. Target", price: "e.g. $49.99" } };
const TITLE: Record<L, string> = { shopping: "Shopping List", wish: "Wish List" };
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const t12 = (d: string) => { const x = new Date(d); const today = new Date().toDateString() === x.toDateString(); return x.toLocaleString([], today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
const Lbl = ({ t, children, grow }: { t: string; children: React.ReactNode; grow?: boolean }) => <label className={`flex flex-col gap-1 text-xs font-semibold uppercase tracking-[.05em] text-ash ${grow ? "min-w-[12rem] flex-[2]" : "min-w-[7rem] flex-1"}`}>{t}{children}</label>;
const Chip = ({ children }: { children: React.ReactNode }) => <span className="rounded-full border border-cyan/20 bg-cyan/5 px-2 py-0.5 text-xs text-ash">{children}</span>;
interface Act { id: number; actor_name: string; action: string; item_name: string; at: string; list: string }

export default function ShoppingLists({ log }: { log?: (s: string, t?: "info" | "ok" | "warn") => void }) {
  const [li, setLi] = useState<L>("shopping"); const [rows, setRows] = useState<Row[] | null>(null); const [err, setErr] = useState<{ message: string; kind?: string } | null>(null);
  const [me, setMe] = useState(""); const [v2, setV2] = useState(false); const [owner, setOwner] = useState("");   // "" = my list
  const [shares, setShares] = useState<F.ListShare[]>([]); const [panel, setPanel] = useState<"" | "activity" | "share">(""); const [acts, setActs] = useState<Act[]>([]);
  const [fam, setFam] = useState<{ owner: string; owner_name: string }[]>([]); const [famOn, setFamOn] = useState<boolean | null>(null); const famDefaulted = useRef(false);   // 022: family lists
  const [f, setF] = useState({ name: "", quantity: "", store: "", price: "" });
  const load = useCallback(async () => {
    try {
      if (!isDemo()) { const { data } = await sb().auth.getSession(); setMe(data.session?.user.id ?? "");
        const probe = await sb().from("shop_items").select("deleted_at").limit(1); setV2(!probe.error);
        setShares(await F.listShares().catch(() => []));
        const fo = await sb().rpc("family_list_owners"); const fl = fo.error ? [] : (fo.data ?? []) as { owner: string; owner_name: string; role?: string }[]; setFam(fl);
        // a child login opens the family (parent's) list by default, so everyone sees the same items
        if (!famDefaulted.current) { famDefaulted.current = true; const par = fl.find(o => o.role === "parent"); if (par && F.getAccess()?.status.role === "child") setOwner(par.owner); }
        const uid = data.session?.user.id; if (uid) { const fm = await sb().from("family_members").select("share_lists").eq("user_id", uid).eq("status", "active").maybeSingle();
          setFamOn(fm.error || !fm.data ? null : (fm.data as { share_lists?: boolean }).share_lists !== false); } }
      setRows(await listRows("shop_items")); setErr(null);
    } catch (e) { setErr(e as { message: string }); setRows([]); }
  }, []);
  useEffect(() => { load(); const off = onChange(load); addEventListener("crystal-refresh", load); return () => { off(); removeEventListener("crystal-refresh", load); }; }, [load]);
  // live updates (Supabase Realtime, RLS-filtered); harmless if Realtime isn't enabled
  useEffect(() => { if (isDemo() || !v2) return; const ch = sb().channel("shop-live").on("postgres_changes", { event: "*", schema: "public", table: "shop_items" }, () => load()).subscribe();
    const poll = setInterval(() => { if (document.visibilityState === "visible") load(); }, 8000);   // fallback if Realtime misses an event
    return () => { sb().removeChannel(ch); clearInterval(poll); }; }, [v2, load]);
  const sharedWithMe = shares.filter(s => s.member === me && s.status === "active");
  const ownerId = owner || me; const mine = !owner;
  const perm = mine || fam.some(o => o.owner === owner) ? "edit" : sharedWithMe.find(s => s.owner === owner && s.list === li)?.perm ?? "view";
  const canEdit = perm === "edit";
  const items = useMemo(() => (rows ?? []).filter(r => r.list === li && !r.deleted_at && (isDemo() || !me || r.user_id === ownerId)).sort((a, b) => Number(a.done) - Number(b.done) || String(b.created_at).localeCompare(String(a.created_at))), [rows, li, me, ownerId]);
  const total = items.filter(r => !r.done).reduce((t, r) => t + (Number(r.price) || 0), 0);
  const sharedN = shares.filter(s => s.owner === me && s.list === li && s.status === "active").length;
  const loadActs = useCallback(async () => { if (!v2) return; const { data } = await sb().from("list_activity").select("id,actor_name,action,item_name,at,list").eq("owner", ownerId).eq("list", li).order("at", { ascending: false }).limit(50); setActs((data ?? []) as Act[]); }, [v2, ownerId, li]);
  useEffect(() => { if (panel === "activity") loadActs(); }, [panel, loadActs, rows]);

  const add = async (e: React.FormEvent) => { e.preventDefault(); const name = f.name.trim(); if (!name) return toast("Enter a product name", "warn");
    const price = f.price ? Number(f.price.replace(/[^0-9.]/g, "")) : null;
    const row: Record<string, unknown> = v2 ? { list: li, name, quantity: f.quantity.trim() || null, store: f.store.trim() || null, price: Number.isFinite(price) ? price : null, ...(mine ? {} : { user_id: owner }) }
      : { list: li, name, qty: Number(f.quantity) || 1, price: Number.isFinite(price) ? price : null };
    try { await insert("shop_items", row); setF({ name: "", quantity: "", store: "", price: "" }); sfx("success"); haptic(10); log?.(`Added ${name} to ${TITLE[li]}`, "ok"); } catch (er) { toast((er as Error).message, "warn"); } };
  const toggle = async (r: Row) => { setRows(x => x?.map(y => y.id === r.id ? { ...y, done: !r.done } : y) ?? null); try { await update("shop_items", r.id, { done: !r.done }); } catch (e) { toast((e as Error).message, "warn"); load(); } };
  const del = async (r: Row) => {
    setRows(x => x?.filter(y => y.id !== r.id) ?? null); sfx("close");
    try { if (v2) await update("shop_items", r.id, { deleted_at: new Date().toISOString() }); else await remove("shop_items", r.id); } catch (e) { toast(`Couldn't delete: ${(e as Error).message}`, "warn"); return load(); }
    toast(`Deleted ${r.name}`, "info", { ms: 5000, action: { label: "UNDO", run: async () => { try { if (v2) await update("shop_items", r.id, { deleted_at: null }); else await restore("shop_items", r); toast("Restored"); } catch (e) { toast(`Undo failed: ${(e as Error).message}`, "warn"); } } } });
  };
  const owners = [...new Map([...fam.map(o => [o.owner, o.owner_name || "Family"] as [string, string]), ...sharedWithMe.filter(s => s.list === li).map(s => [s.owner, s.owner_name || "Shared"] as [string, string])]).entries()];

  return (<div className="space-y-3">
    <div role="tablist" data-sticky-tabs className="pill-tabs">{(["shopping", "wish"] as L[]).map((k, i) => <button key={k} role="tab" style={{ "--i": i } as React.CSSProperties} aria-selected={li === k} onClick={() => { setLi(k); setOwner(""); setPanel(""); }} className="pill-tab">{TITLE[k].toUpperCase()}</button>)}
      {v2 && <button role="tab" aria-selected={panel === "activity"} onClick={() => setPanel(panel === "activity" ? "" : "activity")} className="pill-tab">ACTIVITY</button>}</div>
    {owners.length > 0 && <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Whose list">
      <button role="radio" aria-checked={mine} onClick={() => setOwner("")} className={`tap rounded-full border px-3 py-1 text-sm font-semibold uppercase ${mine ? "border-cyan bg-cyan/15 text-snow" : "border-cyan/20 text-ash"}`}>MY {TITLE[li].toUpperCase()}</button>
      {owners.map(([id, n]) => <button key={id} role="radio" aria-checked={owner === id} onClick={() => setOwner(id)} className={`tap rounded-full border px-3 py-1 text-sm font-semibold uppercase ${owner === id ? "border-cyan bg-cyan/15 text-snow" : "border-cyan/20 text-ash"}`}>{n}&apos;S {TITLE[li].toUpperCase()}</button>)}</div>}

    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-snow">{items.length} {items.length === 1 ? "item" : "items"}</span><span className="text-ash">·</span><span className="text-ash">Total <b className="text-snow">{money(total)}</b>{items.some(r => r.done) ? " (not counting checked items)" : ""}</span>
      {!mine && <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-xs font-bold uppercase text-cyan">{canEdit ? "Can Edit" : "Can View"}</span>}
      {mine && v2 && !isDemo() && <span className="ml-auto flex items-center gap-2">{sharedN > 0 && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-bold uppercase text-emerald-300">Shared With {sharedN}</span>}
        <button className="btn btn-ghost" onClick={() => setPanel(panel === "share" ? "" : "share")}>SHARE</button></span>}
    </div>

    {panel === "share" && mine && famOn !== null && <label className="glass flex items-center gap-3 rounded-xl p-3 text-sm text-snow"><input type="checkbox" checked={famOn}
      onChange={async e => { const on = e.target.checked; const r = await sb().rpc("family_set_list_sharing", { p_on: on }); if (r.error) toast(r.error.message, "warn"); else { setFamOn(on); toast(on ? "Your family can see and edit your lists" : "Your lists are private from your family"); } }} />
      Share my Shopping List and Wish List with my family (they can add and delete items; every change is in Activity)</label>}
    {panel === "share" && mine && <SharePanel li={li} shares={shares.filter(s => s.owner === me && s.list === li)} onChange={load} />}
    {panel === "activity" && <div className="glass rounded-xl p-3" aria-label="Activity"><div className="mb-2 text-xs font-bold uppercase tracking-[.06em] text-cyan">Activity · {TITLE[li]}</div>
      <ul className="space-y-1 text-sm">{acts.map(a => <li key={a.id} className="text-snow">{a.actor_name} {a.action} <b>{a.item_name}</b> <span className="text-ash">· {t12(a.at)}</span></li>)}{!acts.length && <li className="text-ash">No activity yet.</li>}</ul></div>}

    {canEdit && <form onSubmit={add} className="glass flex flex-wrap items-end gap-3 rounded-xl p-3">
      <Lbl t="Product Name" grow><input className="input" required placeholder={PH[li].name} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Lbl>
      <Lbl t="Quantity"><input className="input" placeholder={PH[li].qty} value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })} /></Lbl>
      {v2 && <Lbl t="Store"><input className="input" placeholder={PH[li].store} value={f.store} onChange={e => setF({ ...f, store: e.target.value })} /></Lbl>}
      <Lbl t="Price"><input className="input" inputMode="decimal" placeholder={PH[li].price} value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Lbl>
      <button className="btn btn-primary min-h-11 px-6 text-base font-bold">ADD ITEM</button></form>}

    {rows === null ? <Skeleton rows={3} /> : err ? <ErrorNote err={err} /> : !items.length ? <p className="py-4 text-center text-ash">{TITLE[li]} is empty.{canEdit ? " Add your first item above." : ""}</p> :
    <ul className="divide-y divide-cyan/10 rounded-xl border border-cyan/10">{items.map(r => <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
      <input type="checkbox" checked={!!r.done} disabled={!canEdit} onChange={() => toggle(r)} className="h-5 w-5 accent-[#3ef2e0]" aria-label={`Got ${r.name}`} />
      <div className="min-w-0 flex-1"><div className={`text-base ${r.done ? "text-slate line-through" : "text-snow"}`}>{String(r.name)}</div>
        <div className="mt-0.5 flex flex-wrap gap-1.5">{(r.quantity || (r.qty && Number(r.qty) !== 1)) ? <Chip>{String(r.quantity ?? r.qty)}</Chip> : null}{r.store ? <Chip>{String(r.store)}</Chip> : null}{r.price != null && r.price !== "" ? <Chip>{money(Number(r.price))}</Chip> : null}</div></div>
      {canEdit && <button onClick={() => del(r)} className="btn btn-ghost !px-3 text-sm text-alert" aria-label={`Delete ${r.name}`}>🗑 DELETE</button>}</li>)}</ul>}
  </div>);
}

function SharePanel({ li, shares, onChange }: { li: L; shares: F.ListShare[]; onChange: () => void }) {
  const [email, setEmail] = useState(""); const [perm, setPerm] = useState<"view" | "edit">("view"); const [busy, setBusy] = useState(false);
  const [inv, setInv] = useState<Awaited<ReturnType<typeof F.listShareInvites>>>([]); const [ob, setOb] = useState<Record<string, string>>({});
  const li2 = useCallback(async () => { try { const i = (await F.listShareInvites()).filter(x => x.list === li && !x.used_at && !x.revoked_at); setInv(i); setOb(await F.outboxStatus(i.map(x => x.outbox_id!).filter(Boolean))); } catch {} }, [li]);
  useEffect(() => { li2(); }, [li2]);
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); toast(ok); onChange(); li2(); } catch (e) { toast((e as Error).message, "warn"); } };
  return <div className="glass space-y-3 rounded-xl p-3">
    <div className="text-xs font-bold uppercase tracking-[.06em] text-cyan">Share Your {TITLE[li]}</div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await F.shareList(li, email, perm); toast(`Invite queued to ${email}. It sends from your email shortly.`); setEmail(""); li2(); } catch (er) { toast((er as Error).message, "warn"); } finally { setBusy(false); } }}>
      <Lbl t="Their Email" grow><input className="input" type="email" required placeholder="e.g. friend@example.com" value={email} onChange={e => setEmail(e.target.value)} /></Lbl>
      <Lbl t="Access"><select className="input" value={perm} onChange={e => setPerm(e.target.value as "view" | "edit")}><option value="view">Can View</option><option value="edit">Can Edit</option></select></Lbl>
      <button className="btn btn-primary min-h-11" disabled={busy}>{busy ? "QUEUING…" : "SEND INVITE"}</button></form>
    <p className="text-xs text-ash">SEND INVITE emails them a one-time code from your Gmail. When they enter it, you&apos;ll see a 6-digit number to match before you tap APPROVE.</p>
    <F_Approvals />
    {shares.length > 0 && <ul className="space-y-2">{shares.map(s => <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex-1 text-snow">{s.member_name || s.member_email} <span className="text-ash">{s.member_email}</span> {s.status === "pending" && <span className="text-amber-200">· waiting for your approval</span>}</span>
      <select className="input w-32" value={s.perm} aria-label="Access" onChange={e => run(() => F.setSharePerm(s.id, e.target.value as "view" | "edit"), "Access changed")()}><option value="view">Can View</option><option value="edit">Can Edit</option></select>
      <button className="btn btn-ghost text-alert" onClick={run(() => F.revokeShare(s.id), "Access removed")}>REMOVE</button></li>)}</ul>}
    {inv.map(i => { const st = i.outbox_id ? ob[i.outbox_id] : undefined; return <div key={i.id} className="flex flex-wrap items-center gap-2 text-sm text-ash">
      <span className="flex-1">{i.email} · {i.perm === "edit" ? "Can Edit" : "Can View"} · invite {st === "sent" ? "SENT" : st === "failed" ? "FAILED" : st === "cancelled" ? "CANCELLED" : "QUEUED"}</span>
      <button className="btn btn-ghost" onClick={run(() => F.revokeShareInvite(i.id), st === "queued" ? "Invite cancelled" : "Invite revoked")}>{st === "queued" ? "CANCEL" : "REVOKE INVITE"}</button></div>; })}
  </div>;
}
import { Approvals as F_Approvals } from "@/components/Family";
