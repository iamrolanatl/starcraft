# School data inventory (Eli · Dickerson MS · Cobb ParentVUE)

Checked 2026-10-14 against the live laptop pull (job #5, one ParentVUE login). "Available" means the call returned data;
"blocked" means Cobb returned an RT_ERROR for that module. Nothing below is invented; empty means the source is empty.

| Variable | Source (SOAP method / file) | Status | In Crystal |
|---|---|---|---|
| Report-card periods + dates | GetReportCardInitialData | Available: 8 periods (PP1–4, Q1–Q4) | Education › Report Cards |
| Report-card PDF | GetReportCardDocumentData | Available: Quarter 1 (ends 10/09/2026), 13.8 KB PDF | Report Cards viewer |
| Student documents | GetStudentDocumentInitialData | Blocked: "Documents not available for this school" | — |
| Graded assignments, all quarters | Gradebook ReportPeriod=1 (Q1), 3 (Q2) → GradebookAll_RP*.xml | Available: Q1 90 graded across 7 classes; Q2 6 items, none graded yet | Grades › class › Graded assignments |
| Category weights | Gradebook › GradeCalculationSummary/AssignmentGradeCalc | Available for all 7 Q1 classes | Grades › class › weights, impact, what-if |
| Letter scale | Cobb Admin Rule IHA-R (media.cobbk12.org/…/iha-r.f670e337165.pdf) | Published: A 90, B 80, C 74, D 70 | used for what-if |
| District category weights | cobbk12.org | Not published district-wide for middle school | labelled |
| Absences by period + reason/note | Attendance (Absence/Periods) | Available: 4 absence days, per-period course/teacher/reason | pending (Attendance tab) |
| Attendance totals | Attendance Total* | Available | header card (existing) |
| Schedule: period, room, teacher, email | StudentClassList ClassListing | Available: 7 classes with rooms | pending (Schedule tab) |
| Bell times | StudentClassList TodayScheduleInfo | Present but blank (all 12:00 AM): not published | — |
| Homework notes | StudentHWNotes | Available but empty | — |
| Messages (ParentVUE) | GetPXPMessages | Available (currently 0 listings in pull; 2 stored) | Education › Msg |
| Calendar: events + assignment dates/scores | StudentCalendar (this + next month) | Available | Calendar tab (existing) |
| Counselor/homeroom/locker/contacts | StudentInfo | Blocked: "A critical error has occurred" (every run) | — |
| School info: principal, phone | StudentSchoolInfo | Blocked: module not enabled by district | — |
| Discipline | StudentDisciplineInfo | Blocked: module not enabled by district | — |
| Test scores (MAP, Milestones, CogAT) | StudentTestInfo | Blocked: "A critical error has occurred" | — |
| Fees / lunch balance | StudentFeeInfo | Blocked: "A critical error has occurred" | — |
| CTLS Parent feed/assignments/grades/classrooms | laptop ctls\*.json | Files present but last refreshed 2026-10-06 (not part of the 5:40 run) | Messages tab (existing) |
| Office 365 calendar | published ICS | Blocked until Eli publishes an ICS link | — |
