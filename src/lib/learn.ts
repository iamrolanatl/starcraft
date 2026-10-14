"use client";
import { sb } from "./supabase"; import { byChild } from "./family";
export interface LearnUnit { class_name: string; teacher: string | null; unit: string; topic: string | null; book: string | null; pattern: string | null; status: string; source: string; confidence: string; evidence: string; timeline: string[]; researched_at: string }
export interface LearnRes { class_name: string; unit: string | null; title: string; url: string; type: string; source: string; for_assignment: string | null; verified_at: string; active?: boolean }
export type LearnData = { units: LearnUnit[]; resources: LearnRes[]; researched: string } | "missing" | "demo" | "empty";
// Eli's data is only ever read from Supabase behind RLS; nothing about him is bundled into the public site.
export async function loadLearn(demo: boolean): Promise<LearnData> {
  if (demo) return "demo";
  const [u, r] = await Promise.all([
    byChild(sb().from("learn_units").select("class_name,teacher,unit,topic,book,pattern,status,source,confidence,evidence,timeline,researched_at")).in("status", ["current", "upcoming", "done", "unknown"]),
    byChild(sb().from("learn_resources").select("class_name,unit,title,url,type,source,for_assignment,verified_at,active")).eq("active", true)]);
  const e = u.error || r.error;
  if (e) { if (/PGRST205|does not exist|schema cache/i.test(e.message + (e.code || ""))) return "missing"; throw e; }
  if (!u.data?.length) return "empty";
  return { units: u.data as LearnUnit[], resources: (r.data ?? []) as LearnRes[], researched: u.data.map(x => x.researched_at).sort().pop()! };
}
