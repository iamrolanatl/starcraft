// Edge hardening for every request: per-IP rate limits on /api/*, security headers, and server error capture.
// Limits are per isolate (best-effort); swap for a Durable Object / Rate Limiting binding at scale.
const LIMITS: Record<string, [number, number]> = { "/api/chat": [20, 60], "/api/command": [40, 60], "/api/quote": [60, 60], "/api/log": [30, 60] };
const hits = new Map<string, { n: number; reset: number }>();
const SEC = {
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(self), geolocation=(self), microphone=()", "strict-transport-security": "max-age=31536000; includeSubDomains",
};
export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url); const lim = LIMITS[url.pathname];
  if (lim) {
    const ip = ctx.request.headers.get("cf-connecting-ip") || "anon"; const k = `${url.pathname}|${ip}`; const now = Date.now();
    let h = hits.get(k); if (!h || h.reset < now) { h = { n: 0, reset: now + lim[1] * 1000 }; hits.set(k, h); }
    h.n++;
    // Global counter in a Durable Object (one per route+IP); falls back to the isolate counter.
    let n = h.n; let rl = "isolate";
    try {
      const env = ctx.env as { RL?: DurableObjectNamespace };
      if (env.RL) { const stub = env.RL.get(env.RL.idFromName(k)) as unknown as { hit(l: number, w: number): Promise<{ ok: boolean; retry: number }> }; const r = await stub.hit(lim[0], lim[1]); n = r.ok ? 0 : lim[0] + 1; rl = `do;remaining=${(r as { remaining?: number }).remaining}`; }
    } catch (e) { rl = "error"; console.log("ratelimit DO error", String(e)); }
    ctx.data = { rl };
    if (n > lim[0]) return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(Math.ceil((h.reset - now) / 1000)), ...SEC } });
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
    if (ctx.request.method === "POST" && Number(ctx.request.headers.get("content-length") || 0) > 64_000) return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: { "content-type": "application/json" } });
  }
  try {
    const res = await ctx.next(); const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    const d = ctx.data as { rl?: string }; if (d?.rl) out.headers.set("x-ratelimit", d.rl);
    return out;
  } catch (e) {
    console.error(JSON.stringify({ type: "server_error", path: url.pathname, message: String(e), ray: ctx.request.headers.get("cf-ray") }));
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
