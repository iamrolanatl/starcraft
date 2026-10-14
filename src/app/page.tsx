import SpaceBackground from "@/components/SpaceBackground";
import AuthPanel from "@/components/AuthPanel";
import SalesChat from "@/components/SalesChat";
import Footer from "@/components/Footer";
import CrystalBot from "@/components/CrystalBot";

const FEATURES = [
  ["◎", "Top Priorities", "Crystal surfaces the three things that matter most today, so you launch with a flight plan."],
  ["✓", "Natural-language tasks", "Type \"remind me Friday to pay the water bill\" and it's filed, dated and on your calendar."],
  ["☁", "Live weather", "Local forecast in your cockpit before you head out."],
  ["▦", "Calendar view", "Every due date on a clean month grid, from any device."],
  ["🤖", "AI co-pilot", "Crystal chats, plans and nudges, powered by Cloudflare Workers AI at the edge."],
  ["⌁", "Command HUD", "Pilot view, 360 + tactical radar, 3×3 ability grid with cooldowns, squad status, tactical and comm feeds, Red Alert."],
  ["📷", "OCR scanner", "Snap a receipt, flyer or handout; Crystal reads it on-device and turns it into tasks or list items."],
];
const MODULES: [string, string, string][] = [
  ["♥", "Health", "Steps, glucose trends and medication check-offs."],
  ["✉", "Communications", "Mail, email and Drive follow-ups in one queue."],
  ["🎓", "Education", "Grades, assignments, check-ins with handouts, school calendar and live bell schedule."],
  ["$", "Finance", "Bills with due-date radar, credit score tracking, live stock quotes."],
  ["🛒", "Shopping", "Shopping list and wish list, filled by voice-style commands."],
];

export default function Landing() {
  return (<>
    <SpaceBackground />
    <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
      <a href="/" className="neon text-lg font-bold tracking-[.3em]">◆ CRYSTAL</a>
      <nav className="flex gap-3 text-sm"><a href="#features" className="hidden text-ash hover:text-cyan sm:inline">Features</a><a href="#launch" className="btn btn-ghost py-1.5 text-sm">Log in</a></nav>
    </header>
    <main className="relative z-10">
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-[1.2fr_1fr] lg:pt-16">
        <div>
          <div className="hud-label mb-3">{"// systems online · pilot required"}</div>
          <h1 className="text-4xl font-bold leading-tight text-snow sm:text-6xl">Take command<br /><span className="neon">of your day.</span></h1>
          <p className="mt-5 max-w-xl text-lg text-ash">Crystal is your personal productivity cockpit: tasks, priorities, weather and calendar in one sleek command center, with a cheerful AI co-pilot riding shotgun.</p>
          <div className="mt-8 flex flex-wrap gap-3"><a href="#launch" className="btn btn-primary">Launch your cockpit</a><a href="#features" className="btn btn-ghost">See the systems</a></div>
          <p className="mt-4 text-xs text-slate">Free preview · Google or email sign-in · Works on phone and desktop</p>
        </div>
        <div className="flex justify-center"><div className="glass relative rounded-3xl p-8"><CrystalBot size={180} mood="wave" label="Crystal the robot" /><p className="mt-2 text-center text-sm text-ice">&ldquo;Hi pilot! I&apos;m Crystal.&rdquo;</p></div></div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-12">
        <div className="hud-label mb-2">Ship systems</div>
        <h2 className="mb-8 text-3xl font-semibold text-snow">Everything you need on one dashboard</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([i, t, d]) => (
            <div key={t} className="glass rounded-2xl p-5 transition hover:-translate-y-1 hover:border-cyan/50">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-cyan/10 text-xl text-cyan neon-border">{i}</div>
              <h3 className="font-semibold text-snow">{t}</h3><p className="mt-1 text-sm text-ash">{d}</p>
            </div>
          ))}
        </div>
        <div className="hud-label mb-2 mt-10">Modules online</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{MODULES.map(([i, t, d]) => (
          <div key={t} className="glass rounded-2xl p-4"><div className="text-xl text-cyan">{i}</div><h3 className="font-semibold text-snow">{t}</h3><p className="mt-1 text-xs text-ash">{d}</p></div>))}
        </div>
      </section>

      <section id="launch" className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2">
        <div>
          <div className="hud-label mb-2">Pre-flight</div>
          <h2 className="text-3xl font-semibold text-snow">Your cockpit is ready.</h2>
          <ul className="mt-5 space-y-2 text-ash">
            <li>▸ Private by design: row-level security keeps your data yours.</li>
            <li>▸ No passwords: sign in with Google or a one-time email code.</li>
            <li>▸ We never sell your data.</li>
          </ul>
        </div>
        <div className="flex justify-center lg:justify-end"><AuthPanel /></div>
      </section>
    </main>
    <Footer />
    <SalesChat />
  </>);
}
