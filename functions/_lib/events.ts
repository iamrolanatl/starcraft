// Sampled, PII-scrubbed (server-side in health_events) event sink -> public.app_events. Needs Pages secret HEALTH_KEY.
type HEnv = { HEALTH_KEY?: string; SUPABASE_ANON_KEY?: string; SUPABASE_URL?: string };
const SB_URL = "https://ogrrjkxkccbywbiikcak.supabase.co";
export function logEvents(ctx: { env: unknown; waitUntil(p: Promise<unknown>): void }, events: Record<string, unknown>[]) {
  const env = ctx.env as HEnv; if (!env.HEALTH_KEY || !env.SUPABASE_ANON_KEY || !events.length) return;
  ctx.waitUntil(fetch(`${(env.SUPABASE_URL || SB_URL).replace(/\/$/, "")}/rest/v1/rpc/health_events`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ p_key: env.HEALTH_KEY, p_events: events }) }).then(() => undefined, () => undefined));
}
