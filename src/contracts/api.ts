// Typed API contracts. Each RPC is {Request, Response} so the same shapes can be
// lifted into Protobuf/Connect-RPC services later without changing callers.
export type Role = "user" | "assistant";
export interface ChatMessage { role: Role; content: string }

export interface ChatRequest { mode: "sales" | "pilot"; messages: ChatMessage[] }
export interface ChatResponse { reply: string; model: string; provider: "workers-ai" | "grok" | "fallback" }

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
  const r = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j as ApiError).error || `HTTP ${r.status}`);
  return j as Res;
}
