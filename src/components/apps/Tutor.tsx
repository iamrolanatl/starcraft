"use client";
// Kids' hands-free tutor: talk → auto-send on pause → Crystal answers aloud. Tap "Stop talking" (or the mic) to barge in.
// Answers come from /api/tutor (Ollama on the laptop, falling back to Workers AI; Grok later). Parents see the log below.
import { useEffect, useRef, useState } from "react";
import { sb } from "@/lib/supabase";
import { isDemo } from "@/lib/store";
import { fetchJSON } from "@/lib/safe";
import { speak, stopSpeech, unlockSpeech } from "@/lib/synth";
import { startHandsFree, handsFreeSupported, hint, type HFState } from "@/lib/handsfree";
import { hasWebSpeech } from "@/lib/voice";
import type { ChatMessage } from "@/contracts/api";

type Resp = { reply: string; provider: string; model: string; fellBack?: string; flagged?: string };
type Turn = ChatMessage & { tag?: string };
type Log = { id: number; owner: string; created_at: string; question: string; answer: string | null; provider: string | null; model: string | null; flagged: string | null };
const LABEL: Record<string, string> = { ollama: "Ollama (laptop)", "workers-ai": "Cloudflare Llama", grok: "Grok", filter: "Safety filter", none: "offline" };
export const modelTag = (r: Resp) => `${LABEL[r.provider] ?? r.provider}${r.model && r.model !== "moderation" && r.model !== "none" ? ` · ${r.model.replace(/^@cf\/meta\//, "")}` : ""}${r.fellBack ? " · fallback" : ""}`;

async function auth(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "content-type": "application/json", "x-supabase-anon": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "" };
  if (isDemo()) return h;
  try { const { data } = await sb().auth.getSession(); if (data.session) h.authorization = `Bearer ${data.session.access_token}`; } catch {}
  return h;
}

export default function Tutor({ name, grade }: { name?: string; grade?: string | null }) {
  const [turns, setTurns] = useState<Turn[]>([]); const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [hf, setHf] = useState<HFState>({ kind: "off" }); const [on, setOn] = useState(false); const [speaking, setSpeaking] = useState(false);
  const [unsupported, setUnsupported] = useState<string | null>(null); const [logs, setLogs] = useState<Log[] | null>(null); const [me, setMe] = useState<string | null>(null);
  const loop = useRef<{ stop(): void } | null>(null); const hist = useRef<Turn[]>([]); const end = useRef<HTMLDivElement>(null);
  const first = (name || "").split(/[\s(]/)[0];
  // ---- diagnostics: mic permission, live level from getUserMedia, recognizer events, engine ----
  const [perm, setPerm] = useState("unknown"); const [level, setLevel] = useState(0); const [engine, setEngine] = useState<string>("-"); const [diag, setDiag] = useState<string[]>([]);
  const [forceRec, setForceRec] = useState(false); const meter = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null); const lvl = useRef(0); const loudAt = useRef(0);
  const note = (m: string) => setDiag(d => [`${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} ${m}`, ...d].slice(0, 10));
  const readPerm = async () => { try { const st = await navigator.permissions?.query({ name: "microphone" as PermissionName }); if (st) { setPerm(st.state); st.onchange = () => setPerm(st.state); } } catch { setPerm("not reported"); } };
  useEffect(() => { void readPerm(); }, []);
  const stopMeter = () => { const m = meter.current; if (!m) return; cancelAnimationFrame(m.raf); m.stream.getTracks().forEach(t => t.stop()); void m.ctx.close().catch(() => {}); meter.current = null; setLevel(0); };
  const startMeter = async (): Promise<boolean> => {
    if (meter.current) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AudioContext(); if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an); const buf = new Float32Array(an.fftSize);
      const tick = () => { an.getFloatTimeDomainData(buf); let q = 0; for (const v of buf) q += v * v; const rms = Math.sqrt(q / buf.length); lvl.current = rms; if (rms > 0.03) loudAt.current = performance.now(); setLevel(Math.min(1, rms * 8)); if (meter.current) meter.current.raf = requestAnimationFrame(tick); };
      meter.current = { stream, ctx, raf: requestAnimationFrame(tick) }; const tr = stream.getAudioTracks()[0]; note(`mic open: ${tr?.label || "default microphone"}${ctx.state !== "running" ? ` (audio ${ctx.state})` : ""}`); void readPerm(); return true;
    } catch (e) { const n = `${(e as Error).name}: ${(e as Error).message}`; note(`mic failed: ${n}`); setHf({ kind: "error", text: "Can't open the microphone.", hint: hint(n) }); void readPerm(); return false; }
  };
  const testSpeaker = () => { unlockSpeech(); const v = typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices().length : 0; note(`speaker test (${v} voices loaded)`); setSpeaking(true); speak(`Hi${first ? ` ${first}` : ""}! This is Crystal. If you can hear me, your speaker works.`, () => { setSpeaking(false); note("speaker test finished"); }); };

  useEffect(() => {
    if (!handsFreeSupported()) setUnsupported("Hands-free voice isn't available in this browser. You can still type below. Try Chrome on a computer or Android, or Safari on iPhone with the microphone allowed.");
    else if (!hasWebSpeech()) setUnsupported("This browser doesn't have built-in speech recognition, so Crystal records a short clip and transcribes it after you pause. It's a little slower but works the same.");
    return () => { loop.current?.stop(); stopSpeech(); stopMeter(); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [turns, hf.text]);
  const loadLogs = async () => { if (isDemo()) { setLogs([]); return; } try { const c = sb(); const u = (await c.auth.getUser()).data.user; setMe(u?.id ?? null); const { data, error } = await c.from("tutor_logs").select("id,owner,created_at,question,answer,provider,model,flagged").order("created_at", { ascending: false }).limit(50); setLogs(error ? null : (data as Log[])); } catch { setLogs(null); } };
  useEffect(() => { void loadLogs(); }, []);

  const ask = async (q: string, voice: boolean) => {
    q = q.trim(); if (!q) return; const next: Turn[] = [...hist.current, { role: "user", content: q }]; hist.current = next; setTurns(next); setBusy(true);
    let r: Resp;
    try { r = await fetchJSON<Resp>("/api/tutor", { method: "POST", headers: await auth(), body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), name: first, grade: grade || "", voice }), timeoutMs: 40000, retries: 0 }); }
    catch { r = { reply: "I couldn't reach my brain just now. Let's try again in a moment.", provider: "none", model: "none" }; }
    const done: Turn[] = [...next, { role: "assistant", content: r.reply, tag: modelTag(r) }]; hist.current = done; setTurns(done); setBusy(false);
    if (voice || on) { setSpeaking(true); speak(r.reply, () => setSpeaking(false)); }
    void loadLogs();
  };
  const toggle = async () => {
    if (on) { loop.current?.stop(); loop.current = null; setOn(false); setSpeaking(false); stopMeter(); note("hands-free off"); return; }
    if (!handsFreeSupported()) { setHf({ kind: "error", text: "Voice isn't supported here.", hint: "Type your question instead." }); return; }
    unlockSpeech(); stopSpeech(); window.dispatchEvent(new Event("crystal:voice-claim")); // free the toolbar's recognizer: only one can run
    if (!(await startMeter())) return; // asks for mic permission inside the tap
    setOn(true);
    loop.current = startHandsFree(t => ask(t, true), s => { setHf(s); if (s.kind === "error") note(s.text || "error"); }, () => { setOn(false); loop.current = null; stopMeter(); },
      { onDiag: note, heardSound: () => performance.now() - loudAt.current < 400, preferRecord: forceRec, onEngine: e => { setEngine(e === "web-speech" ? "Browser speech (Web Speech)" : "Recording + server transcription"); } });
  };
  const bargeIn = () => { stopSpeech(); setSpeaking(false); }; // the hands-free loop resumes listening as soon as speech stops

  const listening = on && hf.kind === "listening"; const state = !on ? "Off" : speaking || hf.kind === "speaking" ? "Speaking… tap Stop to interrupt" : hf.kind === "thinking" || busy ? "Thinking…" : listening ? (hf.text ? `Hearing: “${hf.text}”` : "Listening… just talk") : hf.kind === "error" ? hf.text ?? "Voice error" : "Starting mic…";
  return <div className="space-y-3 text-sm">
    <section className="rounded-xl border border-cyan/25 bg-navy/70 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => void toggle()} aria-pressed={on} aria-label={on ? "Turn hands-free off" : "Turn hands-free on"} className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 text-2xl transition ${on ? "border-cyan bg-cyan/20 text-cyan" : "border-ash/40 bg-navy-2 text-snow"}`}>
          {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full border-2 border-cyan/60 motion-reduce:animate-none" />}
          <span aria-hidden>{on ? "🎙️" : "🎤"}</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-snow">Crystal Tutor {on ? <span className="ml-1 rounded bg-cyan/20 px-1.5 text-[11px] text-cyan">HANDS-FREE ON</span> : null}</p>
          <p role="status" aria-live="polite" className={`text-[13px] ${hf.kind === "error" && on ? "text-alert" : "text-ash"}`}>{state}</p>
          {listening && <div aria-hidden className="mt-1 flex h-3 items-end gap-0.5">{[0, 1, 2, 3, 4].map(i => <span key={i} className="w-1 animate-pulse rounded bg-cyan motion-reduce:animate-none" style={{ height: `${40 + ((i * 37) % 60)}%`, animationDelay: `${i * 120}ms` }} />)}</div>}
          {hf.kind === "error" && hf.hint && on && <p className="text-[12px] text-amber-200">{hf.hint}</p>}
        </div>
        {(speaking || hf.kind === "speaking") && <button onClick={bargeIn} className="btn btn-ghost border-alert px-3 py-2 text-alert">■ Stop talking</button>}
      </div>
      <p className="mt-2 text-[12px] text-ash">Tap the mic and just talk. Crystal sends when you pause, answers out loud, then listens again. Say “stop” to end. Crystal gives hints and asks questions; she won&apos;t do your homework for you.</p>
      {unsupported && <p className="mt-1 text-[12px] text-amber-200">{unsupported}</p>}
    </section>
    <details className="rounded-xl border border-ash/20 bg-navy/60 p-2 text-[12px]" open={hf.kind === "error" || undefined}>
      <summary className="cursor-pointer text-snow">Voice check (if Crystal can&apos;t hear or talk)</summary>
      <div className="mt-2 space-y-1.5">
        <p>Mic permission: <b className={perm === "granted" ? "text-emerald-300" : perm === "denied" ? "text-alert" : "text-amber-200"} data-testid="mic-perm">{perm}</b> · Listening with: <b className="text-snow" data-testid="engine">{engine}</b></p>
        <div className="flex items-center gap-2"><span>Mic level</span><div className="h-2 flex-1 overflow-hidden rounded bg-navy-2" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}><div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} /></div></div>
        {!meter.current && <p className="text-ash">The level bar moves once the mic is on. If it stays flat while you talk, Windows is using the wrong mic (Settings › System › Sound › Input).</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={testSpeaker}>🔊 Test speaker</button>
          <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => meter.current ? (on ? null : stopMeter()) : void startMeter()}>{meter.current ? (on ? "Mic on" : "Stop mic test") : "🎤 Test mic"}</button>
          <label className="flex items-center gap-1"><input type="checkbox" checked={forceRec} onChange={e => setForceRec(e.target.checked)} disabled={on} /> Use recording mode (try this if it never hears you)</label>
        </div>
        {!!diag.length && <ol className="max-h-32 overflow-y-auto rounded bg-navy-2/60 p-1.5 font-mono text-[11px] text-ash" data-testid="diag">{diag.map((d, i) => <li key={i}>{d}</li>)}</ol>}
      </div>
    </details>
    <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-xl border border-ash/20 bg-navy/60 p-2" aria-label="Tutor conversation">
      {!turns.length && <p className="p-2 text-ash">Hi{first ? ` ${first}` : ""}! Ask me about homework, a topic you&apos;re learning, or something you&apos;re curious about.</p>}
      {turns.map((t, i) => <div key={i} className={t.role === "user" ? "ml-8 rounded-lg bg-cyan/10 px-2 py-1.5 text-snow" : "mr-8 rounded-lg bg-navy-2 px-2 py-1.5 text-snow"}>
        <p className="whitespace-pre-wrap break-words">{t.content}</p>
        {t.tag && <p className="mt-0.5 text-[10px] text-cyan/80" data-testid="model-tag">Answered by {t.tag}</p>}
      </div>)}
      {busy && <p className="px-2 text-ash">Crystal is thinking…</p>}
      <div ref={end} />
    </div>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const q = text; setText(""); void ask(q, false); }}>
      <input className="input min-w-0 flex-1" value={text} onChange={e => setText(e.target.value)} placeholder="Or type a question…" aria-label="Type a question" maxLength={1500} />
      <button className="btn" disabled={busy || !text.trim()}>Send</button>
    </form>
    {logs && logs.some(l => l.owner !== me) && <details className="rounded-xl border border-ash/20 bg-navy/60 p-2">
      <summary className="cursor-pointer text-snow">Parent review: kids&apos; tutor conversations ({logs.filter(l => l.owner !== me).length}{logs.some(l => l.flagged && l.owner !== me) ? `, ${logs.filter(l => l.flagged && l.owner !== me).length} flagged` : ""})</summary>
      <ul className="mt-2 space-y-1.5">{logs.filter(l => l.owner !== me).map(l => <li key={l.id} className={`rounded-md px-2 py-1 ${l.flagged ? "border border-alert/50 bg-alert/10" : "bg-navy-2/60"}`}>
        <p className="text-[11px] text-ash">{new Date(l.created_at).toLocaleString()} · {LABEL[l.provider || ""] ?? l.provider}{l.flagged ? ` · FLAGGED: ${l.flagged}` : ""}</p>
        <p className="text-snow">Q: {l.question}</p><p className="text-ash">A: {l.answer}</p></li>)}</ul>
    </details>}
  </div>;
}
