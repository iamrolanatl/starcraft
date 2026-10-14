// Stream one Drive file for in-app preview. Google Docs/Sheets/Slides are exported to PDF. Max 20 MB.
import { json } from "../../_lib/http";
import { accessToken, caller, fail, gfetch, type GEnv } from "../../_lib/google";
const EXPORT: Record<string, string> = { "application/vnd.google-apps.document": "application/pdf", "application/vnd.google-apps.spreadsheet": "application/pdf", "application/vnd.google-apps.presentation": "application/pdf", "application/vnd.google-apps.drawing": "image/png" };
const OK = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|text\/plain)$/;
export const onRequestGet: PagesFunction<GEnv> = async ({ request, env }) => {
  try {
    const u = await caller(request, env); const at = await accessToken(env, u.id);
    const id = (new URL(request.url).searchParams.get("id") || "").replace(/[^\w-]/g, ""); if (!id) return json({ error: "id required" }, 400);
    const m = await gfetch(at, `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`); if (!m.ok) return json({ error: `Drive ${m.status}` }, m.status === 404 ? 404 : 502);
    const meta = await m.json() as { name: string; mimeType: string; size?: string };
    const exp = EXPORT[meta.mimeType]; const type = exp || meta.mimeType;
    if (!OK.test(type)) return json({ error: "No in-app preview for this file type. Open it in Drive." }, 415);
    if (!exp && Number(meta.size || 0) > 20e6) return json({ error: "File too large to preview. Open it in Drive." }, 413);
    const r = await gfetch(at, exp ? `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(exp)}` : `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);
    if (!r.ok) return json({ error: `Drive ${r.status}` }, 502);
    return new Response(r.body, { headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox" } });
  } catch (e) { return fail(e); }
};
