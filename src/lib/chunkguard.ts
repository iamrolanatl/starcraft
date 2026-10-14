"use client";
// Stale-deploy recovery: a tab opened before a deploy may request JS chunks that no longer exist.
// First failure → one automatic reload (guarded by sessionStorage, 2 min). Second failure → "Crystal Updated — Tap to Reload" card.
const KEY = "crystal-chunk-reload";
export function isChunkError(e: unknown): boolean {
  const x = e as { name?: string; message?: string } | string | null; const msg = typeof x === "string" ? x : `${x?.name ?? ""} ${x?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}
export function recoverFromChunkError(): "reloading" | "card" {
  let last = 0; try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* private mode */ }
  if (Date.now() - last > 120_000) { try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } location.reload(); return "reloading"; }
  window.dispatchEvent(new Event("crystal-updated")); return "card";
}
/** Poll /version.json; when a new deploy lands, announce it (card offers reload). */
export function watchVersion(current = process.env.NEXT_PUBLIC_BUILD_ID) {
  if (!current || typeof window === "undefined") return () => {};
  let stop = false; const check = async () => { if (stop || document.hidden) return; try { const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" }); const v = (await r.json()) as { build?: string }; if (v.build && v.build !== current) window.dispatchEvent(new Event("crystal-updated")); } catch { /* offline */ } };
  const iv = setInterval(check, 5 * 60_000); const vis = () => { if (!document.hidden) check(); }; document.addEventListener("visibilitychange", vis); setTimeout(check, 15_000);
  return () => { stop = true; clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
}
