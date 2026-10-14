"use client";
import { sb } from "./supabase"; import { byChild } from "./family";
export interface ReportCard { id: string; source: string; school_year: string | null; period: string | null; issue_date: string | null; file_name: string | null; bytes: number | null; created_at: string }
export async function listReportCards(demo: boolean): Promise<ReportCard[] | "missing"> {
  if (demo) return [];
  const { data, error } = await byChild(sb().from("report_cards").select("id,source,school_year,period,issue_date,file_name,bytes,created_at")).order("issue_date", { ascending: false, nullsFirst: false });
  if (error) { if (/PGRST205|does not exist|schema cache/i.test(error.message + (error.code || ""))) return "missing"; throw error; }
  return (data ?? []) as ReportCard[];
}
export async function reportCardUrl(id: string): Promise<string> {
  const { data } = await sb().auth.getSession(); const jwt = data.session?.access_token;
  if (!jwt) throw new Error("Sign in first.");
  const r = await fetch(`/api/report-card?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${jwt}` } });
  const b = await r.json().catch(() => ({})) as { url?: string; error?: string };
  if (!r.ok || !b.url) throw new Error(b.error || `HTTP ${r.status}`);
  return b.url;
}
