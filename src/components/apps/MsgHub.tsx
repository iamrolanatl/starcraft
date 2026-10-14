"use client";
import type { Message } from "@/lib/education";
// Every URL checked 2026-10-14. ParentVUE has no verifiable deep link to the message center, so it opens the portal root.
const LINKS = [
  { name: "CTLS Parent", sub: "Teacher & school messages", url: "https://ctlsparent.cobbk12.org", icon: "✉" },
  { name: "ParentVUE", sub: "Synergy messages (Cobb)", url: "https://parentvue.cobbk12.org/", icon: "◈" },
  { name: "Outlook", sub: "Eli's Office 365 mail", url: "https://outlook.office.com/mail/", icon: "◉" },
  { name: "Teams", sub: "Eli's Teams chat", url: "https://teams.microsoft.com/", icon: "⬡" },
];
const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
export default function MsgHub({ messages }: { messages: Message[] }) {
  const pv = messages.filter(m => /parentvue|synergy|pxp/i.test(m.source)).slice(0, 8);
  const unread = pv.filter(m => m.unread).length;
  return (<div className="space-y-3">
    <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{LINKS.map(l => <li key={l.name}>
      <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex h-full flex-col gap-0.5 rounded-lg border border-cyan/15 bg-navy-2/60 px-2 py-2 hover:border-cyan/50 focus-visible:outline focus-visible:outline-cyan">
        <span className="flex items-center gap-1.5 text-snow"><span aria-hidden className="text-cyan">{l.icon}</span>{l.name}{l.name === "ParentVUE" && unread ? <span className="ml-auto rounded-full bg-alert/40 px-1.5 text-[10px]">{unread}</span> : <span className="ml-auto text-[10px] text-ash">↗</span>}</span>
        <span className="text-[10px] leading-tight text-ash">{l.sub}</span></a></li>)}</ul>
    <div><div className="hud-label mb-1">Latest ParentVUE messages{unread ? <span className="ml-1 rounded-full bg-alert/30 px-1.5 text-[10px] text-snow">{unread} unread</span> : null}</div>
      <ul className="space-y-1">{pv.map(m => <li key={m.ext_id} className="flex items-center gap-2 rounded-lg bg-navy-2/50 px-2 py-1">
        {m.unread && <span aria-label="unread" className="h-2 w-2 shrink-0 rounded-full bg-cyan shadow-[0_0_6px_#4ff]" />}
        <span className={`min-w-0 flex-1 truncate ${m.unread ? "font-semibold text-snow" : "text-ice"}`}>{m.subject || "(no subject)"}<span className="block truncate text-[10px] font-normal text-ash">{m.sender}</span></span>
        <span className="shrink-0 text-[10px] text-slate">{fmt(m.sent_at)}</span></li>)}
        {!pv.length && <li className="text-xs text-ash">No ParentVUE messages in the latest pull.</li>}</ul></div>
  </div>);
}
