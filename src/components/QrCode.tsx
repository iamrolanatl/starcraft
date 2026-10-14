"use client";
import { useMemo } from "react"; import qrcode from "@/lib/vendor/qrcode";
/** Local QR (no third-party service sees the invite code). */
export default function QrCode({ text, size = 168, label }: { text: string; size?: number; label: string }) {
  const svg = useMemo(() => { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }, [text]);
  return <div role="img" aria-label={label} className="rounded-xl bg-white p-2" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
