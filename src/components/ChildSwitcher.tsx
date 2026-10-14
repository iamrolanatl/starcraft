"use client";
// Avatar chips in the Education / School Hub header. Filters school data by child_id (migration 017). Hidden until 017 exists.
import { useEffect, useState } from "react";
import { listChildren, selectedChild, selectChild, touchViewer, getAccess, type Child } from "@/lib/family"; import { isDemo } from "@/lib/store";
export default function ChildSwitcher() {
  const [kids, setKids] = useState<Child[]>([]); const [cur, setCur] = useState(selectedChild());
  useEffect(() => { if (isDemo()) return; let live = true;
    listChildren().then(k => { if (!live) return; setKids(k); const s = selectedChild();
      if (k.length && !k.some(c => c.id === s)) { selectChild(k[0].id); setCur(k[0].id); } else if (!k.length && s) { selectChild(""); setCur(""); } }).catch(() => {});
    const on = () => setCur(selectedChild()); addEventListener("crystal-child", on); return () => { live = false; removeEventListener("crystal-child", on); }; }, []);
  useEffect(() => { if (cur && getAccess()?.viewing.some(v => v.child_id === cur)) touchViewer(cur); }, [cur]);
  if (kids.length < 2) return null;
  return <div role="radiogroup" aria-label="Choose a child" className="mb-2 flex flex-wrap gap-2">{kids.map(c =>
    <button key={c.id} role="radio" aria-checked={cur === c.id} onClick={() => { selectChild(c.id); setCur(c.id); }}
      className={`tap flex items-center gap-2 rounded-full border px-2 py-1 pr-3 text-sm font-semibold uppercase tracking-[.04em] ${cur === c.id ? "border-cyan bg-cyan/15 text-snow" : "border-cyan/20 text-ash hover:text-snow"}`}>
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full text-navy" style={{ background: c.avatar_color }}>{c.first_name[0]}</span>{c.first_name}</button>)}</div>;
}
