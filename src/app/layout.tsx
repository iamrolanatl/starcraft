import type { Metadata, Viewport } from "next";
import "./globals.css";
import { UpdateWatcher } from "@/components/ui/Guard";
// Pre-React guard: a stale chunk referenced by cached HTML triggers one guarded reload.
const CHUNK_GUARD = `addEventListener('error',function(e){var m=String((e&&e.message)||'');if(/ChunkLoadError|Loading (CSS )?chunk [\\w-]+ failed|Failed to fetch dynamically imported module/.test(m)){var k='crystal-chunk-reload',t=+sessionStorage.getItem(k)||0;if(Date.now()-t>120000){sessionStorage.setItem(k,Date.now());location.reload()}}},true);`;

export const metadata: Metadata = {
  title: "Crystal — Your Cockpit for the Day",
  description: "Crystal is a personal productivity and task command center with an AI co-pilot.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Crystal", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#060b1a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><head><script dangerouslySetInnerHTML={{ __html: CHUNK_GUARD }} /></head><body>{children}<UpdateWatcher /><script dangerouslySetInnerHTML={{ __html: "if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))" }} /></body></html>);
}
