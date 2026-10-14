// crystal-health: every 5 minutes run synthetic checks + dependency probes, snapshot Cloudflare usage, and write via health_record().
type Env = { SITE: string; SUPABASE_URL: string; CF_ACCOUNT: string; HEALTH_KEY: string; SUPABASE_ANON_KEY: string; CF_API_TOKEN?: string; AI?: { run(m: string, i: unknown): Promise<unknown> } };
type Check = { target: string; kind: string; ok: boolean; status?: number; ms: number; detail?: string };
async function probe(target: string, kind: string, url: string, test: (r: Response) => boolean | Promise<boolean>, init: RequestInit = {}): Promise<Check> {
  const t = Date.now();
  try { const r = await fetch(url, { redirect: "manual", ...init, headers: { "user-agent": "crystal-health/1", "x-request-id": `hc-${crypto.randomUUID()}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
    const ok = await test(r); return { target, kind, ok, status: r.status, ms: Date.now() - t, detail: ok ? undefined : `${r.status} ${(r.headers.get("content-type") || "").slice(0, 40)}` };
  } catch (e) { return { target, kind, ok: false, ms: Date.now() - t, detail: String(e).slice(0, 200) }; }
}
const isJson = (r: Response) => (r.headers.get("content-type") || "").includes("application/json");
const statusPage = async (r: Response) => { if (!r.ok) return false; const j = await r.json() as { status?: { indicator?: string } }; return ["none", "minor"].includes(String(j.status?.indicator)); };
async function cfUsage(env: Env) {
  if (!env.CF_API_TOKEN) return { error: "CF_API_TOKEN not set" };
  const now = new Date(); const d1 = new Date(now.getTime() - 864e5).toISOString(); const day0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const q = `{viewer{accounts(filter:{accountTag:"${env.CF_ACCOUNT}"}){
    pages:pagesFunctionsInvocationsAdaptiveGroups(limit:20,filter:{datetime_geq:"${d1}",datetime_leq:"${now.toISOString()}"}){sum{requests errors subrequests} quantiles{cpuTimeP50 cpuTimeP99} dimensions{scriptName}}
    pagesToday:pagesFunctionsInvocationsAdaptiveGroups(limit:20,filter:{datetime_geq:"${day0}",datetime_leq:"${now.toISOString()}"}){sum{requests}}
    workers:workersInvocationsAdaptive(limit:20,filter:{datetime_geq:"${d1}",datetime_leq:"${now.toISOString()}"}){sum{requests errors subrequests} quantiles{cpuTimeP50 cpuTimeP99} dimensions{scriptName}}
    workersToday:workersInvocationsAdaptive(limit:20,filter:{datetime_geq:"${day0}",datetime_leq:"${now.toISOString()}"}){sum{requests}}
    ai:aiInferenceAdaptiveGroups(limit:30,filter:{datetime_geq:"${day0}",datetime_leq:"${now.toISOString()}"}){sum{totalNeurons} count dimensions{modelId}}}}}`;
  const h = { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" };
  const out: Record<string, unknown> = {};
  try { const r = await fetch("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: h, body: JSON.stringify({ query: q }) }); const j = await r.json() as { data?: { viewer?: { accounts?: Record<string, unknown>[] } }; errors?: { message: string }[] };
    if (j.errors?.length) out.graphql_error = j.errors.map(e => e.message).join("; ").slice(0, 300); Object.assign(out, j.data?.viewer?.accounts?.[0] || {}); } catch (e) { out.graphql_error = String(e).slice(0, 200); }
  try { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT}/pages/projects/crystal/deployments?per_page=8`, { headers: h }); const j = await r.json() as { result?: Record<string, unknown>[]; errors?: { message: string }[] };
    out.deployments = (j.result || []).map(d => ({ id: d.short_id, env: d.environment, at: d.created_on, status: (d.latest_stage as { status?: string; name?: string } | undefined)?.status, stage: (d.latest_stage as { name?: string } | undefined)?.name, branch: ((d.deployment_trigger as { metadata?: { branch?: string } } | undefined)?.metadata?.branch) }));
    if (!r.ok) out.deployments_error = j.errors?.map(e => e.message).join("; "); } catch (e) { out.deployments_error = String(e).slice(0, 200); }
  return out;
}
const sum = (rows: unknown, k = "requests") => ((rows as { sum: Record<string, number> }[]) || []).reduce((a, r) => a + Number(r.sum?.[k] || 0), 0);
async function run(env: Env) {
  const S = env.SITE, A = env.SUPABASE_URL, anon = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
  const checks = await Promise.all([
    probe("site", "route", `${S}/`, r => r.status === 200), probe("app", "route", `${S}/app/`, r => r.status === 200), probe("admin_page", "route", `${S}/admin/`, r => r.status === 200),
    probe("api_admin", "api", `${S}/api/admin/whoami`, r => r.status === 403 && isJson(r)),   // must refuse anonymous
    probe("api_support", "api", `${S}/api/support`, r => r.status < 500 && isJson(r)), probe("api_sync", "api", `${S}/api/sync/status`, r => r.status < 500 && isJson(r)),
    probe("api_transcribe", "api", `${S}/api/transcribe`, r => r.status < 500), probe("api_health", "api", `${S}/api/health/steps`, r => r.status < 500 && isJson(r)),
    probe("supabase_rest", "core", `${A}/rest/v1/`, r => r.status < 500, { headers: anon }), probe("supabase_auth", "core", `${A}/auth/v1/health`, r => r.ok, { headers: anon }),
    (async (): Promise<Check> => { const t = Date.now(); try { await env.AI!.run("@cf/baai/bge-small-en-v1.5", { text: ["ping"] }); return { target: "workers_ai", kind: "core", ok: true, status: 200, ms: Date.now() - t }; } catch (e) { return { target: "workers_ai", kind: "core", ok: false, ms: Date.now() - t, detail: String(e).slice(0, 200) }; } })(),
    probe("status_supabase", "dep", "https://status.supabase.com/api/v2/status.json", statusPage), probe("status_cloudflare", "dep", "https://www.cloudflarestatus.com/api/v2/status.json", statusPage),
    probe("google_apis", "dep", "https://www.googleapis.com/", r => r.status < 500, { method: "HEAD" }), probe("parentvue", "dep", "https://parentvue.cobbk12.org/", r => r.status < 500, { method: "HEAD" }),
  ]);
  const cf = await cfUsage(env);
  const pagesDay = sum(cf.pagesToday), workersDay = sum(cf.workersToday), neurons = ((cf.ai as { sum: { totalNeurons: number } }[]) || []).reduce((a, r) => a + Number(r.sum?.totalNeurons || 0), 0);
  const pct = (n: number, d: number) => Math.round((1000 * n) / d) / 10;
  const quotas = { items: [
    { name: "Workers+Pages requests today", used: pagesDay + workersDay, limit: 100000, pct: pct(pagesDay + workersDay, 100000), unit: "req" },
    { name: "Workers AI neurons today", used: Math.round(neurons), limit: 10000, pct: pct(neurons, 10000), unit: "neurons" } ] };
  const r = await fetch(`${A}/rest/v1/rpc/health_record`, { method: "POST", headers: { ...anon, "content-type": "application/json" }, body: JSON.stringify({ p_key: env.HEALTH_KEY, p_checks: checks, p_snapshots: { cloudflare: cf, quotas } }) });
  return { status: r.status, body: (await r.text()).slice(0, 300), checks: checks.length };
}
export default {
  async scheduled(_e: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) { ctx.waitUntil(run(env).then(r => console.log(JSON.stringify({ type: "health_run", ...r })))); },
  async fetch() { return new Response("crystal-health: cron only", { status: 404 }); },
};
