"use client";
// True hands-free loop: listen → transcribe → chat → speak reply → listen again. No wake word.
// Mic is paused while Crystal speaks so she never hears herself. Saying "stop" (or tapping Stop) ends the loop.
// Chrome/Edge/Safari desktop: Web Speech. iPhone (incl. Home-Screen app) / Firefox: mic + silence detection → /api/transcribe (Whisper).
import { hasWebSpeech, canRecord, transcribe } from "./voice";
import { speechDone, stopSpeech } from "./synth";
export type HFState = { kind: "off" | "starting" | "listening" | "heard" | "thinking" | "speaking" | "error"; text?: string; hint?: string };
type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; abort(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const SRC = () => { const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }; return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null; };
const STOP = /^\W*(stop|stop listening|cancel|turn off|hands[- ]?free off|that's all|goodbye)\W*$/i;
// Whisper hallucinates these on silence/noise — ignore them.
const JUNK = /^\W*(thank you( so much)?( for watching)?!?|thanks for watching!?|you|bye\.?|\.+|)\W*$/i;
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export function hint(err: string): string {
  if (/not-allowed|NotAllowed|denied|Permission|service-not-allowed/i.test(err)) return isIOS() ? "Allow the mic: iPhone Settings › Safari › Microphone › Allow (or aA › Website Settings › Microphone), then turn Hands-Free on again." : "Allow the mic: click the 🔒/tune icon left of the address bar › Microphone › Allow, then turn Hands-Free on again.";
  if (/NotFound|audio-capture/i.test(err)) return "No microphone found. Plug one in or check Sound settings.";
  if (/network|unreachable|Failed to fetch|timed out/i.test(err)) return "Speech service unreachable. Check your connection; I'll keep trying.";
  if (/NotReadable|in use/i.test(err)) return "Another app is using the mic. Close it and try again.";
  if (/rate limit/i.test(err)) return "Too many requests. Wait a minute.";
  if (/insecure|https/i.test(err)) return "Voice needs https:// — open crystal-7ot.pages.dev.";
  return "Tap Hands-Free off and on again, or use the keyboard.";
}
export function handsFreeSupported() { return hasWebSpeech() || canRecord(); }
export type HFOpts = { onDiag?: (m: string) => void; heardSound?: () => boolean; preferRecord?: boolean; onEngine?: (e: "web-speech" | "recording") => void };
export function startHandsFree(onText: (t: string) => Promise<void>, setState: (s: HFState) => void, onDead?: () => void, o: HFOpts = {}): { stop(): void } {
  const diag = (m: string) => { try { o.onDiag?.(m); } catch {} }; let empty = 0;
  let user = false; let on = true, rec: SR | null = null, stream: MediaStream | null = null, ctx: AudioContext | null = null, mr: MediaRecorder | null = null, errs = 0;
  const err = (e: string) => { errs++; setState({ kind: "error", text: e.startsWith("Voice") ? e : `Voice error: ${e}`, hint: hint(e) }); };
  const fatal = (e: string) => /not-allowed|NotAllowed|denied|Permission|NotFound|audio-capture|insecure/i.test(e);
  const end = () => { on = false; try { rec?.abort(); } catch {} try { if (mr?.state === "recording") mr.stop(); } catch {} stream?.getTracks().forEach(t => t.stop()); void ctx?.close().catch(() => {}); stream = null; ctx = null; if (!user) onDead?.(); };
  const handle = async (t: string) => {
    t = t.trim(); if (!t || JUNK.test(t)) return;
    if (STOP.test(t)) { end(); stopSpeech(); setState({ kind: "off", text: "Hands-free off." }); return; }
    setState({ kind: "heard", text: t }); await new Promise(r => setTimeout(r, 300));
    setState({ kind: "thinking", text: t });
    try { await onText(t); } catch (e) { err(String((e as Error)?.message || e)); await new Promise(r => setTimeout(r, 1500)); }
    if (!on) return; setState({ kind: "speaking" }); await speechDone();
  };
  // ---- Web Speech: one utterance per turn (restarted every loop, so it can't die silently) ----
  const webTurn = () => new Promise<string>(res => {
    const C = SRC()!; const r = new C(); rec = r; r.lang = "en-US"; r.interimResults = true; r.continuous = false; let txt = "", fin = "", e0 = "";
    r.onresult = e => { txt = ""; for (let i = 0; i < e.results.length; i++) { txt += e.results[i][0].transcript; if (e.results[i].isFinal) fin = txt; } setState({ kind: "listening", text: txt }); };
    let loud = false; const poll = setInterval(() => { if (o.heardSound?.()) loud = true; }, 100);
    (r as unknown as { onaudiostart: () => void }).onaudiostart = () => diag("recognizer: audio started");
    (r as unknown as { onspeechstart: () => void }).onspeechstart = () => diag("recognizer: speech detected");
    r.onerror = e => { diag(`recognizer error: ${e.error}`); if (e.error !== "no-speech" && e.error !== "aborted") e0 = e.error; };
    r.onend = () => { clearInterval(poll); rec = null; const t = (fin || txt).trim();
      // Web Speech heard nothing although the mic picked up sound (or it errored with network/aborted): switch to recording + server transcription.
      // Recognizer-only failures (network, audio-capture, service, language) while getUserMedia works: switch engines instead of giving up.
      if (e0 && !/not-allowed/.test(e0) && canRecord()) { useWeb = false; o.onEngine?.("recording"); diag(`switched to recording mode after "${e0}"`); e0 = ""; res(""); return; }
      if (!t && (loud || /aborted/.test(e0))) { empty++; if (empty >= 2) { useWeb = false; o.onEngine?.("recording"); diag("switched to recording mode (server transcription)"); e0 = ""; } }
      else if (t) empty = 0;
      if (e0) { if (fatal(e0)) { end(); } err(e0); res(""); } else res(t); };
    try { r.start(); setState({ kind: "listening" }); diag("recognizer: started"); } catch (e) { clearInterval(poll); diag(`recognizer start failed: ${String(e)}`); useWeb = false; o.onEngine?.("recording"); res(""); }
  });
  // ---- Whisper fallback: keep mic open, record until ~1.1 s of silence after speech ----
  const recTurn = async (): Promise<string> => {
    if (!stream) { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); ctx = new AudioContext(); }
    if (ctx!.state === "suspended") await ctx!.resume().catch(() => {});
    const an = ctx!.createAnalyser(); an.fftSize = 1024; const src = ctx!.createMediaStreamSource(stream); src.connect(an); const buf = new Float32Array(an.fftSize);
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find(m => MediaRecorder.isTypeSupported?.(m)) ?? "";
    const m = new MediaRecorder(stream, type ? { mimeType: type } : undefined); mr = m; const chunks: Blob[] = [];
    m.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise<void>(r => { m.onstop = () => r(); }); m.start(250); setState({ kind: "listening" });
    let noise = 0.01, speech = false, lastLoud = 0; const t0 = performance.now();
    while (on && m.state === "recording") {
      await new Promise(r => setTimeout(r, 60)); an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; const rms = Math.sqrt(s / buf.length); const now = performance.now();
      if (!speech && now - t0 < 600) { noise = Math.max(noise, rms * 1.2); continue; }
      if (rms > Math.max(0.02, noise * 2.2)) { if (!speech) setState({ kind: "listening", text: "…" }); speech = true; lastLoud = now; }
      if (speech && now - lastLoud > 1100) break; if (now - t0 > (speech ? 20000 : 12000)) break;
    }
    src.disconnect(); if (m.state === "recording") m.stop(); await stopped; mr = null;
    if (!on || !speech) return "";
    const blob = new Blob(chunks, { type: m.mimeType || "audio/webm" }); if (blob.size < 1500) return "";
    setState({ kind: "thinking", text: "Transcribing…" }); diag(`recorded ${Math.round(blob.size / 1024)} KB, transcribing`); const tx = await transcribe(blob); diag(tx ? `transcribed: "${tx.slice(0, 60)}"` : "transcription empty"); return tx;
  };
  let useWeb = !o.preferRecord && hasWebSpeech() && !(isIOS() && (navigator as Navigator & { standalone?: boolean }).standalone); // iOS Home-Screen apps have no Web Speech
  (async () => {
    setState({ kind: "starting" }); o.onEngine?.(useWeb ? "web-speech" : "recording");
    if (!window.isSecureContext) { err("insecure"); end(); return; }
    while (on) {
      try { const t = useWeb ? await webTurn() : await recTurn(); if (!on) break; if (t) { errs = 0; await handle(t); } }
      catch (e) { const n = String((e as Error)?.name || e) + " " + String((e as Error)?.message || ""); err(n.trim()); if (fatal(n)) { end(); break; } }
      if (errs > 0) await new Promise(r => setTimeout(r, Math.min(8000, 800 * errs)));
      else await new Promise(r => setTimeout(r, 150));
      if (errs > 12) { err("Voice keeps failing"); end(); }
    }
  })();
  return { stop: () => { user = true; end(); stopSpeech(); setState({ kind: "off" }); } };
}
