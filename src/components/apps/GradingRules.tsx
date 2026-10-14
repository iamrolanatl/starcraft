"use client";
import ProgressBar from "@/components/ui/ProgressBar";
import { useEffect, useState } from "react";
import { LETTER_STYLE, gradeHex, gradeText, isLow, type Letter } from "@/lib/letter";
import LetterBadge from "@/components/ui/LetterBadge";

// Facts below come ONLY from Cobb County School District Administrative Rule IHA-R "Grading Systems" (rev. 1/16/25).
// Source: https://media.cobbk12.org/media/WWWCobb/medialib/iha-r.f670e337165.pdf. Page numbers are the PDF’s own "Page N of 7".
const SRC = "https://media.cobbk12.org/media/WWWCobb/medialib/iha-r.f670e337165.pdf";
const BANDS = [
  { l: "A", lo: 90, hi: 100, c: LETTER_STYLE.A.bg, d: "superior achievement" },
  { l: "B", lo: 80, hi: 89, c: LETTER_STYLE.B.bg, d: "above average achievement" },
  { l: "C", lo: 74, hi: 79, c: LETTER_STYLE.C.bg, d: "average achievement" },
  { l: "D", lo: 70, hi: 73, c: LETTER_STYLE.D.bg, d: "minimum achievement" },
  { l: "F", lo: 0, hi: 69, c: LETTER_STYLE.F.bg, d: "failure to achieve" },
];
const MIN = 60; // visual axis floor only (not a rule)
export const letterOf = (p: number) => (BANDS.find(b => Math.floor(p) >= b.lo) ?? BANDS[4]);
const Cite = ({ s }: { s: string }) => <a href={SRC} target="_blank" rel="noreferrer" className="gr-cite" title="Open Cobb rule IHA-R (PDF)">{s}</a>;
export type RuleClass = { key: string; course: string; percent: number | null };

function useGrow() { const [on, setOn] = useState(false); useEffect(() => { const t = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(t); }, []); return on; }

export default function GradingRules({ classes }: { classes: RuleClass[] }) {
  const on = useGrow();
  const pos = (p: number) => `${Math.max(0, Math.min(100, ((p - MIN) / (100 - MIN)) * 100))}%`;
  const graded = classes.filter(c => c.percent != null) as (RuleClass & { percent: number })[];
  return (<div className="gr-root space-y-3">
    <style>{CSS}</style>
    <div className="gr-card"><div className="gr-h">Cobb Middle School Grading Scale <Cite s="IHA-R §C.1, p.3" /></div>
      <p className="gr-sub">“All subjects shall be graded by means of numerical grades.” Letters represent these averages:</p>
      <div className="gr-scale" role="img" aria-label="Grading scale: A 90 to 100, B 80 to 89, C 74 to 79, D 70 to 73, F below 70">
        {[...BANDS].reverse().map(b => { const lo = Math.max(b.lo, MIN), hi = b.hi + 1; return <div key={b.l} className="gr-band" style={{ left: pos(lo), width: on ? `calc(${pos(Math.min(hi, 100))} - ${pos(lo)} + ${hi > 100 ? "0%" : "0%"})` : 0, background: b.c, color: LETTER_STYLE[b.l as Letter].fg }}><span>{b.l}</span></div>; })}
        {[60, 70, 74, 80, 90, 100].map(t => <span key={t} className="gr-tick" style={{ left: pos(t) }}>{t}</span>)}
        {graded.map(c => <span key={c.key} className="gr-pin" style={{ left: on ? pos(c.percent) : pos(MIN) }} title={`${c.course}: ${c.percent}`} />)}
      </div>
      <ul className="gr-legend">{BANDS.map(b => <li key={b.l}><b className="gr-box" style={{ background: b.c, borderColor: LETTER_STYLE[b.l as Letter].ring, color: LETTER_STYLE[b.l as Letter].fg }}>{b.l}</b>{b.l === "F" ? "below 70" : `${b.lo}–${b.hi}`} · {b.d}</li>)}</ul>
      <p className="gr-note">Bars start at 60 for readability. Note C is only 6 points wide (74–79) and D only 4 (70–73).</p>
    </div>

    {graded.length > 0 && <div className="gr-card"><div className="gr-h">Eli vs. the Scale <span className="gr-sub">(live grades from your sync, scale from <Cite s="§C.1, p.3" />)</span></div>
      <ul className="space-y-2">{graded.map(c => { const L = letterOf(c.percent); const to90 = 90 - c.percent; const next = BANDS.find(b => b.lo > c.percent && b.lo <= 90 && BANDS.indexOf(b) === BANDS.indexOf(L) - 1);
        return <li key={c.key}>
          <div className="flex items-center gap-2"><LetterBadge pct={c.percent} size="sm" /><span className="min-w-0 flex-1 truncate gr-txt" title={c.course}>{c.course}</span><span className={`font-mono ${gradeText(c.percent)}`}>{c.percent.toFixed(c.percent % 1 ? 1 : 0)}</span></div>
          <ProgressBar kind="grade" value={c.percent} label={`${c.course} grade`} message height={10} />
          <div className="gr-note">{to90 <= 0 ? `In the A band, ${(c.percent - 90).toFixed(1)} pts of cushion above 90.` : `${to90.toFixed(1)} pts to 90 (A)${next && next.l !== "A" ? ` · ${(next.lo - c.percent).toFixed(1)} to ${next.l}` : ""}.`}</div>
        </li>; })}</ul></div>}

    <div className="grid gap-3 sm:grid-cols-2">
      <div className="gr-card"><div className="gr-h">Make-Up Window <Cite s="§C.2, p.3" /></div>
        <p className="gr-sub">Incomplete work: 14 calendar days after the close of each semester, accepted on the same basis for all students. The Principal may extend for medical reasons.</p>
        <div className="gr-tl" role="img" aria-label="Timeline: semester closes, then 14 calendar days to complete make-up work">
          <span className="gr-tl-a">Semester closes</span><div className="gr-tl-bar"><div className="gr-tl-fill" style={{ width: on ? "100%" : 0 }} />{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</div><span className="gr-tl-b">Day 14</span>
        </div></div>
      <div className="gr-card"><div className="gr-h">Conduct Marks <Cite s="§C.3, p.3" /></div>
        <ul className="gr-steps">{[["S", "Satisfactory", "#3ddc84"], ["NI", "Needs Improvement", "#f5b83d"], ["U", "Unsatisfactory", "#ff4d6a"]].map(([k, v, c]) => <li key={k}><b className="gr-box" style={{ borderColor: c, color: c }}>{k}</b>{v}</li>)}</ul>
        <p className="gr-note">Conduct is a separate mark, not part of the number grade.</p></div>
    </div>

    <div className="gr-card"><div className="gr-h">What Matters Most for a 90%+ 7th Grader</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="gr-call" style={{ borderColor: "#3ddc84" }}><b>90 is the A line.</b> An 89 is a B — there’s no rounding rule in IHA-R. <Cite s="§C.1, p.3" /></div>
        <div className="gr-call" style={{ borderColor: "#ff4d6a" }}><b>Below 70 is failing</b> (state minimum passing score is 70). <Cite s="§B.2.d, p.2 · Rule 160-4-2-.13, p.7" /></div>
        <div className="gr-call" style={{ borderColor: "#f5b83d" }}><b>Parents are notified before a failing final</b> for a period, quarter or semester (per school procedure). <Cite s="§A.3, p.1" /></div>
        <div className="gr-call" style={{ borderColor: "#4aa8ff" }}><b>14-day make-up window</b> after each semester closes. <Cite s="§C.2, p.3" /></div>
        <div className="gr-call" style={{ borderColor: "#b48cff" }}><b>High-school courses taken in middle school</b> follow all high-school rules (grading, withdrawing, scheduling). <Cite s="§C.4, p.3" /></div>
        <div className="gr-call" style={{ borderColor: "#7dd3fc" }}><b>Only teachers assign grades;</b> no teacher can be pressured to change one, but grades can be discussed with the principal. <Cite s="§A.1.b, p.1" /></div>
      </div></div>

    <div className="gr-card"><div className="gr-h">Looking Ahead: High School <Cite s="§D, pp.3–6" /></div>
      <div className="grid gap-2 sm:grid-cols-3 gr-txt text-xs">
        <div className="gr-call"><b>Quality points</b> (p.6): Regular +0 · Honors A–D +0.5 · AP/IB/college A–D +1 · F always 0.</div>
        <div className="gr-call"><b>Honor Graduate</b>: GPA 3.500 or better (§D.9.b(4), p.6).</div>
        <div className="gr-call"><b>Withdraw after day 10</b> of a semester → grade of 10 recorded (§D.6.a, p.4). Credit earned can’t be repeated to raise a grade; an F can be (§D.8, p.5).</div>
      </div></div>

    <div className="gr-card gr-miss"><div className="gr-h">Not in This Rule</div>
      <p className="gr-sub">IHA-R does <b>not</b> set category weights, late-work penalties, retake/reassessment rules, minimum grades, honor roll, or report-period dates. Those come from teacher syllabi, school procedures, or other Cobb rules (promotion/retention is in IHE-R, referenced at §D.4, p.3). Crystal won’t chart numbers this rule doesn’t contain.</p></div>
    <p className="gr-note">Source: Cobb County School District Administrative Rule IHA-R, Grading Systems, revised 1/16/25. <a href={SRC} target="_blank" rel="noreferrer" className="gr-cite">Open PDF</a></p>
  </div>);
}

const CSS = `
.gr-root{--gr-txt:#e6e9f0;--gr-dim:#a9b1c3}
.gr-root .gr-card{background:rgba(10,14,28,.62);backdrop-filter:blur(10px);border:1px solid rgba(125,211,252,.22);border-radius:12px;padding:10px 12px;color:var(--gr-txt)}
.gr-root .gr-h{font-weight:700;font-size:13px;color:var(--gr-txt);margin-bottom:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
.gr-root .gr-sub{font-size:12px;color:var(--gr-dim);line-height:1.45;font-weight:400}
.gr-root .gr-txt{color:var(--gr-txt)}
.gr-root .gr-note{font-size:11px;color:var(--gr-dim);margin-top:4px}
.gr-root .gr-cite{font-size:10px;font-weight:600;color:#7dd3fc;border:1px solid rgba(125,211,252,.35);border-radius:6px;padding:0 5px;text-decoration:none;white-space:nowrap}
.gr-root .gr-cite:hover{background:rgba(125,211,252,.12)}
.gr-root .gr-scale{position:relative;height:34px;margin:22px 0 22px;background:rgba(255,255,255,.05);border-radius:8px}
.gr-root .gr-band{position:absolute;top:0;bottom:0;opacity:.85;transition:width 1s cubic-bezier(.2,.8,.2,1);display:flex;align-items:center;justify-content:center;overflow:hidden;border-right:2px solid rgba(10,14,28,.9)}
.gr-root .gr-band span{font-weight:900;font-size:16px;color:inherit}
.gr-root .gr-tick{position:absolute;top:100%;transform:translateX(-50%);font:10px ui-monospace,monospace;color:var(--gr-dim);margin-top:3px}
.gr-root .gr-pin{position:absolute;top:-10px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:#fff;box-shadow:0 0 6px #fff;transition:left 1.2s cubic-bezier(.2,.8,.2,1)}
.gr-root .gr-legend{display:grid;gap:3px;font-size:12px;color:var(--gr-txt)}
.gr-root .gr-legend li,.gr-root .gr-steps li{display:flex;align-items:center;gap:8px}
.gr-root .gr-steps{display:grid;gap:5px;font-size:12px}
.gr-root .gr-box{display:inline-flex;min-width:30px;height:26px;padding:0 4px;align-items:center;justify-content:center;border:2px solid;border-radius:6px;font-weight:900;font-size:15px;background:rgba(0,0,0,.25)}
.gr-root .gr-track{position:relative;height:10px;border-radius:5px;background:rgba(255,255,255,.07);margin-top:4px;overflow:visible}
.gr-root .gr-fill{height:100%;border-radius:5px;transition:width 1.1s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 8px currentColor}
.gr-root .gr-90{position:absolute;left:90%;top:-3px;bottom:-3px;width:2px;background:#22c55e}
.gr-root .gr-tl{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:11px;color:var(--gr-dim)}
.gr-root .gr-tl-bar{position:relative;flex:1;height:14px;border-radius:7px;background:rgba(255,255,255,.07);display:grid;grid-template-columns:repeat(14,1fr);overflow:hidden}
.gr-root .gr-tl-bar i{border-right:1px solid rgba(10,14,28,.8);position:relative;z-index:1}
.gr-root .gr-tl-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#4aa8ff,#f5b83d);transition:width 1.4s linear}
.gr-root .gr-call{border-left:3px solid rgba(125,211,252,.4);background:rgba(255,255,255,.04);border-radius:8px;padding:6px 8px;font-size:12px;line-height:1.45;color:var(--gr-txt)}
.gr-root .gr-miss{border-style:dashed}
@media (prefers-reduced-motion:reduce){.gr-root *{transition:none!important}.gr-root *:not(.grade-low){animation:none!important}}
`;
