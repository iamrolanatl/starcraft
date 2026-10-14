// Escalation path for hard chat questions: row in chat_escalations (user's JWT, RLS) + id on the
// Cloudflare Queue "crystal-escalations". The box worker (sync/escalation_worker.py) answers with a
// larger model and writes the answer back; the client watches the row.
import type { ChatMessage } from "../../src/contracts/api";

export interface QueueBinding { send(body: unknown): Promise<void> }
const SB = "https://ogrrjkxkccbywbiikcak.supabase.co";

/** Personal-data lookups: if the small model says "I don't know" for these, the data really isn't there — don't escalate. */
const DATA_Q = /\b(grade|gpa|class(es)?|teacher|assignment|homework|missing|score|sync|task|to-?do|calendar|schedule|glucose|med(s|ication)?|steps|bill|money|credit|stock|price|quote|shopping|wish ?list|check-?in|weather|eli|school|period)\b/i;
const MULTI = /\b(step[- ]by[- ]step|and then|compare|pros and cons|plan (out|for|my)|walk me through|explain (why|how)|break (it|this) down|first .* then|strategy|trade-?offs?)\b/i;
const DUNNO = /\b(i (don'?t|do not) know|i'?m not sure|not certain|i (can'?t|cannot) (help|answer|say|determine)|i'?m unable|beyond my|i have no (way|idea|information)|unclear)\b/i;
const HEDGE = /\b(i think|probably|might be|may be|possibly|i guess|perhaps|i believe)\b/gi;

/** Before calling the small model: long or multi-step questions go straight to escalation. */
export function hardUpfront(q: string): string | null {
  if (q.length > 280) return "long question";
  if ((q.match(/\?/g) || []).length >= 3) return "multi-part question";
  if (MULTI.test(q) && q.length > 60) return "multi-step question";
  if (/(^|\n)\s*(\d+[.)]|[-*•])\s+\S.*(\n\s*(\d+[.)]|[-*•])\s+\S)/.test(q)) return "multi-step list";
  return null;
}
/** After the small model answered: escalate when it gave up or hedged on something that isn't a data lookup. */
export function hardAfter(q: string, reply: string, provider: string): string | null {
  if (provider === "fallback") return "small model unavailable";
  const dataLookup = DATA_Q.test(q);
  if (DUNNO.test(reply) && !dataLookup) return "small model didn't know";
  if (!dataLookup && (reply.match(HEDGE) || []).length >= 2) return "low confidence";
  return null;
}

export async function escalate(o: { token: string; anon: string; queue?: QueueBinding; question: string; history: ChatMessage[]; context: string; reason: string }): Promise<{ id: string; queued: boolean } | null> {
  const h = { apikey: o.anon, authorization: `Bearer ${o.token}`, "content-type": "application/json", prefer: "return=representation" };
  try {
    const r = await fetch(`${SB}/rest/v1/chat_escalations?select=id`, { method: "POST", headers: h, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ question: o.question.slice(0, 4000), history: o.history.slice(-8).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) })), context: o.context.slice(0, 150000), reason: o.reason }) });
    if (!r.ok) { console.log("escalation insert failed", r.status); return null; }
    const id = (await r.json() as { id: string }[])[0]?.id; if (!id) return null;
    let queued = false;
    if (o.queue) { try { await o.queue.send({ id }); queued = true; } catch (e) { console.log("queue send failed", String(e)); } }
    return { id, queued }; // not queued -> the box worker's table sweep still picks it up
  } catch (e) { console.log("escalation error", String(e)); return null; }
}
