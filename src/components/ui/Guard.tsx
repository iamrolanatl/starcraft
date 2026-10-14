"use client";
import { Component, useEffect, useState, type ReactNode } from "react";
import { reportError } from "@/lib/safe";
/** Error boundary: one failing applet/HUD panel never blanks the app. */
export class Boundary extends Component<{ name: string; children: ReactNode; compact?: boolean }, { err: Error | null; n: number }> {
  state = { err: null as Error | null, n: 0 };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { reportError(err, `boundary:${this.props.name}`); }
  render() {
    if (!this.state.err) return <div key={this.state.n} className="contents">{this.props.children}</div>;
    return (<div role="alert" className={`rounded-lg border border-alert/40 bg-alert/10 text-xs text-snow ${this.props.compact ? "p-1" : "p-3"}`}>
      <p>⚠ {this.props.name} hit a glitch{this.props.compact ? "" : `: ${this.state.err.message.slice(0, 120)}`}</p>
      <button className="mt-1 rounded border border-cyan/50 px-2 py-0.5 text-cyan hover:bg-cyan/10" onClick={() => this.setState(s => ({ err: null, n: s.n + 1 }))}>Retry</button></div>);
  }
}
/** Global hooks: window errors + unhandled rejections → error tracking. */
export function useGlobalErrorHooks() {
  useEffect(() => {
    const onErr = (e: ErrorEvent) => reportError(e.error ?? e.message, "window");
    const onRej = (e: PromiseRejectionEvent) => { const r = e.reason as { name?: string }; if (r?.name === "AbortError") return; reportError(e.reason, "promise"); };
    addEventListener("error", onErr); addEventListener("unhandledrejection", onRej);
    return () => { removeEventListener("error", onErr); removeEventListener("unhandledrejection", onRej); };
  }, []);
}
export function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => { const u = () => setOff(!navigator.onLine); u(); addEventListener("online", u); addEventListener("offline", u); return () => { removeEventListener("online", u); removeEventListener("offline", u); }; }, []);
  if (!off) return null;
  return <div role="status" data-safe-top className="fixed inset-x-0 top-0 z-[95] bg-amber-400/95 py-1 text-center text-xs font-semibold text-navy">⚠ Offline: comms down. Changes won&apos;t save until you reconnect.</div>;
}
