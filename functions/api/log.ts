// Client error tracking sink: browser errors are posted here and land in Cloudflare Workers Logs (wrangler pages deployment tail).
import { body, json } from "../_lib/http";
export const onRequestPost: PagesFunction = async ({ request }) => {
  const b = await body<{ message?: string; stack?: string; url?: string; ua?: string }>(request);
  if (!b?.message) return json({ error: "message required" }, 400);
  console.error(JSON.stringify({ type: "client_error", message: String(b.message).slice(0, 500), stack: String(b.stack || "").slice(0, 2000), url: String(b.url || "").slice(0, 300), ua: request.headers.get("user-agent")?.slice(0, 200), ray: request.headers.get("cf-ray"), at: new Date().toISOString() }));
  return json({ ok: true });
};
