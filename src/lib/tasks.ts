"use client";
import { sb } from "./supabase";
export interface Task { id: string; title: string; notes?: string | null; due_date: string | null; priority: number; done: boolean; created_at: string }
export type NewTask = Pick<Task, "title" | "due_date" | "priority">;

// Supabase only for real users; localStorage only in demo mode.
import { isDemo, StoreError } from "./store";
const LS = "crystal-demo-tasks";
export const usingLocal = () => isDemo();
const lsGet = (): Task[] => JSON.parse(localStorage.getItem(LS) || "null") ?? seed();
const lsSet = (t: Task[]) => localStorage.setItem(LS, JSON.stringify(t));
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));
const fail = (e: { code?: string; message?: string }) => missing(e) ? new StoreError("Tasks table isn't set up. Run migration 001 in Supabase.", "migration") : new StoreError(e.message || "Database error", "db");
function seed(): Task[] { const d = (o: number) => { const x = new Date(); x.setDate(x.getDate() + o); return x.toISOString().slice(0, 10); }; const now = new Date().toISOString();
  const t: Task[] = [{ title: "Sign permission slip", due_date: d(1), priority: 1 }, { title: "Pay water bill", due_date: d(-1), priority: 1 }, { title: "Grocery run", due_date: d(2), priority: 2 }, { title: "Review science notes with Eli", due_date: d(0), priority: 2 }, { title: "Book dentist", due_date: null, priority: 3 }].map(x => ({ ...x, id: crypto.randomUUID(), done: false, created_at: now }));
  lsSet(t); return t; }

export async function listTasks(): Promise<Task[]> {
  if (isDemo()) return lsGet().sort((a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority);
  const { data, error } = await sb().from("tasks").select("*").order("done").order("priority").order("due_date", { nullsFirst: false });
  if (error) throw fail(error); return data as Task[];
}
export async function addTask(t: NewTask): Promise<void> {
  if (isDemo()) return lsSet([...lsGet(), { ...t, id: crypto.randomUUID(), done: false, created_at: new Date().toISOString() }]);
  const { error } = await sb().from("tasks").insert(t); if (error) throw fail(error);
}
export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  if (isDemo()) return lsSet(lsGet().map(t => (t.id === id ? { ...t, ...patch } : t)));
  const { error } = await sb().from("tasks").update(patch).eq("id", id); if (error) throw fail(error);
}
export async function deleteTask(id: string): Promise<void> {
  if (isDemo()) return lsSet(lsGet().filter(t => t.id !== id));
  const { error } = await sb().from("tasks").delete().eq("id", id); if (error) throw fail(error);
}
