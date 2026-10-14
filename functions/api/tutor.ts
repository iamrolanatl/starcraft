// Kids' hands-free tutor. POST { messages, name?, grade?, voice? } → { reply, provider, model, fellBack?, flagged? }
// Provider: env CHAT_PROVIDER (ollama → falls back to Workers AI). Every turn is logged to public.tutor_logs (RLS: owner + parent read).
import type { ChatMessage } from "../../src/contracts/api";
import { body, json } from "../_lib/http";
import { answer, pickProvider, type ProvEnv } from "../_lib/providers";
import { TUTOR, moderate, SAFE_REPLY } from "../_lib/kidsafe";

const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";
type Req = { messages: ChatMessage[]; name?: string; grade?: string; voice?: boolean };
type E = ProvEnv & { SUPABASE_ANON_KEY?: string };

export const onRequestGet: PagesFunction<E> = async ({ env }) => json({ provider: pickProvider(env), ollamaConfigured: !!env.OLLAMA_URL, grokReady: !!env.XAI_API_KEY });

export const onRequestPost: PagesFunction<E> = async ({ request, env, waitUntil }) => {
  const b = await body<Req>(request);
  if (!b || !Array.isArray(b.messages) || !b.messages.length) return json({ error: "messages required" }, 400);
  const msgs = b.messages.slice(-10).map(m => ({ role: m.role === "assistant" ? "assistant" as const : "user" as const, content: String(m.content || "").slice(0, 1500) }));
  const q = msgs[msgs.length - 1].content;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || undefined;
  const anon = env.SUPABASE_ANON_KEY || request.headers.get("x-supabase-anon") || undefined;
  const log = (row: Record<string, unknown>) => token && anon ? waitUntil(fetch(`${SB}/rest/v1/tutor_logs`, { method: "POST", headers: { apikey: anon, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(row) }).then(r => { if (!r.ok) console.log("tutor log", r.status); }).catch(() => {})) : undefined;
  const base = { question: q.slice(0, 1500), voice: !!b.voice };

  const inHit = moderate(q);
  if (inHit) { const reply = SAFE_REPLY(inHit); log({ ...base, answer: reply, provider: "filter", model: "moderation", flagged: inHit.flag }); return json({ reply, provider: "filter", model: "moderation", flagged: inHit.flag }); }

  const a = await answer(env, TUTOR(String(b.name || "").slice(0, 40), String(b.grade || "").slice(0, 10)), msgs);
  const outHit = a.provider !== "none" ? moderate(a.reply) : null;
  const reply = outHit ? SAFE_REPLY(outHit) : a.reply;
  log({ ...base, answer: reply.slice(0, 4000), provider: a.provider, model: a.model, flagged: outHit ? `output:${outHit.flag}` : null, fell_back: a.fellBack ?? null, ms: a.ms });
  return json({ reply, provider: a.provider, model: a.model, fellBack: a.fellBack, flagged: outHit ? `output:${outHit.flag}` : undefined });
};
