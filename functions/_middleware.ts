// Edge hardening for every request: per-IP rate limits on /api/*, security headers, and server error capture.
// Limits are per isolate (best-effort); swap for a Durable Object / Rate Limiting binding at scale.
const LIMITS: Record<string, [number, number]> = { "/api/chat": [20, 60], "/api/command": [40, 60], "/api/quote": [60, 60], "/api/log": [30, 60], "/api/transcribe": [15, 60], "/api/support": [12, 60], "/api/health/steps": [60, 60], "/api/sync/pair": [10, 600], "/api/sync/upload": [20, 3600], "/api/sync/poll": [90, 60], "/api/sync/claim": [30, 60], "/api/sync/log": [120, 60] };
const ADMIN_LIM: [number, number] = [90, 60];
const hits = new Map<string, { n: number; reset: number }>();
const SEC = {
  "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(self), geolocation=(self), microphone=(self)", "strict-transport-security": "max-age=31536000; includeSubDomains",
};
import { logEvents } from "./_lib/events";
// Request ids + sampled API event logging into app_events (health dashboard). Never logs bodies, headers, or query strings.
const routeOf = (p: string) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").replace(/\/\d{3,}/g, "/:n").slice(0, 120);
function apiEvent(ctx: Parameters<PagesFunction>[0], path: string, status: number, ms: number, rid: string) {
  if (!path.startsWith("/api/")) return;
  const keep = status >= 500 || status === 429 || status === 401 || status === 403 ? 1 : status >= 400 ? 0.25 : 0.05;
  if (Math.random() >= keep) return;
  logEvents(ctx, [{ severity: status >= 500 ? "error" : status === 429 ? "security" : status >= 400 ? "warn" : "debug", source: status === 429 ? "ratelimit" : "api", route: routeOf(path), code: status, request_id: rid, message: `${ctx.request.method} ${routeOf(path)} ${status}`, meta: { ms, colo: (ctx.request as unknown as { cf?: { colo?: string } }).cf?.colo } }]);
}
export const onRequest: PagesFunction = async (ctx) => {
  const t0 = Date.now(); const inRid = ctx.request.headers.get("x-request-id") || "";
  const rid = /^[A-Za-z0-9-]{8,64}$/.test(inRid) ? inRid : (ctx.request.headers.get("cf-ray") || crypto.randomUUID()).slice(0, 64);
  const url = new URL(ctx.request.url); const lim = LIMITS[url.pathname] ?? (url.pathname.startsWith("/api/admin/") ? ADMIN_LIM : undefined);
  if (lim) {
    const ip = ctx.request.headers.get("cf-connecting-ip") || "anon"; const k = `${url.pathname.startsWith("/api/admin/") ? "/api/admin" : url.pathname}|${ip}`; const now = Date.now();
    let h = hits.get(k); if (!h || h.reset < now) { h = { n: 0, reset: now + lim[1] * 1000 }; hits.set(k, h); }
    h.n++;
    // Global counter in a Durable Object (one per route+IP); falls back to the isolate counter.
    let n = h.n; let rl = "isolate";
    try {
      const env = ctx.env as { RL?: DurableObjectNamespace };
      if (env.RL) { const stub = env.RL.get(env.RL.idFromName(k)) as unknown as { hit(l: number, w: number): Promise<{ ok: boolean; retry: number }> }; const r = await stub.hit(lim[0], lim[1]); n = r.ok ? 0 : lim[0] + 1; rl = `do;remaining=${(r as { remaining?: number }).remaining}`; }
    } catch (e) { rl = "error"; console.log("ratelimit DO error", String(e)); }
    ctx.data = { rl, rid };
    if (n > lim[0]) { apiEvent(ctx, url.pathname, 429, Date.now() - t0, rid); return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }), { status: 429, headers: { "content-type": "application/json", "retry-after": String(Math.ceil((h.reset - now) / 1000)), "x-request-id": rid, ...SEC } }); }
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
    if (ctx.request.method === "POST" && Number(ctx.request.headers.get("content-length") || 0) > (url.pathname === "/api/transcribe" || url.pathname === "/api/sync/upload" ? 4_200_000 : 64_000)) return new Response(JSON.stringify({ error: "Payload too large" }), { status: 413, headers: { "content-type": "application/json" } });
  }
  try {
    const res = await ctx.next(); const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    const d = ctx.data as { rl?: string }; if (d?.rl) out.headers.set("x-ratelimit", d.rl);
    out.headers.set("x-request-id", rid); apiEvent(ctx, url.pathname, out.status, Date.now() - t0, rid);
    if (wantsPage(ctx.request, url) && [401, 403, 429, 500, 502, 503].includes(out.status) && !(out.headers.get("content-type") || "").includes("text/html")) return errorPage(ctx, out.status);
    return out;
  } catch (e) {
    console.error(JSON.stringify({ type: "server_error", path: url.pathname, message: String(e), request_id: rid, ray: ctx.request.headers.get("cf-ray") }));
    logEvents(ctx, [{ severity: "critical", source: "api", route: routeOf(url.pathname), code: 500, request_id: rid, message: String(e).slice(0, 300) }]);
    if (wantsPage(ctx.request, url)) return errorPage(ctx, 500);
    return new Response(JSON.stringify({ error: "Internal error", request_id: rid }), { status: 500, headers: { "content-type": "application/json", "x-request-id": rid } });
  }
};

// Browsers navigating to a page get Crystal's styled error page (with "Talk to support") instead of raw JSON/text.
const wantsPage = (req: Request, url: URL) => req.method === "GET" && !url.pathname.startsWith("/api/") && (req.headers.get("accept") || "").includes("text/html");
async function errorPage(ctx: Parameters<PagesFunction>[0], status: number): Promise<Response> {
  try {
    const env = ctx.env as { ASSETS?: { fetch(r: Request | string): Promise<Response> } };
    const u = new URL("/oops/", ctx.request.url); const r = await env.ASSETS?.fetch(new Request(u.toString()));
    if (r?.ok) { const h = new Headers(r.headers); for (const [k, v] of Object.entries(SEC)) h.set(k, v); h.set("cache-control", "no-store"); h.set("x-crystal-error", String(status)); const page = new Response(r.body, { status, headers: h }); return new HTMLRewriter().on("html", { element(e) { e.setAttribute("data-err", String(status)); } }).transform(page); }
  } catch { /* fall through */ }
  return new Response(`<!doctype html><meta name=viewport content="width=device-width"><body style="background:#060b1a;color:#cfe9ff;font:16px system-ui;display:grid;place-items:center;min-height:100vh"><div style="text-align:center"><h1 style="color:#3ef2e0">Error ${status}</h1><p><a style="color:#3ef2e0" href="/oops/?code=${status}">Talk to support</a> · <a style="color:#3ef2e0" href="/">Home</a></p></div>`, { status, headers: { "content-type": "text/html; charset=utf-8", ...SEC } });
}
