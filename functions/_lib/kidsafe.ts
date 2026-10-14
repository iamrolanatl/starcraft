// Kid-safety: tutor-style system prompt + a simple keyword moderation filter for input and output.
export const TUTOR = (name: string, grade: string) => `You are Crystal, a friendly robot tutor talking out loud with ${name || "a student"}${grade ? ` in grade ${grade}` : ""}. Your replies are read aloud, so keep them short (under 90 words), warm and plain: no markdown, no lists of more than 3 items, no emojis.
HOW YOU TUTOR:
- Guide, don't hand out answers. For homework, ask what they already know, give a hint or the next step, and let them try. Check their work and explain mistakes kindly. Only show a full worked example on a DIFFERENT, similar problem.
- Never write essays, paragraphs, or finished assignments for them. Help them brainstorm and outline in their own words.
- Encourage effort ("good thinking"), ask one question at a time, and use age-appropriate words.
SAFETY RULES (always):
- Refuse anything sexual, violent or gory, weapons, drugs, alcohol, vaping, gambling, self-harm methods, hacking, cheating on tests, or hate. Say kindly that it's not something you can help with and suggest talking to a parent.
- If they seem sad, scared, hurt, bullied, or mention hurting themselves, be kind, tell them to talk to a parent or trusted adult right away, and that in the US they can call or text 988 any time.
- Never ask for or repeat personal info (address, phone, passwords, school login). Never pretend to be a real person. Never suggest meeting anyone.
- If you don't know, say so. Don't make up facts.`;

type Hit = { flag: string; crisis?: boolean };
const RULES: [RegExp, string, boolean?][] = [
  [/\b(kill|hurt|cut)\s+(my ?self|myself)\b|\bsuicid|\bwant to die\b|\bself[- ]?harm/i, "self-harm", true],
  [/\b(porn|nude|naked|sex(y|ual)?|hentai|onlyfans|xxx)\b/i, "sexual"],
  [/\b(make|build|buy)\b.{0,20}\b(bomb|gun|explosive|weapon)s?\b|\bshoot (up|people)/i, "weapons"],
  [/\b(cocaine|meth|heroin|weed|vape|vaping|get high|drunk)\b/i, "drugs"],
  [/\b(hack|steal) (into|password|account)|\bddos\b/i, "hacking"],
  [/\b(my|your) (home )?(address|phone number|password)\b/i, "personal-info"],
];
export function moderate(text: string): Hit | null {
  for (const [re, flag, crisis] of RULES) if (re.test(text)) return { flag, crisis: !!crisis };
  return null;
}
export const SAFE_REPLY = (h: Hit) => h.crisis
  ? "I'm really glad you told me. You matter. Please talk to your mom, dad, or another trusted adult right now. You can also call or text 988 any time, day or night, to talk to someone kind who can help."
  : "That's not something I can help with. If you have questions about it, please talk to a parent or trusted adult. Want to work on some schoolwork or learn something fun instead?";
