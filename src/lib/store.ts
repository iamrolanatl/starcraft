"use client";
// Generic Supabase CRUD with on-device fallback (demo mode or before a migration is run).
import { sb } from "./supabase";
export type Row = { id: string; created_at: string; [k: string]: unknown };
export type Table = "health_logs" | "meds" | "bills" | "credit_scores" | "stocks" | "shop_items" | "comms_notes" | "edu_checkins";
const localTables = new Set<string>();
const key = (t: string) => `crystal-local-${t}`;
const lsGet = (t: string): Row[] => JSON.parse(localStorage.getItem(key(t)) || "[]");
const lsSet = (t: string, r: Row[]) => localStorage.setItem(key(t), JSON.stringify(r));
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));
let demo = false;
export const setDemo = (d: boolean) => { demo = d; };
export const isLocal = (t: Table) => demo || localTables.has(t);
const goLocal = async (t: Table) => { if (demo) return true; const { data } = await sb().auth.getSession(); if (!data.session) return true; return localTables.has(t); };
const subs = new Set<() => void>();
export const onChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const notify = () => subs.forEach(f => f());

export async function list(t: Table): Promise<Row[]> {
  if (!(await goLocal(t))) {
    const { data, error } = await sb().from(t).select("*").order("created_at", { ascending: false }).limit(500);
    if (!error) return data as Row[];
    if (!missing(error)) throw error; localTables.add(t);
  }
  return lsGet(t).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function insert(t: Table, row: Record<string, unknown>): Promise<void> {
  if (!(await goLocal(t))) {
    const { error } = await sb().from(t).insert(row);
    if (!error) return notify();
    if (!missing(error)) throw error; localTables.add(t);
  }
  lsSet(t, [...lsGet(t), { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }]); notify();
}
export async function update(t: Table, id: string, patch: Record<string, unknown>): Promise<void> {
  if (!(await goLocal(t))) { const { error } = await sb().from(t).update(patch).eq("id", id); if (error) throw error; return notify(); }
  lsSet(t, lsGet(t).map(r => (r.id === id ? { ...r, ...patch } : r))); notify();
}
export async function remove(t: Table, id: string): Promise<void> {
  if (!(await goLocal(t))) { const { error } = await sb().from(t).delete().eq("id", id); if (error) throw error; return notify(); }
  lsSet(t, lsGet(t).filter(r => r.id !== id)); notify();
}

// Handout upload: Supabase Storage bucket "handouts" (private, per-user folder); data URL on-device in demo.
export async function uploadHandout(file: File): Promise<{ path: string; local: boolean }> {
  if (file.size > 10 * 1024 * 1024) throw new Error("File is over 10 MB");
  const { data } = await sb().auth.getSession();
  if (!demo && data.session) {
    const path = `${data.session.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await sb().storage.from("handouts").upload(path, file, { contentType: file.type || undefined });
    if (!error) return { path, local: false };
    if (!/bucket not found|not found/i.test(error.message)) throw error;
  }
  if (file.size > 1.5 * 1024 * 1024) throw new Error("Storage bucket not set up yet; on-device copies are limited to 1.5 MB");
  const url: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  return { path: url, local: true };
}
export async function handoutUrl(path: string): Promise<string> {
  if (path.startsWith("data:")) return path;
  const { data, error } = await sb().storage.from("handouts").createSignedUrl(path, 300);
  if (error) throw error; return data.signedUrl;
}
