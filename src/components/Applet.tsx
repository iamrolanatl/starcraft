"use client";
export default function Applet({ title, icon, onMin, onClose, children, focused, onFocus }: { title: string; icon: string; onMin: () => void; onClose: () => void; children: React.ReactNode; focused: boolean; onFocus: () => void }) {
  return (
    <section onMouseDown={onFocus} aria-label={`${title} applet`} className={`glass flex max-h-[calc(100dvh-230px)] min-h-[200px] flex-col overflow-hidden rounded-2xl transition ${focused ? "neon-border" : ""}`}>
      <header className="flex items-center justify-between border-b border-cyan/15 bg-navy-2/50 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-snow"><span className="text-cyan">{icon}</span>{title}</h2>
        <div className="flex gap-1">
          <button onClick={onMin} aria-label={`Minimize ${title}`} className="h-6 w-6 rounded text-ash hover:bg-cyan/10 hover:text-cyan">–</button>
          <button onClick={onClose} aria-label={`Close ${title}`} className="h-6 w-6 rounded text-ash hover:bg-alert/20 hover:text-alert">✕</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}
