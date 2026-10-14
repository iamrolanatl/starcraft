"use client";
// Comm › Drive client. Calls Crystal's server routes (/api/google/drive, /api/google/file), which hold the Google token;
// the browser only ever sends its Supabase session JWT. Pins are a normal RLS table (migration 010).
import { sb } from "./supabase";
import { isDemo } from "./store";
async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await sb().auth.getSession(); const jwt = data.session?.access_token;
  if (!jwt) throw Object.assign(new Error("Sign in first."), { code: "signin" });
  return fetch(path, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${jwt}`, "content-type": "application/json" } });
}
async function j<T>(r: Response): Promise<T> { const b = await r.json().catch(() => ({})) as T & { error?: string; code?: string }; if (!r.ok) throw Object.assign(new Error(b.error || `HTTP ${r.status}`), { code: b.code }); return b; }

// ---- Drive ----
export interface DFile { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; iconLink?: string; webViewLink?: string; thumbnailLink?: string }
export const isFolder = (f: DFile) => f.mimeType === "application/vnd.google-apps.folder";
export async function driveList(o: { folder?: string; q?: string; recent?: boolean; page?: string }): Promise<{ files: DFile[]; nextPageToken?: string }> {
  const p = new URLSearchParams(); if (o.folder) p.set("folder", o.folder); if (o.q) p.set("q", o.q); if (o.recent) p.set("recent", "1"); if (o.page) p.set("page", o.page);
  return j(await authed(`/api/google/drive?${p}`));
}
export async function drivePreview(id: string): Promise<{ url: string; type: string }> {
  const r = await authed(`/api/google/file?id=${encodeURIComponent(id)}`); if (!r.ok) await j(r);
  const b = await r.blob(); return { url: URL.createObjectURL(b), type: b.type };
}
export interface Pin { id: string; file_id: string; name: string; mime: string | null; web_link: string | null; module: string }
export async function listPins(module?: string): Promise<Pin[]> { if (isDemo()) return []; let q = sb().from("drive_pins").select("*").order("created_at", { ascending: false }); if (module) q = q.eq("module", module); const { data } = await q; return (data ?? []) as Pin[]; }
export async function pin(f: DFile, module: string) { const { error } = await sb().from("drive_pins").upsert({ file_id: f.id, name: f.name, mime: f.mimeType, web_link: f.webViewLink ?? null, module }, { onConflict: "user_id,file_id,module" }); if (error) throw error; }
export async function unpin(id: string) { const { error } = await sb().from("drive_pins").delete().eq("id", id); if (error) throw error; }
