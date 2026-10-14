"use client";
import { useState } from "react";
import { sb } from "@/lib/supabase";
import { sfx } from "@/lib/synth";
export default function AuthPanel() {
  const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email"); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const redirect = () => `${window.location.origin}/app/`;
  async function google() {
    sfx("click"); setBusy(true);
    const { error } = await sb().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect() } });
    if (error) { setMsg(`Google sign-in unavailable: ${error.message}`); setBusy(false); }
  }
  async function sendCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    const { error } = await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirect() } });
    setBusy(false);
    if (error) { setMsg(error.message); sfx("error"); } else { setStage("code"); setMsg("Transmission sent. Enter the code from your email (or tap the link)."); sfx("success"); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await sb().auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) { setMsg(error.message); sfx("error"); } else { sfx("success"); window.location.href = "/app/"; }
  }
  return (
    <div className="glass w-full max-w-sm rounded-2xl p-6">
      <div className="hud-label mb-1">Pilot authentication</div>
      <h3 className="mb-4 text-xl font-semibold text-snow">Sign up or log in</h3>
      <button onClick={google} disabled={busy} className="btn btn-ghost w-full">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Continue with Google
      </button>
      <div className="my-4 flex items-center gap-3 text-xs text-slate"><span className="h-px flex-1 bg-slate/40" />or email code<span className="h-px flex-1 bg-slate/40" /></div>
      {stage === "email" ? (
        <form onSubmit={sendCode} className="space-y-3">
          <label className="sr-only" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" placeholder="pilot@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Transmitting…" : "Send me a code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <label className="sr-only" htmlFor="code">One-time code</label>
          <input id="code" inputMode="numeric" required className="input tracking-[.4em]" placeholder="123456" value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" maxLength={10} />
          <button className="btn btn-primary w-full" disabled={busy}>Verify & launch</button>
          <button type="button" className="w-full text-xs text-slate hover:text-cyan" onClick={() => setStage("email")}>Use a different email</button>
        </form>
      )}
      {msg && <p className="mt-3 text-xs text-ash" role="status">{msg}</p>}
      <p className="mt-4 text-[11px] text-slate">By continuing you agree to the <a className="underline hover:text-cyan" href="/legal/terms/">Terms</a> and <a className="underline hover:text-cyan" href="/legal/privacy/">Privacy Statement</a>.</p>
    </div>
  );
}
