"use client";
import { useEffect, useRef, useState } from "react";
import { sfx } from "@/lib/synth";
// OCR runs fully in the browser with Tesseract.js (loaded from jsDelivr on first use); images never leave the device.
type TW = { recognize: (img: File | string, lang: string, opts?: { logger?: (m: { status: string; progress: number }) => void }) => Promise<{ data: { text: string } }> };
declare global { interface Window { Tesseract?: TW } }
let loading: Promise<TW> | null = null;
function loadTesseract(): Promise<TW> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return loading ??= new Promise((res, rej) => { const to = setTimeout(() => { loading = null; rej(new Error("OCR engine took too long to load. Check your connection and retry.")); }, 30000); const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; s.crossOrigin = "anonymous"; s.onload = () => { clearTimeout(to); if (window.Tesseract) res(window.Tesseract); else { loading = null; rej(new Error("OCR engine missing")); } }; s.onerror = () => { clearTimeout(to); loading = null; s.remove(); rej(new Error("OCR engine failed to load (offline or blocked). Retry when online.")); }; document.head.appendChild(s); });
}
export const OCR_MAX_BYTES = 15 * 1024 * 1024; const OCR_MAX_PX = 2000;
export const OCR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
export function checkImage(f: File): string | null {
  if (!OCR_TYPES.includes(f.type)) return `Unsupported file type (${f.type || "unknown"}). Use PNG, JPEG, WebP, GIF or BMP.`;
  if (f.size > OCR_MAX_BYTES) return `Image is ${(f.size / 1048576).toFixed(1)} MB. The limit is 15 MB.`;
  return null;
}
/** Downscale to ≤2000px on the long edge so huge phone photos don't exhaust memory. */
async function shrink(f: File): Promise<Blob | File> {
  try {
    const bmp = await createImageBitmap(f); const k = Math.min(1, OCR_MAX_PX / Math.max(bmp.width, bmp.height));
    if (k >= 1) { bmp.close(); return f; }
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    const b = await new Promise<Blob | null>(r => c.toBlob(r, "image/png")); c.width = c.height = 0; return b ?? f;
  } catch { return f; }
}
export async function ocrImage(file: File, onProgress?: (p: number, s: string) => void): Promise<string> {
  const bad = checkImage(file); if (bad) throw new Error(bad);
  const [T, img] = await Promise.all([loadTesseract(), shrink(file)]);
  const url = URL.createObjectURL(img);
  try { const r = await T.recognize(url, "eng", { logger: m => onProgress?.(m?.progress ?? 0, m?.status ?? "") }); return String(r?.data?.text ?? "").trim(); }
  finally { URL.revokeObjectURL(url); }
}
export default function Ocr({ onCommand, log }: { onCommand: (text: string) => Promise<void>; log: (s: string, t?: "info" | "ok" | "warn") => void }) {
  const [text, setText] = useState(""); const [prog, setProg] = useState<string>(""); const [preview, setPreview] = useState("");
  const alive = useRef(true); const busy = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]); // free previous preview blob
  const run = async (f?: File | null) => {
    if (!f || busy.current) return; const bad = checkImage(f); if (bad) { log(bad, "warn"); sfx("error"); return; }
    busy.current = true; setPreview(URL.createObjectURL(f)); setText(""); sfx("ping");
    try { const t = await ocrImage(f, (p, s) => setProg(`${s} ${Math.round(p * 100)}%`)); if (!alive.current) return; setText(t); setProg(""); log(`OCR: read ${t.split(/\s+/).filter(Boolean).length} words`, "ok"); sfx("success"); }
    catch (e) { if (alive.current) { setProg(""); log(`OCR failed: ${(e as Error).message}`, "warn"); sfx("error"); } }
    finally { busy.current = false; }
  };
  const lines = text.split("\n").map(s => s.trim()).filter(s => s.length > 2);
  return (<div className="space-y-2">
    <label className="block cursor-pointer rounded-lg border border-dashed border-cyan/40 p-3 text-center text-sm text-ash hover:border-cyan hover:text-cyan"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); run(e.dataTransfer.files?.[0]); }}>
      📷 Scan a photo, receipt, flyer or handout (tap or drop)
      <input type="file" accept={OCR_TYPES.join(",")} capture="environment" className="sr-only" onChange={e => run(e.target.files?.[0])} aria-label="Image to scan" />
    </label>
    {prog && <p className="font-mono text-xs text-cyan" role="status">{prog}</p>}
    { }{preview && <img src={preview} alt="Scanned image" className="max-h-28 rounded border border-cyan/20" />}
    {text && (<>
      <textarea className="input font-mono text-xs" rows={5} value={text} onChange={e => setText(e.target.value)} aria-label="Recognized text" />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary text-xs" onClick={() => onCommand(`task: ${lines[0] || text.slice(0, 120)}`)}>Make Task</button>
        <button className="btn btn-ghost text-xs" onClick={async () => { for (const l of lines.slice(0, 15)) await onCommand(`add ${l} to shopping list`); }}>Lines → Shopping List</button>
        <button className="btn btn-ghost text-xs" onClick={() => onCommand(text.split("\n").find(l => l.trim()) || text)}>Run as Command</button>
        <button className="btn btn-ghost text-xs" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
      </div>
    </>)}
    <p className="text-[10px] text-slate">On-device OCR (Tesseract.js). Images are not uploaded. Max 15 MB.</p>
  </div>);
}
