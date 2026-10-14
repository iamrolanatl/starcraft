// GET /api/report-card?id=<uuid> — returns a 5-minute signed URL for one of the caller's report-card PDFs.
// Uses the caller's own Supabase JWT: RLS on report_cards + the storage policy (migration 013) decide access.
import { json } from "../_lib/http";
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
type Env = { SUPABASE_ANON_KEY?: string };
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_ANON_KEY) return json({ error: "server not configured" }, 500);
  const jwt = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Sign in first.", code: "signin" }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "bad id" }, 400);
  const h = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}`, "content-type": "application/json" };
  const r = await fetch(`${SB}/rest/v1/report_cards?select=storage_path&id=eq.${id}`, { headers: h, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r) return json({ error: "database unreachable" }, 502);
  if (r.status === 401) return json({ error: "Sign in again.", code: "signin" }, 401);
  const rows = await r.json().catch(() => []) as { storage_path: string }[];
  if (!r.ok || !rows[0]) return json({ error: "not found" }, 404);
  const s = await fetch(`${SB}/storage/v1/object/sign/raw/${rows[0].storage_path}`, { method: "POST", headers: h, body: JSON.stringify({ expiresIn: 300 }) }).catch(() => null);
  const sj = s ? await s.json().catch(() => null) as { signedURL?: string } | null : null;
  if (!s?.ok || !sj?.signedURL) return json({ error: "couldn't sign the file" }, 502);
  return json({ url: `${SB}/storage/v1${sj.signedURL}` });
};
