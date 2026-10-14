"use client";
import { useState } from "react";
import { sfx } from "@/lib/synth";
// OCR runs fully in the browser with Tesseract.js (loaded from jsDelivr on first use); images never leave the device.
type TW = { recognize: (img: File | string, lang: string, opts?: { logger?: (m: { status: string; progress: number }) => void }) => Promise<{ data: { text: string } }> };
declare global { interface Window { Tesseract?: TW } }
let loading: Promise<TW> | null = null;
function loadTesseract(): Promise<TW> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return loading ??= new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"; s.crossOrigin = "anonymous"; s.onload = () => window.Tesseract ? res(window.Tesseract) : rej(new Error("OCR engine missing")); s.onerror = () => { loading = null; rej(new Error("OCR engine failed to load")); }; document.head.appendChild(s); });
}
export async function ocrImage(file: File, onProgress?: (p: number, s: string) => void): Promise<string> {
  const T = await loadTesseract();
  const r = await T.recognize(file, "eng", { logger: m => onProgress?.(m.progress, m.status) });
  return r.data.text.trim();
}
export default function Ocr({ onCommand, log }: { onCommand: (text: string) => Promise<void>; log: (s: string, t?: "info" | "ok" | "warn") => void }) {
  const [text, setText] = useState(""); const [prog, setProg] = useState<string>(""); const [preview, setPreview] = useState("");
  const run = async (f?: File | null) => {
    if (!f) return; setPreview(URL.createObjectURL(f)); setText(""); sfx("ping");
    try { const t = await ocrImage(f, (p, s) => setProg(`${s} ${Math.round(p * 100)}%`)); setText(t); setProg(""); log(`OCR: read ${t.split(/\s+/).filter(Boolean).length} words`, "ok"); sfx("success"); }
    catch (e) { setProg(""); log(`OCR failed: ${(e as Error).message}`, "warn"); sfx("error"); }
  };
  const lines = text.split("\n").map(s => s.trim()).filter(s => s.length > 2);
  return (<div className="space-y-2">
    <label className="block cursor-pointer rounded-lg border border-dashed border-cyan/40 p-3 text-center text-sm text-ash hover:border-cyan hover:text-cyan"
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); run(e.dataTransfer.files?.[0]); }}>
      📷 Scan a photo, receipt, flyer or handout (tap or drop)
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={e => run(e.target.files?.[0])} aria-label="Image to scan" />
    </label>
    {prog && <p className="font-mono text-xs text-cyan" role="status">{prog}</p>}
    {preview && <img src={preview} alt="Scanned image" className="max-h-28 rounded border border-cyan/20" />}
    {text && (<>
      <textarea className="input font-mono text-xs" rows={5} value={text} onChange={e => setText(e.target.value)} aria-label="Recognized text" />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary text-xs" onClick={() => onCommand(`task: ${lines[0] || text.slice(0, 120)}`)}>Make task</button>
        <button className="btn btn-ghost text-xs" onClick={async () => { for (const l of lines.slice(0, 15)) await onCommand(`add ${l} to shopping list`); }}>Lines → shopping list</button>
        <button className="btn btn-ghost text-xs" onClick={() => onCommand(text.split("\n").find(l => l.trim()) || text)}>Run as command</button>
        <button className="btn btn-ghost text-xs" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
      </div>
    </>)}
    <p className="text-[10px] text-slate">On-device OCR (Tesseract.js). Images are not uploaded.</p>
  </div>);
}
