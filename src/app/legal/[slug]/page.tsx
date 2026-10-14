import { notFound } from "next/navigation";
import { LEGAL } from "@/lib/legal";
import Footer from "@/components/Footer";
import SpaceBackground from "@/components/SpaceBackground";
export const dynamicParams = false;
export function generateStaticParams() { return LEGAL.map(l => ({ slug: l.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; return { title: `${LEGAL.find(l => l.slug === slug)?.title ?? "Legal"} · Crystal` }; }
export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const doc = LEGAL.find(l => l.slug === slug); if (!doc) notFound();
  return (<>
    <SpaceBackground dim={0.6} />
    <main className="mx-auto max-w-3xl px-5 py-10">
      <a href="/" className="btn btn-ghost mb-6 text-sm">← Home</a>
      <article className="glass rounded-2xl p-6 sm:p-10">
        <div className="mb-4 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-xs text-amber-200">DRAFT — template text for the Crystal proof of concept. Not yet reviewed by counsel.</div>
        <h1 className="neon mb-1 text-3xl font-bold">{doc.title}</h1>
        <p className="mb-8 text-xs text-slate">Last updated: October 14, 2026</p>
        {doc.sections.map(([h, p], i) => (<section key={h} className="mb-6"><h2 className="mb-2 text-lg font-semibold text-snow">{i + 1}. {h}</h2><p className="leading-relaxed text-ash">{p}</p></section>))}
      </article>
    </main>
    <Footer />
  </>);
}
