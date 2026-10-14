import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crystal — Your Cockpit for the Day",
  description: "Crystal is a personal productivity and task command center with an AI co-pilot.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Crystal", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#060b1a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}<script dangerouslySetInnerHTML={{ __html: "if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))" }} /></body></html>);
}
