"use client";
import { useEffect } from "react";
import { reportError } from "@/lib/safe";
export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { reportError(error, "route"); }, [error]);
  return (<div className="flex min-h-dvh items-center justify-center bg-navy p-6 text-center"><div className="glass max-w-md rounded-2xl p-6">
    <div className="text-5xl">🛰</div><h1 className="neon mt-2 text-xl font-semibold">Crystal lost signal</h1><p className="mt-2 text-sm text-ice">Something crashed. Your data is safe.</p>
    <div className="mt-4 flex justify-center gap-2"><button className="btn btn-ghost" onClick={reset}>Try Again</button><button className="btn btn-primary" onClick={() => location.reload()}>Reload</button><a className="btn btn-ghost" href="/">Home</a></div></div></div>);
}
