"use client";
// Defensive helpers: safe JSON/localStorage, fetch with timeout + retry/backoff + 429 handling.
export function safeJSON<T>(s: string | null | undefined, fallback: T): T { if (s == null || s === "") return fallback; try { const v = JSON.parse(s); return (v ?? fallback) as T; } catch { return fallback; } }
export function lsGet<T>(k: string, fallback: T): T { try { return safeJSON(localStorage.getItem(k), fallback); } catch { return fallback; } }
export function lsSet(k: string, v: unknown) { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* quota / private mode */ } }
export function lsRaw(k: string, d = ""): string { try { return typeof window === "undefined" ? d : localStorage.getItem(k) ?? d; } catch { return d; } }

export class HttpError extends Error { constructor(msg: string, public status: number, public retryAfter?: number) { super(msg); } }
export interface FetchOpts extends RequestInit { timeoutMs?: number; retries?: number; signal?: AbortSignal }
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true }); });
/** fetch JSON with a timeout, exponential backoff on network/5xx errors, friendly 429 messages. */
export async function fetchJSON<T>(url: string, o: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 15000, retries = 2, signal, ...init } = o; let last: unknown;
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
    const onAbort = () => ac.abort(); signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) throw new HttpError("You're offline. Reconnect and try again.", 0);
      const r = await fetch(url, { ...init, signal: ac.signal });
      const txt = await r.text(); const j = safeJSON<Record<string, unknown>>(txt, {});
      if (r.status === 429) { const ra = Number(r.headers.get("retry-after") || 30); throw new HttpError(`Easy there, pilot! Rate limit hit. Try again in ${ra}s.`, 429, ra); }
      if (!r.ok) { const e = new HttpError(String(j.error || `Server error (${r.status})`), r.status); if (r.status < 500) throw e; last = e; }
      else return j as T;
    } catch (e) {
      if (e instanceof HttpError && (e.status === 429 || (e.status >= 400 && e.status < 500) || e.status === 0)) throw e;
      if (signal?.aborted) throw e; last = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? new HttpError("Request timed out. Check your connection.", 408) : e;
    } finally { clearTimeout(t); signal?.removeEventListener("abort", onAbort); }
    if (i < retries) await sleep(400 * 2 ** i + Math.random() * 200, signal);
  }
  throw last instanceof Error ? last : new Error("Network error");
}

/* Client error reporting (deduped, throttled) */
let sent = 0; const seen = new Set<string>();
export function reportError(err: unknown, where = "") {
  try {
    const e = err as { message?: string; stack?: string }; const message = String(e?.message || err).slice(0, 500); const key = message + where;
    if (seen.has(key) || sent > 20) return; seen.add(key); sent++;
    const body = JSON.stringify({ message: `${where ? `[${where}] ` : ""}${message}`, stack: String(e?.stack || "").slice(0, 2000), url: location.pathname });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/log", new Blob([body], { type: "application/json" })); else fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* never throw from the reporter */ }
}
