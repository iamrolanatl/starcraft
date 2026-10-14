"use client";
// Family sharing (migration 017): children, child logins, trusted adults (viewers) and Shopping/Wish List shares.
// Every call degrades gracefully: until 017 is applied, `familyReady()` is false and the UI shows a setup note.
import { sb } from "./supabase"; import { isDemo } from "./store"; import { lsRaw, lsSet } from "./safe";

export type Role = "solo" | "parent" | "child";
export interface FamStatus { role: Role; status?: string; family_id?: string; child_id?: string; confirm_code?: string | null; owner_name?: string }
export interface Viewing { id: string; child_id: string; child_name: string; owner_name: string; relationship: string; scopes: Scope[]; status: string; expires_at: string | null; confirm_code: string | null }
export interface Access { status: FamStatus; viewing: Viewing[] }
export interface Child { id: string; family_id: string; first_name: string; last_name: string | null; grade: string | null; school: string | null; district: string | null; student_id: string | null; avatar_color: string; user_id: string | null; edu_student_id: string | null; sort: number }
export interface Member { family_id: string; user_id: string; role: "parent" | "child"; status: string; confirm_code: string | null; display_name: string | null; email: string | null; child_id: string | null; joined_at: string }
export interface Viewer { id: string; child_id: string; owner: string; user_id: string; relationship: string; scopes: Scope[]; status: string; expires_at: string | null; confirm_code: string | null; viewer_name: string | null; viewer_email: string | null; last_viewed_at: string | null; joined_at: string }
export interface Invite { id: string; hint: string; email: string | null; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null; child_id?: string | null }
export interface ListShare { id: string; owner: string; list: "shopping" | "wish"; member: string; perm: "view" | "edit"; status: string; confirm_code: string | null; member_name: string | null; member_email: string | null; owner_name: string | null }
export interface FamEvent { id: number; kind: string; actor: string | null; target: string | null; detail: Record<string, unknown>; at: string }

export const SCOPES = ["grades", "assignments", "report_cards", "attendance", "schedule", "calendar", "learn"] as const;
export type Scope = typeof SCOPES[number];
export const SCOPE_LABEL: Record<Scope, string> = { grades: "Grades", assignments: "Assignments", report_cards: "Report Cards", attendance: "Attendance", schedule: "Schedule", calendar: "Calendar", learn: "Learn" };
export const PRESETS: Record<string, Scope[]> = { "Full School View": [...SCOPES], "Homework Helper": ["assignments", "learn", "schedule", "calendar"] };
export const RELATIONSHIPS = ["Mother", "Father", "Grandmother", "Grandfather", "Aunt", "Uncle", "Babysitter", "Tutor", "Other"] as const;
export const presetFor = (rel: string) => rel === "Tutor" || rel === "Babysitter" ? "Homework Helper" : "Full School View";
export const COLORS = ["#7dd3fc", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#fb923c"];

const MISSING = /PGRST20[25]|42P01|42883|does not exist|schema cache|Could not find the function/i;
export const isMissing = (e: unknown) => { const x = e as { message?: string; code?: string } | null; return !!x && MISSING.test(`${x.code ?? ""} ${x.message ?? ""}`); };
export class NotReady extends Error { constructor() { super("Family sharing needs migration 017 (Settings › Family shows the steps)."); } }
function chk<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T { if (r.error) { if (isMissing(r.error)) throw new NotReady(); throw new Error(r.error.message); } return r.data as T; }
async function rpc<T = Record<string, unknown>>(fn: string, args: Record<string, unknown> = {}): Promise<T> { return chk<T>(await sb().rpc(fn, args) as never); }

let access: Access | null = null;
/** My role (solo / parent / child) and any children I view as a trusted adult. null = 017 not applied, demo, or signed out. */
export async function loadAccess(): Promise<Access | null> {
  if (isDemo()) return null;
  try { access = await rpc<Access>("my_access"); } catch { access = null; if (selectedChild()) lsSet(CK, ""); }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("crystal-family"));
  return access;
}
export const getAccess = () => access;
/** Child login (active) or a trusted adult with no family of their own: the restricted, read-only school view. */
export function restricted(a: Access | null = access): "child" | "viewer" | null {
  if (!a) return null;
  if (a.status.role === "child" && a.status.status === "active") return "child";
  if (a.status.role !== "parent" && a.viewing.some(v => v.status === "active")) return "viewer";
  return null;
}

// ---- selected child (Education / School Hub switcher) ----
const CK = "crystal-child";
export const selectedChild = () => (typeof window === "undefined" ? "" : lsRaw(CK, ""));
export function selectChild(id: string) { lsSet(CK, id); window.dispatchEvent(new Event("crystal-child")); window.dispatchEvent(new Event("crystal-refresh")); }
/** Adds `child_id = selected` to a query when a child is selected (only set once 017 exists and children are listed). */
export function byChild<Q>(q: Q): Q { const c = selectedChild(); return c ? (q as unknown as { eq: (k: string, v: string) => Q }).eq("child_id", c) : q; }

// ---- children (parent) ----
export async function listChildren(): Promise<Child[]> { return chk<Child[]>(await sb().from("children").select("*").order("sort").order("created_at") as never) ?? []; }
export async function saveChild(c: Partial<Child>) {
  const fam = await rpc<string>("family_ensure");
  const row = { first_name: c.first_name?.trim(), last_name: c.last_name?.trim() || null, grade: c.grade?.trim() || null, school: c.school?.trim() || null, district: c.district?.trim() || null, student_id: c.student_id?.trim() || null, avatar_color: c.avatar_color || COLORS[0] };
  if (c.id) chk(await sb().from("children").update(row).eq("id", c.id) as never); else chk(await sb().from("children").insert({ ...row, family_id: fam }) as never);
}
export async function removeChild(id: string) { chk(await sb().from("children").delete().eq("id", id) as never); if (selectedChild() === id) selectChild(""); }

// ---- family members / child-login invites ----
export const listMembers = async () => chk<Member[]>(await sb().from("family_members").select("*").order("joined_at") as never) ?? [];
const INV = "id,hint,email,created_at,expires_at,used_at,revoked_at";
export async function listFamilyInvites(): Promise<Invite[]> {
  const q = (cols: string) => sb().from("family_invites").select(cols).order("created_at", { ascending: false }).limit(30);
  const r = await q(INV + ",child_id");
  // 017 granted column-level SELECT without child_id (fixed in 020); fall back so the list still loads.
  if (r.error?.code === "42501") return chk<Invite[]>(await q(INV) as never) ?? [];
  return chk<Invite[]>(r as never) ?? [];
}
export const createChildInvite = (child: string, email?: string) => rpc<{ id: string; code: string; expires_at: string }>("family_create_invite", { p_child: child, p_email: email || null });
export const decideMember = (user: string, approve: boolean) => rpc("family_decide", { p_user: user, p_approve: approve });
export const revokeMember = (user: string) => rpc("family_revoke_member", { p_user: user });
export const revokeFamilyInvite = (id: string) => rpc("family_revoke_invite", { p_invite: id });
export const leaveFamily = () => rpc("family_leave");
/** Redeems ANY code (child login, trusted adult or list share). */
export const joinWithCode = (code: string) => rpc<{ ok: boolean; kind?: string; error?: string; confirm_code?: string; status?: string; owner_name?: string; child_name?: string; list?: string; tries_left?: number; locked_until?: string; invited?: string }>("family_join", { p_code: code });

// ---- trusted adults ----
export const listViewers = async () => chk<Viewer[]>(await sb().from("child_viewers").select("*").order("joined_at") as never) ?? [];
export const listViewerInvites = async () => chk<(Invite & { relationship: string; scopes: Scope[]; outbox_id: string | null; mail_outbox?: { status: string } | null })[]>(
  await sb().from("viewer_invites").select("id,hint,email,relationship,scopes,child_id,created_at,expires_at,used_at,revoked_at,outbox_id").order("created_at", { ascending: false }).limit(30) as never) ?? [];
export const inviteViewer = (child: string, email: string, relationship: string, scopes: Scope[], expires: string | null) =>
  rpc<{ id: string; code: string; outbox_id: string }>("viewer_invite", { p_child: child, p_email: email, p_relationship: relationship, p_scopes: scopes, p_access_expires: expires ? new Date(expires + "T23:59:59").toISOString() : null, p_app_url: location.origin });
export const manageViewer = (id: string, action: "approve" | "deny" | "pause" | "resume" | "revoke" | "leave" | "edit", edit: { scopes?: Scope[]; relationship?: string; expires?: string | null } = {}) =>
  rpc("viewer_manage", { p_viewer: id, p_action: action, p_scopes: edit.scopes ?? null, p_relationship: edit.relationship ?? null,
    p_expires: edit.expires ? new Date(edit.expires + "T23:59:59").toISOString() : null, p_clear_expiry: edit.expires === null });
export const revokeViewerInvite = (id: string) => rpc("viewer_invite_revoke", { p_invite: id });
export const touchViewer = (child: string) => sb().rpc("viewer_touch", { p_child: child }).then(() => {}, () => {});

// ---- Shopping / Wish List shares ----
export const listShares = async () => chk<ListShare[]>(await sb().from("list_shares").select("*").in("status", ["pending", "active"]) as never) ?? [];
export const listShareInvites = async () => chk<(Invite & { list: string; perm: string; outbox_id: string | null })[]>(
  await sb().from("list_invites").select("id,hint,email,list,perm,created_at,expires_at,used_at,revoked_at,outbox_id").order("created_at", { ascending: false }).limit(30) as never) ?? [];
export const outboxStatus = async (ids: string[]) => ids.length ? Object.fromEntries((chk<{ id: string; status: string }[]>(await sb().from("mail_outbox").select("id,status").in("id", ids) as never) ?? []).map(r => [r.id, r.status])) as Record<string, string> : {};
export const shareList = (list: "shopping" | "wish", email: string, perm: "view" | "edit") => rpc<{ id: string; code: string; outbox_id: string }>("list_share_invite", { p_list: list, p_email: email, p_perm: perm, p_app_url: location.origin });
export const decideShare = (id: string, approve: boolean) => rpc("list_share_decide", { p_share: id, p_approve: approve });
export const setSharePerm = (id: string, perm: "view" | "edit") => rpc("list_share_set_perm", { p_share: id, p_perm: perm });
export const revokeShare = (id: string) => rpc("list_share_revoke", { p_share: id });
export const revokeShareInvite = (id: string) => rpc("list_invite_revoke", { p_invite: id });

export const listEvents = async () => chk<FamEvent[]>(await sb().from("family_events").select("*").order("at", { ascending: false }).limit(40) as never) ?? [];

/** Everything waiting for the parent/owner's Approve (child logins, trusted adults, list shares). */
export async function pendingApprovals(): Promise<{ kind: "child" | "viewer" | "list"; id: string; name: string; email: string; code: string; what: string }[]> {
  try {
    const { data: s } = await sb().auth.getSession(); const me = s.session?.user.id; if (!me) return [];
    const [m, v, l] = await Promise.all([listMembers(), listViewers(), listShares()]);
    return [
      ...m.filter(x => x.status === "pending" && x.role === "child").map(x => ({ kind: "child" as const, id: x.user_id, name: x.display_name || "Your child", email: x.email || "", code: x.confirm_code || "", what: "Child login" })),
      ...v.filter(x => x.status === "pending" && x.owner === me).map(x => ({ kind: "viewer" as const, id: x.id, name: x.viewer_name || "Trusted adult", email: x.viewer_email || "", code: x.confirm_code || "", what: `${x.relationship} · ${x.scopes.map(k => SCOPE_LABEL[k]).join(", ")}` })),
      ...l.filter(x => x.status === "pending" && x.owner === me).map(x => ({ kind: "list" as const, id: x.id, name: x.member_name || "Someone", email: x.member_email || "", code: x.confirm_code || "", what: `${x.list === "wish" ? "Wish List" : "Shopping List"} · ${x.perm === "edit" ? "Can Edit" : "Can View"}` })),
    ];
  } catch { return []; }
}
export const decide = (p: { kind: "child" | "viewer" | "list"; id: string }, approve: boolean) =>
  p.kind === "child" ? decideMember(p.id, approve) : p.kind === "viewer" ? manageViewer(p.id, approve ? "approve" : "deny") : decideShare(p.id, approve);
export const joinLink = (code: string) => `${location.origin}/join/?code=${encodeURIComponent(code)}`;
