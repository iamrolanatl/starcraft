// Model router: Cloudflare Workers AI first; Grok is a stub for a future fallback.
import type { ChatMessage, ChatResponse } from "../../src/contracts/api";

export interface Env { AI: { run(model: string, input: unknown): Promise<AiOut> }; GROK_API_KEY?: string }
type AiOut = { response?: unknown; choices?: { message?: { content?: string }; text?: string }[] };
const textOf = (o: AiOut): string => { const v = o.response ?? o.choices?.[0]?.message?.content ?? o.choices?.[0]?.text ?? ""; return typeof v === "string" ? v : JSON.stringify(v); };
// Tried in order; the first that answers wins (catalog names change over time).
export const MODELS = ["@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.2-3b-instruct", "@cf/meta/llama-3.1-8b-instruct"];

export async function complete(env: Env, system: string, messages: ChatMessage[], maxTokens = 400): Promise<ChatResponse> {
  const msgs = [{ role: "system", content: system }, ...messages.slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }))];
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, { messages: msgs, max_tokens: maxTokens });
      const reply = textOf(out).trim();
      if (reply && !needsEscalation(reply)) return { reply, model, provider: "workers-ai" };
    } catch (e) { console.log("workers-ai error", model, String(e)); }
  }
  const g = await grokFallback(env, msgs);
  if (g) return g;
  return { reply: "My comms array is recharging. Try again in a moment, pilot.", model: "none", provider: "fallback" };
}

function needsEscalation(reply: string) { return reply.length < 2; }

// STUB: wire up https://api.x.ai/v1/chat/completions when GROK_API_KEY is set.
async function grokFallback(env: Env, _msgs: unknown[]): Promise<ChatResponse | null> {
  if (!env.GROK_API_KEY) return null;
  return null;
}
