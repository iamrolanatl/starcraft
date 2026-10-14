import { LEGAL } from "@/lib/legal";
export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-cyan/15 bg-navy/70 px-6 py-8 text-sm text-ash backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <a href="/" className="neon font-semibold tracking-widest">◆ CRYSTAL</a>
        <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          {LEGAL.map(l => <a key={l.slug} href={`/legal/${l.slug}/`} className="hover:text-cyan">{l.short}</a>)}
        </nav>
        <span className="text-xs text-slate">© {new Date().getFullYear()} Crystal · Proof of concept</span>
      </div>
    </footer>
  );
}
