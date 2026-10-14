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
export const DMS_EVENTS: SchoolEvent[] = [
  { start: "2026-10-12", end: "2026-10-12", title: "Digital learning day", kind: "info" },
  { start: "2026-10-13", end: "2026-10-16", title: "Conference week: early release (1:30 PM)", kind: "early" },
  { start: "2026-11-03", end: "2026-11-03", title: "Election Day: student holiday", kind: "holiday" },
  { start: "2026-11-23", end: "2026-11-27", title: "Thanksgiving break", kind: "holiday" },
  { start: "2026-12-17", end: "2026-12-18", title: "Early release (1:30 PM)", kind: "early" },
  { start: "2026-12-21", end: "2027-01-01", title: "Winter break", kind: "holiday" },
  { start: "2027-01-04", end: "2027-01-04", title: "Student holiday", kind: "holiday" },
  { start: "2027-05-19", end: "2027-05-19", title: "Last day of school", kind: "info" },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function schoolDay(d: Date): { kind: "master" | "flex" | "early" | "none"; label: string } {
  const k = ymd(d), dow = d.getDay();
  if (dow === 0 || dow === 6) return { kind: "none", label: "Weekend" };
  const ev = DMS_EVENTS.find(e => k >= e.start && k <= e.end);
  if (ev?.kind === "holiday") return { kind: "none", label: ev.title };
  if (ev?.kind === "early") return { kind: "early", label: "Early release" };
  if (k > "2027-05-19") return { kind: "none", label: "Summer" };
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
