// Speech-to-text fallback (iOS Safari / Firefox): Workers AI Whisper. Audio is transcribed in memory and never stored or logged.
import { json } from "../_lib/http";
import type { Env } from "../_lib/router";
const MAX = 4 * 1024 * 1024; // ~2 min of compressed speech
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const type = request.headers.get("content-type") || "";
  if (!/^audio\/|^application\/octet-stream/.test(type)) return json({ error: "Send raw audio (audio/*)." }, 415);
  const len = Number(request.headers.get("content-length") || 0); if (len > MAX) return json({ error: "Audio too long (max ~2 minutes)." }, 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) return json({ error: "No audio received." }, 400); if (buf.length > MAX) return json({ error: "Audio too long (max ~2 minutes)." }, 413);
  try {
    const out = await Promise.race([env.AI.run("@cf/openai/whisper", { audio: [...buf] }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 25000))]) as { text?: string };
    return json({ text: String(out?.text ?? "").trim().slice(0, 1000), model: "@cf/openai/whisper" });
  } catch (e) { console.log("whisper error", String(e).slice(0, 200)); return json({ error: "Transcription unavailable. Try again or type your command." }, 502); }
};
