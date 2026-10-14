// REST probes for migration 017 against the live project (PostgREST, same path the app uses).
// Usage: CRYSTAL_SUPABASE_ANON_KEY=… node scripts/family-rest-probe.mjs
// Optional: PARENT_JWT / CHILD_JWT / VIEWER_JWT / OUTSIDER_JWT (access tokens copied from a signed-in browser session) for per-role checks.
// Never prints keys or tokens.
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co"; const anon = process.env.CRYSTAL_SUPABASE_ANON_KEY;
if (!anon) { console.error("set CRYSTAL_SUPABASE_ANON_KEY"); process.exit(2); }
const get = async (path, jwt) => { const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: anon, authorization: `Bearer ${jwt || anon}`, prefer: "count=exact", range: "0-0" } });
  const b = await r.json().catch(() => null); const n = Number((r.headers.get("content-range") || "").split("/")[1]); return { status: r.status, code: b?.code, n: Number.isFinite(n) ? n : Array.isArray(b) ? b.length : null }; };
const rpc = async (fn, args, jwt) => { const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${jwt || anon}`, "content-type": "application/json" }, body: JSON.stringify(args) });
  const b = await r.json().catch(() => null); return { status: r.status, code: b?.code, body: b }; };
let fail = 0; const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fail++; };
const applied = (await rpc("my_access", {})).code !== "PGRST202";
console.log(`migration 017 ${applied ? "IS" : "is NOT yet"} applied`);
const T = ["families", "family_members", "family_invites", "children", "child_viewers", "list_shares", "list_activity", "family_events", "edu_grades", "report_cards", "shop_items", "bills"];
for (const t of T) { const r = await get(`${t}?select=*`); ok(r.n === 0 || r.status === 401 || r.status === 404 || ["42501", "PGRST205"].includes(r.code), `anon: ${t} → ${r.status} ${r.code ?? ""} rows=${r.n}`); }
for (const [fn, a] of [["family_join", { p_code: "ZZZZ-ZZZZ" }], ["family_create_invite", { p_child: "00000000-0000-0000-0000-000000000000" }], ["list_share_invite", { p_list: "shopping", p_email: "x@example.com", p_perm: "view" }]]) {
  const r = await rpc(fn, a); ok(r.status >= 400, `anon: rpc ${fn} refused (${r.status} ${r.code ?? ""})`); }
const roles = { PARENT: process.env.PARENT_JWT, CHILD: process.env.CHILD_JWT, VIEWER: process.env.VIEWER_JWT, OUTSIDER: process.env.OUTSIDER_JWT };
const restricted = ["bills", "credit_scores", "stocks", "mail_messages", "mail_outbox", "mail_style_edits", "health_logs", "meds", "comms_notes", "edu_attendance_excuses", "drive_pins"];
if (applied) for (const [role, jwt] of Object.entries(roles)) { if (!jwt) continue;
  if (role !== "PARENT") for (const t of restricted) { const r = await get(`${t}?select=*`, jwt); ok(r.n === 0 || r.code === "42501", `${role}: ${t} → rows=${r.n} ${r.code ?? ""}`); }
  for (const t of ["edu_grades", "report_cards", "edu_schedule", "tasks", "children"]) { const r = await get(`${t}?select=*`, jwt); console.log(`INFO  ${role}: ${t} rows=${r.n} ${r.code ?? ""}`); } }
process.exit(fail ? 1 : 0);
