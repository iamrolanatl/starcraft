// Stock quote proxy: fetches delayed quotes server-side (no CORS/key exposure), cached 60s at the edge.
import { json } from "../_lib/http";
type Q = { symbol: string; price: number | null; changePct: number | null; error?: string };
export const onRequestGet: PagesFunction = async ({ request }) => {
  const raw = new URL(request.url).searchParams.get("symbols") || "";
  const syms = [...new Set(raw.split(",").map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.\-^=]{1,12}$/.test(s)))].slice(0, 20);
  if (!syms.length) return json({ error: "symbols required" }, 400);
  const quotes: Q[] = await Promise.all(syms.map(async (symbol): Promise<Q> => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 (Crystal quote proxy)" }, cf: { cacheTtl: 60, cacheEverything: true } } as RequestInit);
      const j = await r.json() as { chart?: { result?: { meta: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[] } };
      const m = j.chart?.result?.[0]?.meta; if (!m?.regularMarketPrice) return { symbol, price: null, changePct: null, error: "not found" };
      const prev = m.chartPreviousClose ?? m.previousClose; return { symbol, price: m.regularMarketPrice, changePct: prev ? (m.regularMarketPrice / prev - 1) * 100 : null };
    } catch { return { symbol, price: null, changePct: null, error: "unavailable" }; }
  }));
  return new Response(JSON.stringify({ quotes }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=60" } });
};
