// Names & greetings. Names come from the Google identity (user_metadata), never from the email address.
export interface Profile { display_name?: string | null; first_name?: string | null; last_name?: string | null; nickname?: string | null; avatar_url?: string | null; timezone?: string | null }
/** "rolan" → "Rolan", "MARY-JANE" → "Mary-Jane", "o'neil" → "O'Neil"; already mixed-case parts ("McDonald", "DeShawn") are kept. */
export function normalizeName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().replace(/\s+/g, " "); if (!s) return "";
  return s.split(" ").map(word => word.split(/([-'’])/).map(part => {
    if (!part || /^[-'’]$/.test(part)) return part;
    const mixed = part !== part.toLowerCase() && part !== part.toUpperCase();
    if (mixed) return part;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join("")).join(" ");
}
type Meta = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
/** Build a profile from Supabase auth user_metadata (Google: given_name, family_name, full_name, name, avatar_url / picture). */
export function profileFromIdentity(meta: Meta): Profile {
  const m = meta ?? {}; const full = str(m.full_name) || str(m.name);
  // Guard: a "name" that is really an email (some providers do this) is ignored.
  const fullOk = full && !full.includes("@") ? full : "";
  const first = normalizeName(str(m.given_name) || fullOk.split(" ")[0] || "");
  const last = normalizeName(str(m.family_name) || (fullOk.split(" ").length > 1 ? fullOk.split(" ").slice(1).join(" ") : ""));
  return { first_name: first || null, last_name: last || null, display_name: normalizeName(fullOk) || [first, last].filter(Boolean).join(" ") || null, avatar_url: str(m.avatar_url) || str(m.picture) || null };
}
/** Fallback order: nickname → Google given name → "Commander". Never the email local part. */
export function greetName(p: Profile | null | undefined): string { return normalizeName(p?.nickname) || normalizeName(p?.first_name) || "Commander"; }
export function partOfDay(d = new Date(), tz = "America/New_York"): "morning" | "afternoon" | "evening" {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(d)); return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}
export function greeting(p: Profile | null | undefined, d = new Date()): string { return `Good ${partOfDay(d, p?.timezone || "America/New_York")}, ${greetName(p)}!`; }
