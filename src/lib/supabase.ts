"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ogrrjkxkccbywbiikcak.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, ANON, { auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true } });
  return client;
}
