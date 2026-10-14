// Client error / security sink: browser errors (and failed sign-ins) land in Workers Logs and, sampled + PII-scrubbed, in app_events.
import { body, json } from "../_lib/http";
import { logEvents } from "../_lib/events";
export const onRequestPost: PagesFunction = async (ctx) => {
  const { request } = ctx;
  const b = await body<{ message?: string; stack?: string; url?: string; type?: string }>(request);
  if (!b?.message) return json({ error: "message required" }, 400);
  const rid = request.headers.get("cf-ray") || "";
  console.error(JSON.stringify({ type: b.type === "auth_fail" ? "auth_fail" : "client_error", message: String(b.message).slice(0, 500), stack: String(b.stack || "").slice(0, 2000), url: String(b.url || "").slice(0, 300), ua: request.headers.get("user-agent")?.slice(0, 200), ray: rid, at: new Date().toISOString() }));
  let path = "/"; try { path = new URL(String(b.url || "/"), "https://x").pathname; } catch { /* */ }
  const auth = b.type === "auth_fail";
  if (auth || Math.random() < 0.5) logEvents(ctx, [{ severity: auth ? "security" : "error", source: auth ? "auth" : "client", route: path, message: String(b.message).slice(0, 300), request_id: rid.slice(0, 64), meta: { stack_top: String(b.stack || "").split("\n").slice(0, 2).join(" | ").slice(0, 200) } }]);
  return json({ ok: true });
};
