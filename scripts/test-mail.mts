import { answerMail, emptyLife, lifeBlock } from "../functions/_lib/life";
const L = emptyLife(); L.mail = [{ from: "Jane Sparks <jane.sparks@cobbk12.org>", subject: "Unit 3 test", date: "2026-10-13T19:05:00Z", snippet: "", is_read: false, school_tag: "teacher" }, { from: "Mr. Lee <lee@cobbk12.org>", subject: "Lab", date: "2026-10-12T10:00:00Z", snippet: "", is_read: true, school_tag: "teacher" }];
const a = answerMail("any new emails from Ms. Sparks?", L, false)!; console.log(a); if (!a.includes("Unit 3 test") || a.includes("Lab")) throw 1;
const b = answerMail("any new emails from Mr. Lee?", L, false)!; console.log(b); if (!b.startsWith("No new")) throw 2;
if (answerMail("what's Eli's math grade", L, false) !== null) throw 3;
if (!lifeBlock(L, false).includes("UNREAD [teacher] from Jane Sparks")) throw 4; console.log("TS OK");
