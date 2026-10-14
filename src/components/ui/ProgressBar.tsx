"use client";
import { useEffect, useState } from "react";
import { gradeHex, isLow } from "@/lib/letter";
import { kidMsg, gapText } from "@/lib/progress";
/** Shared progress bar: neon fill + soft glow + slow shimmer, animated fill-in, hover/tap value + gap.
 *  kind="grade": grade-colored, fixed 90% GOAL marker, goal-met sparkle, kid-friendly message (message prop). Reduced motion → static. */
export default function ProgressBar({ value, kind = "plain", label, color, height = 8, message = false, goal = 90, className = "" }:
  { value: number | null | undefined; kind?: "grade" | "plain"; label: string; color?: string; height?: number; message?: boolean; goal?: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0))); const grade = kind === "grade"; const met = grade && v >= goal;
  const c = color ?? (grade ? gradeHex(v) : "var(--neon, #3ef2e0)");
  const [on, setOn] = useState(false); const [tip, setTip] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(t); }, []);
  const tipText = `${Math.round(v * 10) / 10}%${grade ? ` · ${gapText(v, goal)}` : ""}`;
  return <div className={`pb ${className}`} data-pb={kind}>
    <div role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-valuetext={tipText} tabIndex={0} data-tip={`${label}: ${tipText}`}
      onClick={() => setTip(t => !t)} onBlur={() => setTip(false)} className={`pb-track ${grade ? "pb-has-goal" : ""}`} style={{ height }}>
      <div className={`pb-fill ${met && on ? "pb-met" : ""} ${grade && isLow(v) ? "grade-low grade-low-bar" : ""}`} style={{ width: on ? `${v}%` : 0, background: c, color: c }} />
      {grade && <span className="pb-goal" style={{ left: `${goal}%` }} aria-hidden><span className="pb-flag">{goal}% GOAL</span></span>}
      {tip && <span className="pb-pop" role="status">{tipText}</span>}
    </div>
    {grade && message && <p className="pb-msg" style={{ color: met ? "#4ade80" : c }}>{met && <span aria-hidden>✓ </span>}{kidMsg(v, goal)}</p>}
  </div>;
}
