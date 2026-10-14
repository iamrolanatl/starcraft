"use client";
import { useEffect, useState } from "react";
import ErrorScreen, { ERRORS } from "@/components/ErrorScreen";
// Served by the edge middleware for 401/403/429/500/502/503 (status injected as <html data-err>), or directly as /oops/?code=403.
export default function Oops() {
  const [code, setCode] = useState<string | null>(null); const [chat, setChat] = useState(false);
  useEffect(() => { const q = new URLSearchParams(location.search); const c = document.documentElement.dataset.err || q.get("code") || "error"; setCode(ERRORS[c] ? c : "error"); setChat(q.get("chat") === "1"); }, []);
  if (!code) return <main className="min-h-dvh bg-navy" />;
  return <ErrorScreen code={code} chatOpen={chat} />;
}
