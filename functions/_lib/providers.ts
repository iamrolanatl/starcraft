// Chat provider abstraction for the kids' tutor: ollama | workers-ai | grok, chosen by env CHAT_PROVIDER.
// Ollama runs on Rolan's laptop behind a Cloudflare Tunnel + shared-secret proxy; if it's unreachable we fall back to Workers AI.
import type { ChatMessage } from "../../src/contracts/api";
import { MODELS, type Env as AiEnv } from "./router";

export type Provider = "ollama" | "workers-ai" | "grok";
export interface ProvEnv extends AiEnv {
  CHAT_PROVIDER?: string;            // "ollama" (default for the tutor) | "workers-ai" | "grok"
  OLLAMA_URL?: string;               // e.g. https://ollama.example.com (the tunnel hostname)
  OLLAMA_MODEL?: string;             // default llama3.1:8b
  OLLAMA_SHARED_SECRET?: string;     // sent as X-Crystal-Key; checked by laptop/ollama/ollama-guard.ps1
  OLLAMA_ACCESS_CLIENT_ID?: string;  // optional Cloudflare Access service token
  OLLAMA_ACCESS_CLIENT_SECRET?: string;
  OLLAMA_TIMEOUT_MS?: string;        // connect/answer budget before falling back (default 12000)
  XAI_API_KEY?: string; GROK_MODEL?: string;
}
export interface Answer { reply: string; provider: Provider | "none"; model: string; fellBack?: string; ms: number }
type Msg = { role: string; content: string };

export function pickProvider(env: ProvEnv): Provider {
  const p = (env.CHAT_PROVIDER || "ollama").toLowerCase();
  return p === "grok" || p === "workers-ai" ? p : "ollama";
}

async function viaOllama(env: ProvEnv, msgs: Msg[], maxTokens: number): Promise<{ reply: string; model: string }> {
  if (!env.OLLAMA_URL) throw new Error("ollama not configured");
  if (!env.OLLAMA_SHARED_SECRET && !env.OLLAMA_ACCESS_CLIENT_ID) throw new Error("ollama has no auth configured; refusing to call an open endpoint");
  const model = env.OLLAMA_MODEL || "llama3.1:8b";
  const h: Record<string, string> = { "content-type": "application/json" };
  if (env.OLLAMA_SHARED_SECRET) h["x-crystal-key"] = env.OLLAMA_SHARED_SECRET;
  if (env.OLLAMA_ACCESS_CLIENT_ID && env.OLLAMA_ACCESS_CLIENT_SECRET) { h["cf-access-client-id"] = env.OLLAMA_ACCESS_CLIENT_ID; h["cf-access-client-secret"] = env.OLLAMA_ACCESS_CLIENT_SECRET; }
  const r = await fetch(`${env.OLLAMA_URL.replace(/\/+$/, "")}/api/chat`, { method: "POST", headers: h, signal: AbortSignal.timeout(Number(env.OLLAMA_TIMEOUT_MS) || 12000),
    body: JSON.stringify({ model, messages: msgs, stream: false, options: { num_predict: maxTokens, temperature: 0.6 }, keep_alive: "30m" }) });
  if (!r.ok) throw new Error(`ollama http ${r.status}`);
  const j = await r.json() as { message?: { content?: string } };
  const reply = String(j.message?.content || "").trim(); if (!reply) throw new Error("ollama empty");
  return { reply, model };
}
async function viaWorkers(env: ProvEnv, msgs: Msg[], maxTokens: number): Promise<{ reply: string; model: string }> {
  for (const model of MODELS) {
    try {
      const out = await Promise.race([env.AI.run(model, { messages: msgs, max_tokens: maxTokens }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 20000))]) as { response?: unknown };
      const reply = typeof out?.response === "string" ? out.response.trim() : ""; if (reply) return { reply, model };
    } catch (e) { console.log("workers-ai", model, String(e)); }
  }
  throw new Error("workers-ai unavailable");
}
// Grok: ready to go once XAI_API_KEY is set as a Pages secret (CHAT_PROVIDER=grok). OpenAI-compatible endpoint.
async function viaGrok(env: ProvEnv, msgs: Msg[], maxTokens: number): Promise<{ reply: string; model: string }> {
  if (!env.XAI_API_KEY) throw new Error("grok needs XAI_API_KEY");
  const model = env.GROK_MODEL || "grok-3-mini";
  const r = await fetch("https://api.x.ai/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(25000), headers: { "content-type": "application/json", authorization: `Bearer ${env.XAI_API_KEY}` }, body: JSON.stringify({ model, messages: msgs, max_tokens: maxTokens, temperature: 0.6 }) });
  if (!r.ok) throw new Error(`grok http ${r.status}`);
  const j = await r.json() as { choices?: { message?: { content?: string } }[] };
  const reply = String(j.choices?.[0]?.message?.content || "").trim(); if (!reply) throw new Error("grok empty");
  return { reply, model };
}

export async function answer(env: ProvEnv, system: string, history: ChatMessage[], maxTokens = 350): Promise<Answer> {
  const msgs: Msg[] = [{ role: "system", content: system }, ...history.slice(-10).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1500) }))];
  const want = pickProvider(env); const t0 = Date.now(); let why = "";
  const order: Provider[] = want === "workers-ai" ? ["workers-ai"] : [want, "workers-ai"];
  for (const p of order) {
    try {
      const r = p === "ollama" ? await viaOllama(env, msgs, maxTokens) : p === "grok" ? await viaGrok(env, msgs, maxTokens) : await viaWorkers(env, msgs, maxTokens);
      return { ...r, provider: p, fellBack: p !== want ? `${want} unavailable (${why})` : undefined, ms: Date.now() - t0 };
    } catch (e) { why = String((e as Error)?.message || e).slice(0, 80); console.log("provider fail", p, why); }
  }
  return { reply: "My radio is quiet right now. Try again in a minute!", provider: "none", model: "none", fellBack: why, ms: Date.now() - t0 };
}
