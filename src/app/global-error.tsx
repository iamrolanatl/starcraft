"use client";
import "./globals.css";
import { useEffect } from "react";
import { reportError } from "@/lib/safe";
import ErrorScreen from "@/components/ErrorScreen";
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { reportError(error, "global"); }, [error]);
  return (<html lang="en"><body style={{ background: "#060b1a", color: "#cfe9ff", margin: 0 }}><ErrorScreen code="error" onRetry={reset} /></body></html>);
}
