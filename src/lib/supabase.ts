"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ogrrjkxkccbywbiikcak.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
/** 15s timeout on every Supabase request so a dead network never hangs the UI. */
const timedFetch: typeof fetch = (input, init) => { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000); init?.signal?.addEventListener("abort", () => ac.abort(), { once: true }); return fetch(input, { ...init, signal: ac.signal }).finally(() => clearTimeout(t)); };
let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, ANON, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }, global: { fetch: timedFetch } });
  return client;
}
