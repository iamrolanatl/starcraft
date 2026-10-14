// Fixed-window rate limiter Durable Object used by Crystal's Pages Functions (binding RL).
// One object per "<route>|<ip>" key, so counts are globally consistent.
import { DurableObject } from "cloudflare:workers";
export class RateLimiter extends DurableObject {
  async hit(limit: number, windowSec: number): Promise<{ ok: boolean; retry: number; remaining: number }> {
    const now = Date.now();
    let s = (await this.ctx.storage.get<{ n: number; reset: number }>("w")) ?? { n: 0, reset: 0 };
    if (now >= s.reset) s = { n: 0, reset: now + windowSec * 1000 };
    s.n++; await this.ctx.storage.put("w", s);
    return { ok: s.n <= limit, retry: Math.ceil((s.reset - now) / 1000), remaining: Math.max(0, limit - s.n) };
  }
}
export default { fetch: () => new Response("crystal-ratelimiter", { status: 404 }) };
