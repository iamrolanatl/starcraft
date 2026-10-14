"use client";
// Per-user UI prefs: Supabase `user_prefs` for signed-in users (migration 005), localStorage cache for instant paint / demo.
import { sb } from "./supabase";
import { isDemo } from "./store";
import { lsGet, lsSet } from "./safe";
export type Clarity = "clear" | "balanced" | "solid";
export interface Prefs { glass?: Clarity; tiles?: string[]; favorites?: string[]; win?: "full" | "normal" }
const KEY = "crystal-uiprefs"; let cache: Prefs = typeof window !== "undefined" ? lsGet<Prefs>(KEY, {}) : {};
export const getPrefs = () => cache;
export function applyGlass(c: Clarity = cache.glass ?? "balanced") { if (typeof document !== "undefined") document.documentElement.dataset.glass = c; }
export async function loadPrefs(): Promise<Prefs> {
  if (!isDemo()) { try { const { data: s } = await sb().auth.getSession(); if (s.session) { const { data, error } = await sb().from("user_prefs").select("prefs").maybeSingle(); if (!error && data?.prefs && typeof data.prefs === "object") { cache = { ...cache, ...(data.prefs as Prefs) }; lsSet(KEY, cache); } } } catch { /* table may not exist yet (migration 005) */ } }
  applyGlass(); return cache;
}
let t: ReturnType<typeof setTimeout> | undefined;
export function savePrefs(p: Partial<Prefs>) {
  cache = { ...cache, ...p }; lsSet(KEY, cache); applyGlass(); window.dispatchEvent(new Event("crystal-prefs"));
  if (isDemo()) return; clearTimeout(t);
  t = setTimeout(async () => { try { const { data: s } = await sb().auth.getSession(); if (s.session) await sb().from("user_prefs").upsert({ user_id: s.session.user.id, prefs: cache, updated_at: new Date().toISOString() }); } catch { /* offline / migration pending: cached locally, retried on next change */ } }, 600);
}
