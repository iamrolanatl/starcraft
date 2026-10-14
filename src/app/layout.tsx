import type { Metadata, Viewport } from "next";
import "./globals.css";
import { UpdateWatcher } from "@/components/ui/Guard";
// Pre-React guard: a stale chunk referenced by cached HTML triggers one guarded reload.
const CHUNK_GUARD = `addEventListener('error',function(e){var m=String((e&&e.message)||'');if(/ChunkLoadError|Loading (CSS )?chunk [\\w-]+ failed|Failed to fetch dynamically imported module/.test(m)){var k='crystal-chunk-reload',t=+sessionStorage.getItem(k)||0;if(Date.now()-t>120000){sessionStorage.setItem(k,Date.now());location.reload()}}},true);`;
import TipLayer from "@/components/ui/Tooltip";
import { Press_Start_2P, Fredoka, Bungee, Baloo_2 } from "next/font/google";
// Skin heading fonts (SIL OFL, self-hosted by next/font). Headings only; body text stays system sans.
const pixel = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap", preload: false });
const play = Fredoka({ subsets: ["latin"], variable: "--font-play", display: "swap", preload: false });
const bold = Bungee({ weight: "400", subsets: ["latin"], variable: "--font-bold", display: "swap", preload: false });
const round = Baloo_2({ subsets: ["latin"], variable: "--font-round", display: "swap", preload: false });
// Applies saved skin / text size / contrast before first paint (no theme flash).
const BOOT = `try{var p=JSON.parse(localStorage.getItem('crystal-uiprefs')||'{}'),s=p.s||{},d=document.documentElement.dataset;d.skin=s.theme||'cockpit';if(s.bgSpeed===0)d.bgpaused='1';if(p.glass)d.glass=p.glass;if(s.textSize)d.textsize=s.textSize;if(s.highContrast)d.contrast='high';if(s.reading)d.reading='on';if(s.video)d.video=s.video;var m=s.uiMotion;if(s.dv!==2&&m==='system')m=0;d.motion=!m?'reduced':m!=='system'?m:(matchMedia('(prefers-reduced-motion: reduce)').matches?'reduced':'full')}catch(e){}`;

export const metadata: Metadata = {
  title: "Crystal — Your Cockpit for the Day",
  description: "Crystal is a personal productivity and task command center with an AI co-pilot.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Crystal", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#060b1a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" data-skin="cockpit" className={`${pixel.variable} ${play.variable} ${bold.variable} ${round.variable}`} suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: CHUNK_GUARD }} /><script dangerouslySetInnerHTML={{ __html: BOOT }} /></head><body>{children}<TipLayer /><UpdateWatcher /><script dangerouslySetInnerHTML={{ __html: "if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))" }} /></body></html>);
}
