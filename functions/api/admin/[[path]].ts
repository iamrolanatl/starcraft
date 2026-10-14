// /api/admin/* — owner-only command center API. Gate 1: verify the Supabase JWT (GET /auth/v1/user) and require the email in
// ADMIN_EMAILS (default iamrolan@gmail.com). Gate 2: every RPC re-checks public.admins via admin_guard() inside Postgres.
// Calls run with the caller's own JWT + anon key; no service-role key is used or needed. Rate-limited in _middleware.
import { body, json } from "../../_lib/http";
type Env = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; ADMIN_EMAILS?: string };
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
const GET_OPS: Record<string, (q: URLSearchParams) => [string, Record<string, unknown>]> = {
  whoami: () => ["admin_whoami", {}], overview: () => ["admin_overview", {}],
  users: q => ["admin_users", { p_q: q.get("q") || "", p_limit: Number(q.get("limit") || 50) }],
  user: q => ["admin_user_detail", { p_uid: q.get("id") }], tables: () => ["admin_tables", {}],
  table: q => ["admin_table_info", { t: q.get("t") }],
  browse: q => ["admin_browse", { t: q.get("t"), p_col: q.get("col") || null, p_val: q.get("val") || null, p_limit: Number(q.get("limit") || 50), p_offset: Number(q.get("offset") || 0) }],
  sync: () => ["admin_sync", {}], audit: q => ["admin_audit_list", { p_limit: Number(q.get("limit") || 100), p_q: q.get("q") || "" }],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const op = String((params.path as string[] | undefined)?.[0] || "");
  const anon = env.SUPABASE_ANON_KEY; const base = (env.SUPABASE_URL || SB).replace(/\/$/, "");
  if (!anon) return json({ error: "server not configured" }, 500);
  const jwt = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt === anon) return json({ error: "forbidden" }, 403);
  let email = "";
  try { const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } }); if (r.ok) email = String(((await r.json()) as { email?: string }).email || "").toLowerCase(); } catch { /* fallthrough */ }
  const allow = (env.ADMIN_EMAILS || "iamrolan@gmail.com").toLowerCase().split(/[,\s]+/).filter(Boolean);
  if (!email || !allow.includes(email)) { console.log(JSON.stringify({ type: "admin_denied", op, email: email ? "nonadmin" : "unverified", ray: request.headers.get("cf-ray") })); return json({ error: "forbidden" }, 403); }
  let fn: string; let args: Record<string, unknown>;
  if (request.method === "GET" && GET_OPS[op]) [fn, args] = GET_OPS[op](new URL(request.url).searchParams);
  else if (request.method === "POST" && op === "action") {
    const b = await body<{ action?: string; target?: string; args?: Record<string, unknown>; confirm?: string }>(request);
    if (!b?.action || !UUID.test(String(b.target))) return json({ error: "action and target uuid required" }, 400);
    fn = "admin_action"; args = { p_action: b.action, p_target: b.target, p_args: b.args || {}, p_confirm: b.confirm || "" };
  } else if (request.method === "POST" && op === "row") {
    const b = await body<{ t?: string; id?: string; patch?: Record<string, unknown>; confirm?: string }>(request);
    if (!b?.t || !b.id || !b.patch) return json({ error: "t, id, patch required" }, 400);
    fn = "admin_row_update"; args = { t: b.t, p_id: String(b.id), p_patch: b.patch, p_confirm: b.confirm || "" };
  } else return json({ error: "unknown op" }, 404);
  if (op === "user" && !UUID.test(String(args.p_uid))) return json({ error: "bad id" }, 400);
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const txt = await r.text();
  if (r.ok) return new Response(txt, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  let e: { code?: string; message?: string } = {}; try { e = JSON.parse(txt); } catch { /* */ }
  if (e.code === "PGRST202" || r.status === 404) return json({ pending: true, error: "Migration 019_admin.sql has not been applied yet." }, 503);
  if (e.code === "42501") return json({ error: "forbidden" }, 403);
  if (e.code === "P0429") return json({ error: "rate limited" }, 429);
  return json({ error: String(e.message || "error").slice(0, 300) }, 400);
};
