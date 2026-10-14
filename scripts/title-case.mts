// Title Case lint for UI action labels (buttons, tabs, menu items, dock labels, dialog actions).
// Usage: tsx scripts/title-case.mts [--fix]   (exits 1 when violations remain)
import ts from "typescript"; import fs from "fs"; import path from "path";
const SMALL = new Set("a an the of to and or but nor for in on at by with vs via per as from into up off".split(" "));
// Words kept exactly as written (brand / unit / code tokens are detected separately).
export function titleCase(s: string): string {
  const parts = s.split(/(\s+|(?<=[(/–—-])|(?=[)/–—-]))/);
  const words = parts.map((p, i) => ({ p, i })).filter(x => /\p{L}/u.test(x.p));
  const first = words[0]?.i, last = words[words.length - 1]?.i;
  return parts.map((p, i) => {
    if (!/^\p{Ll}/u.test(p)) return p;                                  // already capitalised / symbol / number
    if (/[A-Z0-9@._:#]/.test(p.slice(1)) || /^(e\.g|i\.e|vs\.)$/.test(p)) return p; // iCal, e.g., file.ext, urls
    const lw = p.toLowerCase();
    if (SMALL.has(lw) && i !== first && i !== last && !/[:–—]\s*$/.test(parts.slice(0, i).join(""))) return lw;
    return p[0].toUpperCase() + p.slice(1);
  }).join("");
}
const ACTION_ATTRS = new Set(["aria-label", "data-tip", "title"]);
const isActionTag = (el: ts.JsxOpeningLikeElement) => { const tag = el.tagName.getText(); const role = el.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText() === "role") as ts.JsxAttribute | undefined;
  const rv = role?.initializer && ts.isStringLiteral(role.initializer) ? role.initializer.text : ""; return tag === "button" || /^(Btn|Button|TrashBtn|Tab|MenuItem)$/.test(tag) || ["tab", "button", "menuitem", "menuitemradio", "radio"].includes(rv); };
type Hit = { file: string; start: number; end: number; old: string; neu: string; line: number };
const hits: Hit[] = [];
function check(sf: ts.SourceFile, file: string, node: ts.Node, text: string, start: number, end: number) {
  const t = text.trim(); if (!t || (t.match(/\p{L}/gu) ?? []).length < 2 || !/\p{L}/u.test(t) || t.length > 60 || /[.?!]$/.test(t) && t.split(/\s+/).length > 6) return; // sentences are not labels
  const neu = titleCase(text); if (neu !== text) hits.push({ file, start, end, old: text, neu, line: sf.getLineAndCharacterOfPosition(start).line + 1 });
}
function walk(sf: ts.SourceFile, file: string) {
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && isActionTag(n.openingElement)) for (const c of n.children) if (ts.isJsxText(c)) check(sf, file, c, c.text, c.getStart(sf), c.getEnd());
      else if (ts.isJsxExpression(c) && c.expression && ts.isStringLiteral(c.expression)) check(sf, file, c, c.expression.text, c.expression.getStart(sf) + 1, c.expression.getEnd() - 1);
    if ((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && isActionTag(n)) for (const a of n.attributes.properties)
      if (ts.isJsxAttribute(a) && ACTION_ATTRS.has(a.name.getText()) && a.initializer && ts.isStringLiteral(a.initializer)) check(sf, file, a, a.initializer.text, a.initializer.getStart(sf) + 1, a.initializer.getEnd() - 1);
    ts.forEachChild(n, visit); };
  visit(sf);
}
const files: string[] = []; const rec = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) rec(p); else if (p.endsWith(".tsx")) files.push(p); } }; rec("src");
for (const f of files) walk(ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), f);
if (process.argv.includes("--fix")) { const by = new Map<string, Hit[]>(); hits.forEach(h => by.set(h.file, [...(by.get(h.file) ?? []), h]));
  for (const [f, hs] of by) { let s = fs.readFileSync(f, "utf8"); for (const h of hs.sort((a, b) => b.start - a.start)) s = s.slice(0, h.start) + h.neu + s.slice(h.end); fs.writeFileSync(f, s); } }
for (const h of hits) console.log(`${h.file}:${h.line}  "${h.old.trim()}" → "${h.neu.trim()}"`);
console.log(`${hits.length} label(s) not in Title Case${process.argv.includes("--fix") ? " (fixed)" : ""}`); process.exit(hits.length && !process.argv.includes("--fix") ? 1 : 0);
