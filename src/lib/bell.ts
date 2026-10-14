// Dickerson MS 7th-grade bell times, from https://cobbk12.org/dickerson/class-schedules (checked 2026-10-14).
// Mon–Wed master schedule; Thu–Fri flex block; early-release schedule on district early-release days.
// On the flex table the 7th-grade column repeats master times for periods 4–5, which overlap its own flex block;
// periods 4/5/flex therefore use the Connections column (which teaches 7th-grade connections on flex days).
export const BELL_SOURCE = "https://cobbk12.org/dickerson/class-schedules";
export type Slot = { label: string; period: number | null; start: string; end: string };
const S = (label: string, period: number | null, start: string, end: string): Slot => ({ label, period, start, end });
export const MASTER: Slot[] = [S("Homeroom", null, "09:08", "09:13"), S("1st", 1, "09:15", "10:08"), S("2nd", 2, "10:11", "11:04"), S("3rd (lunch)", 3, "11:07", "12:29"), S("4th (connections 1)", 4, "12:32", "13:25"), S("5th (connections 2)", 5, "13:28", "14:20"), S("6th", 6, "14:24", "15:17"), S("7th", 7, "15:20", "16:15")];
export const FLEX: Slot[] = [S("Homeroom", null, "09:08", "09:13"), S("1st", 1, "09:15", "10:03"), S("2nd", 2, "10:06", "10:54"), S("3rd (lunch)", 3, "10:57", "12:20"), S("4th (connections 1)", 4, "12:22", "13:09"), S("5th (connections 2)", 5, "13:11", "13:58"), S("Flex block", null, "14:00", "14:30"), S("6th", 6, "14:36", "15:24"), S("7th", 7, "15:27", "16:15")];
export const EARLY: Slot[] = [S("Homeroom", null, "09:08", "09:13"), S("1st", 1, "09:15", "09:49"), S("2nd", 2, "09:51", "10:19"), S("3rd (lunch)", 3, "10:21", "11:10"), S("4th (connections 1)", 4, "11:13", "11:47"), S("5th (connections 2)", 5, "11:50", "12:20"), S("6th", 6, "12:25", "12:55"), S("7th", 7, "12:58", "13:30")];
export function bellFor(date: Date, earlyRelease: boolean): { name: string; slots: Slot[] } {
  if (earlyRelease) return { name: "Early release", slots: EARLY };
  const d = date.getDay(); return d === 4 || d === 5 ? { name: "Flex block (Thu–Fri)", slots: FLEX } : { name: "Master (Mon–Wed)", slots: MASTER };
}
export const hm = (t: Date) => `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
export const fmt12 = (s: string) => { const [h, m] = s.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`; };
