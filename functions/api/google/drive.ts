// Google Drive browse / search / recent (read-only). GET ?folder=<id>|&q=<text>|&recent=1
import { json } from "../../_lib/http";
import { accessToken, caller, fail, gfetch, type GEnv } from "../../_lib/google";
const F = "files(id,name,mimeType,modifiedTime,size,iconLink,webViewLink,thumbnailLink,parents),nextPageToken";
export const onRequestGet: PagesFunction<GEnv> = async ({ request, env }) => {
  try {
    const u = await caller(request, env); const at = await accessToken(env, u.id);
    const p = new URL(request.url).searchParams; const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const folder = (p.get("folder") || "").replace(/[^\w-]/g, ""); const text = (p.get("q") || "").slice(0, 200).trim();
    let q = "trashed = false", order = "folder,name";
    if (text) { q += ` and (name contains '${esc(text)}' or fullText contains '${esc(text)}')`; order = "modifiedTime desc"; }
    else if (p.get("recent")) { q += " and mimeType != 'application/vnd.google-apps.folder'"; order = "viewedByMeTime desc"; }
    else q += ` and '${folder || "root"}' in parents`;
    const pt = p.get("page") ? `&pageToken=${encodeURIComponent(p.get("page")!)}` : "";
    const r = await gfetch(at, `https://www.googleapis.com/drive/v3/files?pageSize=50&fields=${encodeURIComponent(F)}&orderBy=${encodeURIComponent(order)}&q=${encodeURIComponent(q)}&supportsAllDrives=true&includeItemsFromAllDrives=true${pt}`);
    if (!r.ok) return json({ error: `Drive ${r.status}` }, 502);
    return json(await r.json());
  } catch (e) { return fail(e); }
};
