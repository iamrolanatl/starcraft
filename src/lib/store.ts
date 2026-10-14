"use client";
// Generic Supabase CRUD with on-device fallback (demo mode or before a migration is run).
import { sb } from "./supabase";
export type Row = { id: string; created_at: string; [k: string]: unknown };
export type Table = "health_logs" | "meds" | "bills" | "credit_scores" | "stocks" | "shop_items" | "comms_notes" | "edu_checkins";
// Real user data goes ONLY to Supabase. localStorage is used solely in demo mode (seeded fake data).
const key = (t: string) => `crystal-demo-${t}`;
const lsGet = (t: string): Row[] => JSON.parse(localStorage.getItem(key(t)) || "[]");
const lsSet = (t: string, r: Row[]) => localStorage.setItem(key(t), JSON.stringify(r));
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));
export class StoreError extends Error { constructor(msg: string, public kind: "signin" | "migration" | "db") { super(msg); } }
let demo = false;
export const setDemo = (d: boolean) => { demo = d; if (d) seedDemo(); };
export const isDemo = () => demo;
export const isLocal = (_t?: Table) => demo;
async function guard() { if (demo) return true; const { data } = await sb().auth.getSession(); if (!data.session) throw new StoreError("Sign in to save your data.", "signin"); return false; }
const fail = (t: string, e: { code?: string; message?: string }) => missing(e) ? new StoreError(`The ${t} table isn't set up yet. Run migration 004 in Supabase.`, "migration") : new StoreError(e.message || "Database error", "db");
const subs = new Set<() => void>();
export const onChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const notify = () => subs.forEach(f => f());

export async function list(t: Table): Promise<Row[]> {
  if (await guard()) return lsGet(t).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const { data, error } = await sb().from(t).select("*").order("created_at", { ascending: false }).limit(500);
  if (error) throw fail(t, error); return data as Row[];
}
export async function insert(t: Table, row: Record<string, unknown>): Promise<void> {
  if (await guard()) { lsSet(t, [...lsGet(t), { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }]); return notify(); }
  const { error } = await sb().from(t).insert(row); if (error) throw fail(t, error); notify();
}
export async function update(t: Table, id: string, patch: Record<string, unknown>): Promise<void> {
  if (await guard()) { lsSet(t, lsGet(t).map(r => (r.id === id ? { ...r, ...patch } : r))); return notify(); }
  const { error } = await sb().from(t).update(patch).eq("id", id); if (error) throw fail(t, error); notify();
}
export async function remove(t: Table, id: string): Promise<void> {
  if (await guard()) { lsSet(t, lsGet(t).filter(r => r.id !== id)); return notify(); }
  const { error } = await sb().from(t).delete().eq("id", id); if (error) throw fail(t, error); notify();
}

// Demo seed (fake data) so the demo cockpit is populated.
function seedDemo() {
  if (typeof window === "undefined" || localStorage.getItem("crystal-demo-seeded") === "2") return;
  const d = (o: number) => { const x = new Date(); x.setDate(x.getDate() + o); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const r = (o: Record<string, unknown>, i: number): Row => ({ id: crypto.randomUUID(), created_at: new Date(Date.now() - i * 3600e3).toISOString(), ...o });
  const seed: Record<Table, Record<string, unknown>[]> = {
    health_logs: [6200, 7400, 9100, 5300, 8800, 10200, 4100].flatMap((v, i) => [{ kind: "steps", value: v, unit: "steps", logged_on: d(-i) }, { kind: "glucose", value: [104, 118, 96, 142, 110, 99, 123][i], unit: "mg/dL", logged_on: d(-i) }]),
    meds: [{ name: "Vitamin D", dose: "2000 IU", schedule: "morning", active: true }, { name: "Metformin", dose: "500 mg", schedule: "8pm", active: true }],
    bills: [{ name: "Electric", amount: 132.4, due_date: d(3), paid: false }, { name: "Water", amount: 48.1, due_date: d(-1), paid: false }, { name: "Internet", amount: 79.99, due_date: d(12), paid: true }],
    credit_scores: [{ score: 712, bureau: "manual", checked_on: d(-90) }, { score: 728, bureau: "manual", checked_on: d(-60) }, { score: 735, bureau: "manual", checked_on: d(-30) }, { score: 744, bureau: "manual", checked_on: d(0) }],
    stocks: [{ symbol: "AAPL", shares: 10 }, { symbol: "MSFT", shares: 4 }, { symbol: "NVDA", shares: 6 }],
    shop_items: [{ list: "shopping", name: "Milk", qty: 1, price: 3.99, done: false }, { list: "shopping", name: "Printer paper", qty: 2, price: 8.5, done: false }, { list: "wish", name: "Noise-cancelling headphones", qty: 1, price: 249, done: false }],
    comms_notes: [{ channel: "email", title: "Reply to teacher about conference", due_date: d(1), done: false }, { channel: "mail", title: "Car registration renewal", due_date: d(9), done: false }, { channel: "drive", title: "Tax docs folder", done: false }],
    edu_checkins: [{ title: "Math unit 3 review", note: "Practice problems 1-12", checkin_on: d(-2) }],
  };
  for (const [t, rows] of Object.entries(seed)) lsSet(t, rows.map(r));
  localStorage.setItem("crystal-demo-seeded", "2");
}

// Handout upload: Supabase Storage bucket "handouts" (private, per-user folder); data URL on-device in demo.
export async function uploadHandout(file: File): Promise<{ path: string; local: boolean }> {
  if (file.size > 10 * 1024 * 1024) throw new Error("File is over 10 MB");
  if (!demo) {
    const { data } = await sb().auth.getSession(); if (!data.session) throw new StoreError("Sign in to upload handouts.", "signin");
    const path = `${data.session.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const { error } = await sb().storage.from("handouts").upload(path, file, { contentType: file.type || undefined });
    if (error) throw new StoreError(/bucket not found/i.test(error.message) ? "Handouts bucket isn't set up yet. Run migration 004 in Supabase." : error.message, "migration");
    return { path, local: false };
  }
  if (file.size > 1.5 * 1024 * 1024) throw new Error("Demo uploads are limited to 1.5 MB");
  const url: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  return { path: url, local: true };
}
export async function handoutUrl(path: string): Promise<string> {
  if (path.startsWith("data:")) return path;
  const { data, error } = await sb().storage.from("handouts").createSignedUrl(path, 300);
  if (error) throw error; return data.signedUrl;
}
