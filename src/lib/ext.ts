"use client";
// External to-do + calendar items (Rolan's Google, Eli's school O365), synced by the box (sync/ext_sync.py).
// Read-only except pending actions (complete / uncomplete / delete), which the box writes back to Google.
import { useEffect, useState } from "react";
import { sb } from "./supabase";
import { isDemo } from "./store";
export type Src = "google" | "o365" | "local";
export interface ExtItem { id: string; source: "google" | "o365"; kind: "task" | "event"; title: string; notes: string | null; due_date: string | null; starts_at: string | null; ends_at: string | null; all_day: boolean; location: string | null; url: string | null; done: boolean; list_name: string | null; pending_action: "complete" | "uncomplete" | "delete" | null; writeback_error: string | null; missing_count: number }
/** Source badge + color (≥4.5:1 on the navy panel). Shared by the To-Do list, Calendar applet and School Hub legend. */
export const SRC: Record<Src, { label: string; short: string; color: string }> = {
  google: { label: "Rolan · Google", short: "Google", color: "#ffd166" },
  o365: { label: "Eli · School O365", short: "Eli O365", color: "#9fb4ff" },
  local: { label: "Crystal (local)", short: "Crystal", color: "#3ef2e0" },
};
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks";

export async function loadExt(): Promise<ExtItem[]> {
  if (isDemo()) return [];
  const { data, error } = await sb().from("ext_items").select("id,source,kind,title,notes,due_date,starts_at,ends_at,all_day,location,url,done,list_name,pending_action,writeback_error,missing_count").is("archived_at", null).eq("hidden", false).order("due_date", { nullsFirst: false }).limit(2000);
  if (error) return []; // migration 009 not run yet -> no external items, nothing breaks
  return ((data ?? []) as ExtItem[]).filter(x => x && typeof x.title === "string");
}
export async function requestAction(id: string, action: ExtItem["pending_action"], hidden = false) {
  const { error } = await sb().from("ext_items").update({ pending_action: action, pending_at: action ? new Date().toISOString() : null, hidden }).eq("id", id);
  if (error) throw new Error(error.message);
}
/** Day key (America/New_York) for an item. */
export function extDay(x: ExtItem): string | null {
  if (x.kind === "task" || x.all_day || !x.starts_at) return x.due_date;
  return new Date(x.starts_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
/** Inclusive list of days an all-day / multi-day event covers (max 31). */
export function extDays(x: ExtItem): string[] {
  const s = extDay(x); if (!s) return [];
  const e = x.ends_at ? new Date(x.ends_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) : s;
  const out: string[] = []; const d = new Date(s + "T12:00");
  while (out.length < 31) { const k = d.toLocaleDateString("en-CA"); out.push(k); if (k >= e) break; d.setDate(d.getDate() + 1); }
  return out;
}
export const extTime = (x: ExtItem) => x.kind === "event" && !x.all_day && x.starts_at ? new Date(x.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

let cache: ExtItem[] = []; const subs = new Set<(x: ExtItem[]) => void>(); let timer: ReturnType<typeof setInterval> | null = null;
export async function refreshExt() { cache = await loadExt().catch(() => cache); subs.forEach(f => f(cache)); }
export function useExt(): [ExtItem[], () => Promise<void>] {
  const [items, set] = useState<ExtItem[]>(cache);
  useEffect(() => { subs.add(set); if (!timer) { refreshExt(); timer = setInterval(refreshExt, 120000); } else set(cache);
    return () => { subs.delete(set); if (!subs.size && timer) { clearInterval(timer); timer = null; } }; }, []);
  return [items, refreshExt];
}

/** After "Connect Google", Supabase hands back Google's refresh token once; store it server-side (private schema). */
export async function captureGoogleToken(): Promise<boolean> {
  const { data } = await sb().auth.getSession(); const rt = data.session?.provider_refresh_token;
  if (!rt) return false;
  const { error } = await sb().rpc("save_google_token", { p_refresh: rt, p_scopes: GOOGLE_SCOPES });
  return !error;
}
export async function googleStatus(): Promise<{ connected: boolean; updated_at?: string } | null> {
  const { data, error } = await sb().rpc("google_token_status"); if (error) return null;
  const r = (data as { connected: boolean; updated_at: string }[] | null)?.[0]; return r ? r : { connected: false };
}
export async function connectGoogle() {
  const { error } = await sb().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/app/?google=connected`, scopes: GOOGLE_SCOPES, queryParams: { access_type: "offline", prompt: "consent" } } });
  if (error) throw new Error(error.message);
}
export interface ExtRun { created_at: string; source: string; kind: string; status: string; reason: string | null; pulled: number | null }
export async function lastRuns(): Promise<ExtRun[]> {
  const { data, error } = await sb().from("ext_sync_runs").select("created_at,source,kind,status,reason,pulled").order("created_at", { ascending: false }).limit(20);
  return error ? [] : (data as ExtRun[]);
}
