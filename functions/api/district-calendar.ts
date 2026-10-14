// Official Cobb County School District 2026-27 calendar. Live from the district's ICS subscription feed (edge-cached 24h),
// falling back to the bundled snapshot (public/data/ccsd-2026-27.json). PDF-only dates (first day, Labor Day) are kept from the snapshot.
import { parseICS, type DistrictCal } from "../../src/lib/district";
import snap from "../../public/data/ccsd-2026-27.json";
const S = snap as DistrictCal;
export async function districtCalendar(): Promise<DistrictCal & { live: boolean }> {
  try {
    const r = await fetch(S.source, { signal: AbortSignal.timeout(6000), cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
    if (!r.ok) throw new Error(String(r.status));
    const live = parseICS(await r.text()).filter(e => e.start >= "2026-07-01" && e.start <= "2027-06-30");
    if (live.length < 8) throw new Error("feed too small");
    const pdfOnly = S.events.filter(e => e.source === "pdf" && !live.some(l => l.start === e.start));
    return { ...S, asOf: new Date().toISOString(), events: [...live, ...pdfOnly].sort((a, b) => a.start.localeCompare(b.start)), live: true };
  } catch { return { ...S, live: false }; }
}
export const onRequestGet: PagesFunction = async () => new Response(JSON.stringify(await districtCalendar()), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
