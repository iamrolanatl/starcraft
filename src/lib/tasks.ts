"use client";
import { sb } from "./supabase";
export interface Task { id: string; title: string; notes?: string | null; due_date: string | null; priority: number; done: boolean; created_at: string }
export type NewTask = Pick<Task, "title" | "due_date" | "priority">;

// Supabase-backed store; falls back to localStorage if the tasks table is not migrated yet.
const LS = "crystal-local-tasks";
let local = false;
export const usingLocal = () => local;
const lsGet = (): Task[] => JSON.parse(localStorage.getItem(LS) || "[]");
const lsSet = (t: Task[]) => localStorage.setItem(LS, JSON.stringify(t));
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));

export async function listTasks(): Promise<Task[]> {
  if (!local) {
    const { data, error } = await sb().from("tasks").select("*").order("done").order("priority").order("due_date", { nullsFirst: false });
    if (!error) return data as Task[];
    if (!missing(error)) throw error; local = true;
  }
  return lsGet().sort((a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority);
}
export async function addTask(t: NewTask): Promise<void> {
  if (!local) { const { error } = await sb().from("tasks").insert(t); if (!error) return; if (!missing(error)) throw error; local = true; }
  lsSet([...lsGet(), { ...t, id: crypto.randomUUID(), done: false, created_at: new Date().toISOString() }]);
}
export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  if (!local) { const { error } = await sb().from("tasks").update(patch).eq("id", id); if (error) throw error; return; }
  lsSet(lsGet().map(t => (t.id === id ? { ...t, ...patch } : t)));
}
export async function deleteTask(id: string): Promise<void> {
  if (!local) { const { error } = await sb().from("tasks").delete().eq("id", id); if (error) throw error; return; }
  lsSet(lsGet().filter(t => t.id !== id));
}
