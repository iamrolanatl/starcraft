"use client";
// Voice input. Web Speech API where supported; otherwise record in memory → /api/transcribe (Workers AI Whisper).
// Nothing is stored: audio chunks live only in memory until transcribed, then are dropped.
type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const SRC = (): (new () => SR) | null => typeof window === "undefined" ? null : ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition ?? null);
export const hasWebSpeech = () => !!SRC();
export const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
export const voiceSupported = () => hasWebSpeech() || canRecord();
export interface Listen { stop(): void }
export interface Handlers { onPartial(t: string): void; onFinal(t: string): void; onError(msg: string): void; onEnd(): void }
const friendly = (e: string) => /not-allowed|denied|NotAllowed|Permission/i.test(e) ? "Microphone access is blocked. Allow the mic in your browser's site settings, or type your command." : /no-speech/.test(e) ? "I didn't hear anything. Try again." : /audio-capture|NotFound/i.test(e) ? "No microphone found." : /network/.test(e) ? "Speech service unreachable. Check your connection." : `Voice error: ${e}`;
/** Push-to-talk: one utterance. */
export function listenOnce(h: Handlers, maxMs = 15000): Listen {
  const C = SRC();
  if (C) {
    const r = new C(); r.lang = "en-US"; r.interimResults = true; r.continuous = false; let done = false, last = "";
    r.onresult = e => { let txt = "", fin = false; for (let i = 0; i < e.results.length; i++) { txt += e.results[i][0].transcript; fin = e.results[i].isFinal; } last = txt; if (fin) { done = true; h.onFinal(txt.trim()); } else h.onPartial(txt); };
    r.onerror = e => { if (e.error !== "aborted") h.onError(friendly(e.error)); done = true; };
    r.onend = () => { if (!done && last) h.onFinal(last.trim()); h.onEnd(); };
    const t = setTimeout(() => r.stop(), maxMs);
    try { r.start(); } catch (e) { h.onError(friendly(String(e))); h.onEnd(); }
    return { stop: () => { clearTimeout(t); try { r.stop(); } catch {} } };
  }
  return recordWhisper(h, maxMs);
}
function recordWhisper(h: Handlers, maxMs: number): Listen {
  if (!canRecord()) { h.onError("Voice input isn't supported in this browser. Type your command instead."); h.onEnd(); return { stop() {} }; }
  let stream: MediaStream | null = null, rec: MediaRecorder | null = null, stopped = false; let chunks: Blob[] = []; let t: ReturnType<typeof setTimeout> | undefined;
  const release = () => { clearTimeout(t); stream?.getTracks().forEach(x => x.stop()); stream = null; };
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(s => {
    stream = s; if (stopped) { release(); h.onEnd(); return; }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find(m => MediaRecorder.isTypeSupported?.(m)) ?? "";
    rec = new MediaRecorder(s, type ? { mimeType: type } : undefined); h.onPartial("Listening… (tap again to send)");
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      release(); const blob = new Blob(chunks, { type: rec?.mimeType || "audio/webm" }); chunks = [];
      if (blob.size < 800) { h.onError("I didn't hear anything. Try again."); h.onEnd(); return; }
      h.onPartial("Transcribing…");
      try { const text = await transcribe(blob); if (text) h.onFinal(text); else h.onError("I couldn't make that out. Try again."); }
      catch (e) { h.onError((e as Error).message); } finally { h.onEnd(); }
    };
    rec.start(); t = setTimeout(() => rec?.state === "recording" && rec.stop(), maxMs);
  }).catch(e => { h.onError(friendly(String((e as Error)?.name || e))); h.onEnd(); });
  return { stop: () => { stopped = true; if (rec?.state === "recording") rec.stop(); else if (!rec) release(); } };
}
export async function transcribe(blob: Blob): Promise<string> {
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": blob.type.split(";")[0] || "audio/webm" }, body: blob, signal: ac.signal });
    const j = await r.json().catch(() => ({})) as { text?: string; error?: string };
    if (r.status === 429) throw new Error("Easy there, pilot! Voice rate limit hit. Try again in a minute.");
    if (!r.ok) throw new Error(j.error || `Transcription failed (${r.status})`); return (j.text || "").trim();
  } catch (e) { if ((e as Error).name === "AbortError") throw new Error("Transcription timed out."); throw e; } finally { clearTimeout(to); }
}
/** Hands-free "Hey Crystal": continuous Web Speech listening; fires onCommand with the text after the wake phrase. */
export function wakeWord(onCommand: (t: string) => void, onCaption: (t: string) => void, onError: (m: string) => void): Listen | null {
  const C = SRC(); if (!C) return null; let on = true; let r: SR | null = null; let fails = 0;
  const WAKE = /\b(hey|hi|okay|ok)[,\s]+(crystal|kristal|cristal|crystle)\b[,.!]?\s*/i;
  const start = () => {
    if (!on) return; r = new C(); r.lang = "en-US"; r.continuous = true; r.interimResults = true;
    r.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) { const tx = e.results[i][0].transcript; const m = tx.match(WAKE);
      if (m) { const cmd = tx.slice((m.index ?? 0) + m[0].length).trim(); onCaption(cmd || "Listening…"); if (e.results[i].isFinal && cmd) onCommand(cmd); } } };
    r.onerror = e => { if (/not-allowed|service-not-allowed/.test(e.error)) { on = false; onError(friendly(e.error)); } else fails++; };
    r.onend = () => { if (on && fails < 20) setTimeout(start, 400); };
    try { r.start(); } catch { /* already started */ }
  };
  start(); return { stop: () => { on = false; try { r?.abort(); } catch {} } };
}
