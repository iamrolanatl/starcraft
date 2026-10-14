// POST /api/health/steps — iPhone (iOS Shortcuts) Apple Health step ingest.
// Auth: per-user ingest token (Authorization: Bearer hst_… or "token" in the body). Verified by the
// SECURITY DEFINER RPC public.health_ingest (token stored hashed), so only the anon key is needed here.
// Body: {date, steps, distance?, activeEnergy?, flights?}  or  {days:[{date,steps,...}, ...]} (backfill, max 40).
import { json, body } from "../../_lib/http";
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
type Env = { SUPABASE_ANON_KEY?: string };
type Day = Record<string, unknown>;

/** Shortcuts sends numbers as "8,123", "8123.0", "5.2 km" etc. Empty/garbage -> null (never 0). */
export const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null;
};
export const ymd = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim(); const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (us) { const y = us[3].length === 2 ? "20" + us[3] : us[3]; return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`; }
  const d = new Date(s); if (isNaN(+d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const pick = (d: Day, ...k: string[]) => { for (const x of k) if (d[x] != null && d[x] !== "") return num(d[x]); return null; };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.SUPABASE_ANON_KEY) return json({ ok: false, error: "server not configured" }, 500);
  const b = await body<Day & { days?: Day[] }>(request);
  if (!b || typeof b !== "object") return json({ ok: false, error: "JSON body required" }, 400);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim() || (typeof b.token === "string" ? b.token.trim() : "");
  if (!/^hst_[0-9a-f]{48}$/.test(token)) return json({ ok: false, error: "missing or malformed token" }, 401);
  const days = (Array.isArray(b.days) ? b.days : [b]).slice(0, 40);
  const out: unknown[] = [];
  for (const d of days) {
    const r = await fetch(`${SB}/rest/v1/rpc/health_ingest`, {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_token: token, p_date: ymd(d.date), p_steps: pick(d, "steps"), p_distance_km: pick(d, "distance", "distance_km"), p_active_kcal: pick(d, "activeEnergy", "active_energy", "active_kcal"), p_flights: pick(d, "flights", "flightsClimbed") }),
    }).catch(() => null);
    if (!r) { out.push({ ok: false, error: "database unreachable" }); continue; }
    const j = await r.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!r.ok) { out.push({ ok: false, error: r.status === 404 ? "ingest not installed (run migration 010)" : "database error" }); continue; }
    if (j?.error === "invalid token") return json({ ok: false, error: "invalid token" }, 401);
    out.push(j);
  }
  const ok = out.every(x => (x as { ok?: boolean }).ok);
  return json(Array.isArray(b.days) ? { ok, results: out } : out[0], ok ? 200 : 400);
};
export const onRequestGet: PagesFunction = async () => json({ ok: true, endpoint: "POST JSON {date, steps} with Authorization: Bearer <token>" });
