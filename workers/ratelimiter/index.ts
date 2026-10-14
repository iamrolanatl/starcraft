// Fixed-window rate limiter Durable Object used by Crystal's Pages Functions (binding RL).
// One object per "<route>|<ip>" key, so counts are globally consistent.
import { DurableObject } from "cloudflare:workers";
export class RateLimiter extends DurableObject {
  private n = 0; private reset = 0;
  async hit(limit: number, windowSec: number): Promise<{ ok: boolean; retry: number }> {
    const now = Date.now();
    if (now >= this.reset) { this.n = 0; this.reset = now + windowSec * 1000; }
    this.n++;
    return { ok: this.n <= limit, retry: Math.ceil((this.reset - now) / 1000) };
  }
}
export default { fetch: () => new Response("crystal-ratelimiter", { status: 404 }) };
