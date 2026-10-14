// Server-side Google access for Crystal's Drive section. The refresh token lives in private.google_tokens (migration 009)
// and is read only here, via the service-role-only RPC svc_google_token. It never reaches the browser.
import { json } from "./http";
export interface GEnv { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string; SUPABASE_SERVICE_ROLE_KEY?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; OWNER_EMAIL?: string }
const url = (e: GEnv) => (e.SUPABASE_URL || "https://ogrrjkxkccbywbiikcak.supabase.co").replace(/\/$/, "");
export class HttpErr extends Error { constructor(public status: number, msg: string, public code?: string) { super(msg); } }
export const fail = (e: unknown) => e instanceof HttpErr ? json({ error: e.message, code: e.code }, e.status) : json({ error: (e as Error).message || "error" }, 500);

/** Verify the caller's Supabase JWT and that it is the owner account. */
export async function caller(req: Request, e: GEnv): Promise<{ id: string; email: string; jwt: string }> {
  const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpErr(401, "Sign in first.", "signin");
  const r = await fetch(`${url(e)}/auth/v1/user`, { headers: { apikey: e.SUPABASE_ANON_KEY || e.SUPABASE_SERVICE_ROLE_KEY || "", authorization: `Bearer ${jwt}` } });
  if (!r.ok) throw new HttpErr(401, "Session expired. Sign in again.", "signin");
  const u = await r.json() as { id: string; email?: string };
  const owner = (e.OWNER_EMAIL || "iamrolan@gmail.com").toLowerCase();
  if ((u.email || "").toLowerCase() !== owner) throw new HttpErr(403, "Google sync is only enabled for the owner account.", "forbidden");
  return { id: u.id, email: u.email || "", jwt };
}
export async function svc<T = unknown>(e: GEnv, method: string, path: string, body?: unknown, prefer = "return=minimal"): Promise<T> {
  if (!e.SUPABASE_SERVICE_ROLE_KEY) throw new HttpErr(503, "Server is missing its Supabase service key.", "config");
  const r = await fetch(`${url(e)}/rest/v1/${path}`, { method, headers: { apikey: e.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${e.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (r.status === 404 || /PGRST205|PGRST202|42P01/.test(t)) throw new HttpErr(503, "Run migrations 009 and 010 in Supabase first.", "migration");
  if (!r.ok) throw new HttpErr(502, `Database: ${t.slice(0, 200)}`);
  return (t ? JSON.parse(t) : null) as T;
}
const cache = new Map<string, { at: string; exp: number }>();
export async function accessToken(e: GEnv, uid: string): Promise<string> {
  const c = cache.get(uid); if (c && c.exp > Date.now() + 60_000) return c.at;
  const rt = await svc<string | null>(e, "POST", "rpc/svc_google_token", { p_user: uid }, "return=representation");
  if (!rt) throw new HttpErr(409, "Google isn't connected yet. Press “Connect Google”.", "connect");
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) throw new HttpErr(503, "Server is missing Google client credentials.", "config");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: e.GOOGLE_CLIENT_ID, client_secret: e.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }) });
  const j = await r.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!j.access_token) throw new HttpErr(409, `Google access was revoked or expired (${j.error || r.status}). Press “Connect Google” again.`, "connect");
  cache.set(uid, { at: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 }); return j.access_token;
}
export async function gfetch(at: string, u: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(u, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${at}` } });
  if (r.status === 401) throw new HttpErr(409, "Google access expired. Press “Connect Google” again.", "connect");
  if (r.status === 403) { const t = await r.text(); throw new HttpErr(403, /insufficient|scope/i.test(t) ? "Google permission missing. Press “Connect Google” and allow all boxes." : /has not been used|disabled/i.test(t) ? "This Google API isn't enabled in Google Cloud yet." : `Google refused: ${t.slice(0, 160)}`, /scope|insufficient/i.test(t) ? "connect" : "api"); }
  return r;
}

