// Dickerson Middle School (Cobb County, GA) bell schedules and 2026-27 district calendar.
// Source: cobbk12.org/dickerson/class-schedules and the CCSD 2026-27 calendar (checked Oct 14 2026).
export type Grade = "6" | "7" | "8";
type Sched = [string, string][];
const S = (rows: string): Sched => rows.trim().split("\n").map(l => l.split("|").map(s => s.trim()) as [string, string]);
export const DMS = {
  name: "Dickerson MS",
  schedules: {
    master: {
      "6": S(`Homeroom|9:08-9:13
1st period|9:15-10:08
2nd period|10:11-11:04
3rd period|11:07-12:00
4th period (lunch)|12:03-1:25
5th period|1:28-2:20
6th period (Connections 1)|2:24-3:17
7th period (Connections 2)|3:20-4:15`),
      "7": S(`Homeroom|9:08-9:13
1st period|9:15-10:08
2nd period|10:11-11:04
3rd period (lunch)|11:07-12:29
4th period (Connections 1)|12:32-1:25
5th period (Connections 2)|1:28-2:20
6th period|2:24-3:17
7th period|3:20-4:15`),
      "8": S(`Homeroom|9:08-9:13
1st period (Connections 1)|9:15-10:08
2nd period (Connections 2)|10:11-11:04
3rd period|11:07-12:00
4th period (lunch)|12:03-1:25
5th period|1:28-2:20
6th period|2:24-3:17
7th period|3:20-4:15`),
    },
    flex: {
      "6": S(`Homeroom|9:08-9:13
1st period|9:15-10:03
2nd period|10:06-10:54
Flex block|10:57-11:27
3rd period (lunch)|11:30-12:50
4th period|12:53-1:41
5th period|1:44-2:33
6th period (Connections 1)|2:36-3:24
7th period (Connections 2)|3:27-4:15`),
      "7": S(`Homeroom|9:08-9:13
1st period|9:15-10:03
2nd period|10:06-10:54
3rd period (lunch)|10:57-12:20
4th period (Connections 1)|12:32-1:25
5th period (Connections 2)|1:28-2:20
Flex block|2:00-2:30
6th period|2:36-3:24
7th period|3:27-4:15`),
      "8": S(`Homeroom|9:08-9:13
1st period (Connections 1)|9:15-10:03
2nd period (Connections 2)|10:06-10:54
3rd period|10:57-11:45
Flex block|11:48-12:18
4th period (lunch)|12:21-1:41
5th period|1:44-2:33
6th period|2:36-3:24
7th period|3:27-4:15`),
    },
    early: {
      "6": S(`Homeroom|9:08-9:13
1st period|9:15-9:46
2nd period|9:48-10:19
3rd period|10:21-10:52
4th period (lunch)|10:54-11:51
5th period|11:53-12:21
6th period (Connections 1)|12:24-12:58
7th period (Connections 2)|1:00-1:30`),
      "7": S(`Homeroom|9:08-9:13
1st period|9:15-9:49
2nd period|9:51-10:19
3rd period (lunch)|10:21-11:10
4th period (Connections 1)|11:13-11:47
5th period (Connections 2)|11:50-12:20
6th period|12:25-12:55
7th period|12:58-1:30`),
      "8": S(`Homeroom|9:08-9:13
1st period (Connections 1)|9:15-9:49
2nd period (Connections 2)|9:51-10:21
3rd period|10:25-10:55
4th period (lunch)|10:57-11:27
5th period|11:29-12:22
6th period|12:25-12:55
7th period|12:58-1:30`),
    },
  } as Record<"master" | "flex" | "early", Record<Grade, Sched>>,
};

export interface SchoolEvent { start: string; end: string; title: string; kind: "holiday" | "early" | "info" }
import { eventsOn, isNoSchool, type DistrictCal } from "./district";
import snap from "../../public/data/ccsd-2026-27.json";
/** Official CCSD 2026-27 events (snapshot of the district ICS feed; refreshed live by /api/district-calendar). */
export const DISTRICT = snap as DistrictCal;
const KIND = { first_last: "info", holiday: "holiday", student_holiday: "holiday", early_release: "early", digital: "info", testing: "info", report_card: "info", board: "info", other: "info" } as const;
export const DMS_EVENTS: SchoolEvent[] = DISTRICT.events.filter(e => e.cat !== "board").map(e => ({ start: e.start, end: e.end, title: e.title, kind: KIND[e.cat] }));

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function schoolDay(d: Date): { kind: "master" | "flex" | "early" | "none"; label: string } {
  const k = ymd(d), dow = d.getDay();
  if (dow === 0 || dow === 6) return { kind: "none", label: "Weekend" };
  if (k < "2026-08-03" || k > "2027-05-19") return { kind: "none", label: "Summer" };
  const ev = eventsOn(k, DISTRICT.events);
  if (isNoSchool(k, DISTRICT.events)) return { kind: "none", label: ev.find(e => e.cat === "holiday" || e.cat === "student_holiday")?.title ?? "No school" };
  if (ev.some(e => e.cat === "digital")) return { kind: "none", label: "Digital learning day (at home)" };
  if (ev.some(e => e.cat === "early_release")) return { kind: "early", label: "Early release" };
  return dow >= 4 ? { kind: "flex", label: "Flex block day" } : { kind: "master", label: "Master schedule" };
}

export const PORTALS = [
  { name: "ParentVUE", url: "https://parentvue.cobbk12.org/PXP2_Login.aspx", note: "Grades, attendance (synced by laptop)" },
  { name: "StudentVUE", url: "https://studentvue.cobbk12.org/PXP2_Login.aspx", note: "Student view of grades" },
  { name: "CTLS Parent", url: "https://ctlsparent.cobbk12.org/signin", note: "Teacher messages, assignments" },
  { name: "CTLS Learn", url: "https://ctlslearn.cobbk12.org", note: "Coursework (student SSO)" },
  { name: "Office 365", url: "https://www.office.com", note: "Student email, OneDrive, Teams" },
  { name: "Dickerson MS", url: "https://cobbk12.org/dickerson", note: "School site, news" },
];
