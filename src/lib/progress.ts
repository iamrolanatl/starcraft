const n1 = (v: number) => String(Math.round(v * 10) / 10);
/** Kid-friendly encouragement for a grade bar (goal 90). */
export function kidMsg(v: number, goal = 90): string {
  if (v >= goal) return `You hit your ${goal}% goal! Keep it up!`;
  const gap = Math.round((goal - v) * 10) / 10; return `Your grade is ${n1(v)}. You're only ${n1(gap)} ${gap === 1 ? "point" : "points"} from ${goal}!`;
}
export function gapText(v: number, goal = 90): string { return v >= goal ? "GOAL MET ✓" : `${n1(goal - v)} pts to ${goal}%`; }
