// Typed API contracts. Each RPC is {Request, Response} so the same shapes can be
// lifted into Protobuf/Connect-RPC services later without changing callers.
export type Role = "user" | "assistant";
export interface ChatMessage { role: Role; content: string }

export interface ChatRequest { mode: "sales" | "pilot"; messages: ChatMessage[] }
export interface ChatResponse { reply: string; model: string; provider: "workers-ai" | "grok" | "fallback"; escalation?: { id: string; status: "queued" | "working" | "answered" | "failed"; reason?: string } }

export interface CommandRequest { text: string; nowIso: string; tzOffsetMinutes: number }
export type CommandIntent =
  | { kind: "create_task"; title: string; dueDate: string | null; priority: 1 | 2 | 3 }
  | { kind: "open_app"; app: AppId }
  | { kind: "create_item"; table: ItemTable; row: Record<string, string | number | boolean | null>; summary: string; app: AppId }
  | { kind: "chat"; reply: string };
export type ItemTable = "health_logs" | "meds" | "bills" | "credit_scores" | "stocks" | "shop_items" | "comms_notes" | "edu_checkins";
export interface CommandResponse { intent: CommandIntent; provider: ChatResponse["provider"] }

export type AppId = "home" | "tasks" | "weather" | "calendar" | "health" | "comms" | "education" | "finance" | "shopping" | "crystal" | "school" | "ocr" | "globe" | "medals";

export interface ApiError { error: string }

export const Routes = {
  chat: "/api/chat",
  command: "/api/command",
  quote: "/api/quote",
  log: "/api/log",
} as const;

export async function call<Req, Res>(route: string, body: Req): Promise<Res> {
  // timeout + one backoff retry on network/5xx + friendly 429 (kept DOM-free: this file is shared with Pages Functions)
  let last: Error = new Error("Network error");
  for (let i = 0; i < 2; i++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 30000);
    try {
      const r = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      const j = await r.json().catch(() => ({})) as Res & Partial<ApiError>;
      if (r.status === 429) throw Object.assign(new Error(`Easy there, pilot! Rate limit hit. Try again in ${r.headers.get("retry-after") || 30}s.`), { fatal: true });
      if (r.ok) return j as Res;
      last = Object.assign(new Error(j.error || `Server error (${r.status})`), { fatal: r.status < 500 });
    } catch (e) { last = (e as Error).name === "AbortError" ? new Error("Request timed out. Check your connection.") : e as Error; }
    finally { clearTimeout(t); }
    if ((last as Error & { fatal?: boolean }).fatal) throw last;
    await new Promise(res => setTimeout(res, 500 + Math.random() * 300));
  }
  throw last;
}
