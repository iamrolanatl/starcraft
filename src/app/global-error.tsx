"use client";
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (<html lang="en"><body style={{ background: "#060b1a", color: "#cfe9ff", fontFamily: "system-ui", display: "grid", placeItems: "center", minHeight: "100dvh", margin: 0 }}>
    <div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}><div style={{ fontSize: 48 }}>🛰</div><h1 style={{ color: "#3ef2e0" }}>Crystal lost signal</h1>
      <p>Something crashed. Your data is safe in the cloud.</p><p style={{ fontSize: 12, opacity: .6 }}>{String(error?.message || "").slice(0, 160)}</p>
      <button onClick={() => reset()} style={{ margin: 6, padding: "8px 16px", borderRadius: 8, border: "1px solid #3ef2e0", background: "transparent", color: "#3ef2e0" }}>Try Again</button>
      <button onClick={() => location.reload()} style={{ margin: 6, padding: "8px 16px", borderRadius: 8, border: 0, background: "#3ef2e0", color: "#04121a" }}>Reload</button></div></body></html>);
}
