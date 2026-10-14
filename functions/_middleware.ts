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
    // Per-colo counter in the edge cache so limits hold across isolates (best-effort, non-atomic).
    let n = h.n;
    try {
      const win = Math.floor(now / (lim[1] * 1000)); const ck = new Request(`https://rl.crystal.internal/${encodeURIComponent(k)}/${win}`);
      const c = caches.default; const prev = await c.match(ck); const cn = (prev ? Number(await prev.text()) : 0) + 1;
      ctx.waitUntil(c.put(ck, new Response(String(cn), { headers: { "cache-control": `max-age=${lim[1]}` } })));
      n = Math.max(n, cn);
    } catch { /* cache unavailable: fall back to isolate counter */ }
    if (n > lim[0]) return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(Math.ceil((h.reset - now) / 1000)), ...SEC } });
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
    if (ctx.request.method === "POST" && Number(ctx.request.headers.get("content-length") || 0) > 64_000) return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: { "content-type": "application/json" } });
  }
  try {
    const res = await ctx.next(); const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    return out;
  } catch (e) {
    console.error(JSON.stringify({ type: "server_error", path: url.pathname, message: String(e), ray: ctx.request.headers.get("cf-ray") }));
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { "content-type": "application/json" } });
  }
};
