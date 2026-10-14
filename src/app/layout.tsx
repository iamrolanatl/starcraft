import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crystal — Your Cockpit for the Day",
  description: "Crystal is a personal productivity and task command center with an AI co-pilot.",
};
export const viewport: Viewport = { themeColor: "#060b1a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
