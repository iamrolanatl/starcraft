// /api/sync/* — Crystal Sync device endpoint (020_sync_devices.sql). The device sends its key as "Authorization: Device csd_…".
// Every call goes to a SECURITY DEFINER RPC that re-validates the key hash, scope (paired child_ids), revocation and rate limits.
// The device can only pair, poll its own commands, start/log/finish its own runs, upload for its children, and rotate its key.
// No service-role key exists here; secrets are never logged.
import { body, json } from "../../_lib/http";
type Env = { SUPABASE_URL?: string; SUPABASE_ANON_KEY?: string };
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type B = Record<string, unknown>;
const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const OPS: Record<string, (b: B, key: string, ip: string) => [string, B] | string> = {
  pair: (b, _k, ip) => ["sync_pair_exchange", { p_code: s(b.code, 20), p_name: s(b.name, 80), p_platform: s(b.platform, 40), p_version: s(b.version, 20), p_ip: ip }],
  poll: (b, key) => ["sync_poll", { p_key: key, p_version: b.version ? s(b.version, 20) : null }],
  start: (b, key) => UUID.test(s(b.child_id, 40)) ? ["sync_run_start", { p_key: key, p_child: b.child_id, p_run: UUID.test(s(b.run_id, 40)) ? b.run_id : null, p_trigger: s(b.trigger || "schedule", 20), p_slot: b.slot ? s(b.slot, 40) : null }] : "child_id required",
  log: (b, key) => UUID.test(s(b.run_id, 40)) && Array.isArray(b.lines) ? ["sync_log", { p_key: key, p_run: b.run_id, p_lines: (b.lines as B[]).slice(0, 200) }] : "run_id + lines required",
  upload: (b, key) => UUID.test(s(b.run_id, 40)) && UUID.test(s(b.child_id, 40)) && b.payload && typeof b.payload === "object" ? ["sync_upload", { p_key: key, p_run: b.run_id, p_child: b.child_id, p_payload: b.payload }] : "run_id, child_id, payload required",
  finish: (b, key) => UUID.test(s(b.run_id, 40)) ? ["sync_run_finish", { p_key: key, p_run: b.run_id, p_status: s(b.status, 20), p_counts: b.counts && typeof b.counts === "object" ? b.counts : {}, p_error: b.error ? s(b.error, 2000) : null }] : "run_id required",
  claim: (b, key) => b.slot ? ["sync_claim", { p_key: key, p_slot: s(b.slot, 40) }] : "slot required",
  rotate: (_b, key) => ["sync_rotate", { p_key: key }],
};
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const op = String(params.op || ""); const f = OPS[op];
  if (!f) return json({ error: "unknown op" }, 404);
  const anon = env.SUPABASE_ANON_KEY; if (!anon) return json({ error: "server not configured" }, 500);
  if (Number(request.headers.get("content-length") || 0) > 5_000_000) return json({ error: "payload too large" }, 413);
  const key = (request.headers.get("authorization") || "").replace(/^Device\s+/i, "").trim();
  if (op !== "pair" && !/^csd_[0-9a-f]{64}$/.test(key)) return json({ error: "device key required" }, 401);
  const b = (await body<B>(request)) || {};
  const ip = request.headers.get("cf-connecting-ip") || "";
  const m = f(b, key, ip); if (typeof m === "string") return json({ error: m }, 400);
  const r = await fetch(`${(env.SUPABASE_URL || SB).replace(/\/$/, "")}/rest/v1/rpc/${m[0]}`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${anon}`, "content-type": "application/json" }, body: JSON.stringify(m[1]) });
  const txt = await r.text();
  console.log(JSON.stringify({ type: "sync", op, status: r.status, bytes: txt.length }));
  if (r.ok) return new Response(txt, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  let e: { code?: string; message?: string } = {}; try { e = JSON.parse(txt); } catch { /* */ }
  if (e.code === "PGRST202" || r.status === 404) return json({ error: "Crystal Sync is not enabled yet (migration 020 pending)" }, 503);
  if (e.code === "28000") return json({ error: e.message || "bad device key" }, 401);
  if (e.code === "42501") return json({ error: e.message || "forbidden" }, 403);
  if (e.code === "P0429") return json({ error: e.message || "rate limited" }, 429);
  return json({ error: s(e.message || "error", 300) }, 400);
};
