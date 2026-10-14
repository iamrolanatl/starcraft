"use client";
// Profile row (public.profiles, RLS "own profile"). Filled from the Google identity on first load; editable in Settings › Profile.
import { sb } from "./supabase"; import { isDemo } from "./store"; import { lsGet, lsSet } from "./safe";
import { normalizeName, profileFromIdentity, type Profile } from "./names";
const KEY = "crystal-profile"; let cache: Profile = typeof window !== "undefined" ? lsGet<Profile>(KEY, {}) : {};
export const getProfile = () => cache;
const emit = () => { lsSet(KEY, cache); window.dispatchEvent(new Event("crystal-profile")); };
export async function loadProfile(): Promise<Profile> {
  if (isDemo()) return cache;
  try {
    const { data: s } = await sb().auth.getSession(); const u = s.session?.user; if (!u) return cache;
    const fromId = profileFromIdentity(u.user_metadata);
    const { data } = await sb().from("profiles").select("*").eq("id", u.id).maybeSingle();
    const row = (data ?? {}) as Profile & { id?: string };
    // Normalize stored names; fill blanks from Google; never use the email.
    const email = (u.email ?? "").split("@")[0].toLowerCase();
    const clean = (v?: string | null) => v && v.toLowerCase() !== email ? normalizeName(v) : null;
    const next: Profile = { first_name: clean(row.first_name) || fromId.first_name || null, last_name: clean(row.last_name) || fromId.last_name || null,
      display_name: clean(row.display_name) || fromId.display_name || null, nickname: row.nickname ?? null, avatar_url: row.avatar_url || fromId.avatar_url || null, timezone: row.timezone || "America/New_York" };
    cache = next; emit();
    const changed = (Object.keys(next) as (keyof Profile)[]).some(k => (row[k] ?? null) !== (next[k] ?? null));
    if (changed) await sb().from("profiles").upsert({ id: u.id, ...next, updated_at: new Date().toISOString() }).then(() => {}, () => {});
  } catch { /* offline or migration 016 pending: keep cache */ }
  return cache;
}
export async function saveProfile(p: Partial<Profile>) {
  cache = { ...cache, ...p, first_name: normalizeName(p.first_name ?? cache.first_name) || null, last_name: normalizeName(p.last_name ?? cache.last_name) || null, nickname: (p.nickname ?? cache.nickname)?.trim() || null }; emit();
  if (isDemo()) return { ok: true };
  const { data: s } = await sb().auth.getSession(); const u = s.session?.user; if (!u) return { ok: false, error: "Not signed in" };
  const { error } = await sb().from("profiles").upsert({ id: u.id, ...cache, updated_at: new Date().toISOString() });
  return error ? { ok: false, error: /column/.test(error.message) ? "Profile fields need migration 016." : error.message } : { ok: true };
}
