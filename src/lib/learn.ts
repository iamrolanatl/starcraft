"use client";
import { sb } from "./supabase";
import snap from "./learn-snapshot.json";
export interface LearnUnit { class_name: string; teacher: string | null; unit: string; topic: string | null; book: string | null; pattern: string | null; status: string; source: string; confidence: string; evidence: string; timeline: string[]; researched_at: string }
export interface LearnRes { class_name: string; unit: string | null; title: string; url: string; type: string; source: string; for_assignment: string | null; verified_at: string; active?: boolean }
export interface LearnData { units: LearnUnit[]; resources: LearnRes[]; origin: "live" | "snapshot"; researched: string }
const fromSnap = (): LearnData => ({ origin: "snapshot", researched: snap.generated,
  units: snap.units.map(u => ({ class_name: u.class, teacher: u.teacher, unit: u.unit, topic: u.topic, book: u.book, pattern: u.pattern, status: u.status, source: u.source, confidence: u.confidence, evidence: u.evidence, timeline: u.timeline, researched_at: snap.generated })),
  resources: snap.resources as LearnRes[] });
export async function loadLearn(demo: boolean): Promise<LearnData> {
  if (demo) return fromSnap();
  try {
    const [u, r] = await Promise.all([
      sb().from("learn_units").select("class_name,teacher,unit,topic,book,pattern,status,source,confidence,evidence,timeline,researched_at").in("status", ["current", "upcoming", "done", "unknown"]),
      sb().from("learn_resources").select("class_name,unit,title,url,type,source,for_assignment,verified_at,active").eq("active", true)]);
    if (u.error || r.error || !u.data?.length) return fromSnap();   // table missing or empty pull: never blank the view
    const latest = u.data.map(x => x.researched_at).sort().pop() || snap.generated;
    return { origin: "live", units: u.data as LearnUnit[], resources: (r.data ?? []) as LearnRes[], researched: latest };
  } catch { return fromSnap(); }
}
