#!/usr/bin/env python3
"""Build the Crystal documentation set: md/NN_*.md -> pdf/NN_*.pdf (+ pdf/Crystal_Documentation_Set_v1.0.pdf).

  python3 build/build.py                 # all documents + combined PDF
  python3 build/build.py 06 07           # only these documents (no combined)
  CRYSTAL_MIGRATIONS=/path/to/supabase/migrations python3 build/build.py   # regenerate the data dictionary first

Requirements (see build/README.md): Python 3.10+ with weasyprint, markdown, pymdown-extensions; Node + @mermaid-js/mermaid-cli
(mmdc) and a Chrome/Chromium for diagrams. Mermaid PNGs are cached in diagrams/ by content hash, so a rebuild without
mmdc still works as long as the diagram text did not change.
"""
import hashlib, html, os, re, shutil, subprocess, sys, pathlib
import markdown
from weasyprint import HTML, CSS

ROOT = pathlib.Path(__file__).resolve().parent.parent
MD, PDF, DIA, B = ROOT / "md", ROOT / "pdf", ROOT / "diagrams", ROOT / "build"
VERSION, DATE, OWNER = "1.0", "October 14, 2026", "Rolan Chowdhury"
BASELINE = "iamrolanatl/starcraft, branch sync-agent @ 588f344 (includes main @ 987aa68)"
REV = [("1.0", "2026-10-14", "Rolan Chowdhury (owner); drafted by Grok Bot",
        f"Initial baseline. Facts taken from the code, migrations, tests and git history at {BASELINE}. Unknowns are marked TBD.")]

def meta_of(text):
    m = re.match(r"<!--\s*(.*?)\s*-->", text, re.S)
    d = {}
    if m:
        for part in m.group(1).split("|"):
            if ":" in part: k, v = part.split(":", 1); d[k.strip()] = v.strip()
    return d

def mmdc_bin():
    for c in [B / "node_modules/.bin/mmdc", shutil.which("mmdc")]:
        if c and pathlib.Path(c).exists(): return str(c)
    return None

def render_mermaid(src, caption):
    DIA.mkdir(exist_ok=True)
    h = hashlib.sha256(src.encode()).hexdigest()[:12]
    png = DIA / f"mmd-{h}.png"
    if not png.exists():
        mm = mmdc_bin()
        if not mm: raise SystemExit("mermaid diagram changed but mmdc is not installed (npm i @mermaid-js/mermaid-cli in build/)")
        (DIA / f"mmd-{h}.mmd").write_text(src)
        subprocess.run([mm, "-q", "-p", str(B / "puppeteer.json"), "-c", str(B / "mermaid.json"), "-i", str(DIA / f"mmd-{h}.mmd"),
                        "-o", str(png), "-s", "3", "-b", "white"], check=True)
    cap = f"<figcaption>{html.escape(caption)}</figcaption>" if caption else ""
    return f'\n<figure><img src="{png.as_uri()}" alt="{html.escape(caption or "diagram")}"/>{cap}</figure>\n'

def preprocess(text):
    text = re.sub(r"<!--\s*include:\s*(\S+)\s*-->", lambda m: (MD / m.group(1)).read_text(), text)
    def mer(m):
        body = m.group(1); cap = ""
        cm = re.search(r"^%%\s*caption:\s*(.+)$", body, re.M)
        if cm: cap = cm.group(1).strip(); body = body.replace(cm.group(0), "")
        return render_mermaid(body.strip() + "\n", cap)
    text = re.sub(r"```mermaid\n(.*?)```", mer, text, flags=re.S)
    text = re.sub(r"\[\[(ok|partial|no)\|([^\]]+)\]\]", r'<span class="pill \1">\2</span>', text)
    return text

def to_html(text, did):
    h = markdown.markdown(preprocess(text), extensions=["tables", "fenced_code", "attr_list", "md_in_html", "sane_lists"])
    toc, n = [], [0]
    def hid(m):
        n[0] += 1; lvl, inner = m.group(1), m.group(2)
        anchor = f"d{did}-h{n[0]}"; toc.append((int(lvl), anchor, re.sub(r"<[^>]+>", "", inner)))
        return f'<h{lvl} id="{anchor}">{inner}</h{lvl}>'
    h = re.sub(r"<h([23])>(.*?)</h\1>", hid, h)
    # highlight TBD outside tags/code
    parts = re.split(r"(<pre.*?</pre>|<code>.*?</code>|<[^>]+>)", h, flags=re.S)
    h = "".join(p if p.startswith("<") else re.sub(r"\bTBD\b", '<span class="tbd">TBD</span>', p) for p in parts)
    return h, toc

def cover(m, did):
    rows = [("Document ID", m.get("code", f"CRY-{did}")), ("Version", VERSION), ("Date", DATE), ("Owner", OWNER),
            ("Status", m.get("status", "Baseline")), ("Classification", "Family Confidential: contains no secrets; minor's data summarized only"),
            ("Source baseline", BASELINE)]
    t = "".join(f"<tr><td>{a}</td><td>{html.escape(b)}</td></tr>" for a, b in rows)
    return f"""<section class="cover"><div class="band"><div class="gem"></div>
<div class="brand">CRYSTAL<small>Family Command Center · Project Documentation Set</small></div>
<div class="code">{html.escape(m.get('code',''))} · Document {did} of 00–19</div>
<h1 class="ct">{html.escape(m['title'])}</h1><div class="sub">{html.escape(m.get('subtitle',''))}</div></div>
<table class="meta">{t}</table>
<div class="foot">Crystal · https://crystal-7ot.pages.dev · Prepared for Rolan Chowdhury. Methodology: PMI PMBOK-aligned governance with a hybrid
Waterfall (phase gates) + Agile (sprint) delivery model. Regenerate with <b>python3 build/build.py</b>.</div></section>"""

def control(m):
    rv = "".join(f"<tr><td>{a}</td><td>{b}</td><td>{html.escape(c)}</td><td>{html.escape(d)}</td></tr>" for a, b, c, d in REV)
    return f"""<section class="control"><h2>Document Control</h2>
<table><tr><th style="width:28%">Item</th><th>Value</th></tr>
<tr><td>Title</td><td>{html.escape(m['title'])}</td></tr><tr><td>Document ID</td><td>{html.escape(m.get('code',''))}</td></tr>
<tr><td>Version / date</td><td>{VERSION} / {DATE}</td></tr><tr><td>Owner / approver</td><td>{OWNER} (Project Sponsor, Product Owner)</td></tr>
<tr><td>Purpose</td><td>{html.escape(m.get('subtitle',''))}</td></tr>
<tr><td>Maintenance</td><td>Markdown source in <code>docs/md/</code>; update with each merged change that affects scope, requirements, schema or operations (see 00 Document Index §Maintenance).</td></tr></table>
<h2>Revision History</h2><table><tr><th style="width:9%">Version</th><th style="width:13%">Date</th><th style="width:24%">Author</th><th>Change</th></tr>{rv}</table>
<h2>Approvals</h2><table><tr><th>Role</th><th>Name</th><th>Decision</th><th>Date</th></tr>
<tr><td>Project Sponsor / Product Owner</td><td>Rolan Chowdhury</td><td>TBD</td><td>TBD</td></tr></table></section>"""

def toc_html(toc):
    li = "".join(f'<li class="l{l}"><a href="#{a}">{t}</a></li>' for l, a, t in toc)
    return f'<section class="toc"><h2>Contents</h2><ul>{li}</ul></section>'

def doc_section(path):
    text = path.read_text(); m = meta_of(text); did = path.name[:2]
    body, toc = to_html(text, did)
    return m, did, f'''<div class="doc" data-title="{html.escape(m["title"])}" data-code="{html.escape(m.get("code",""))}" id="doc{did}">
{cover(m, did)}{control(m)}{toc_html(toc)}<h1 class="dt">{html.escape(m["title"])}</h1><div class="body">{body}</div></div>'''

def page(inner, title):
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title></head><body>{inner}</body></html>'

def main(args):
    if os.environ.get("CRYSTAL_MIGRATIONS"):
        subprocess.run([sys.executable, str(B / "gen_datadict.py"), os.environ["CRYSTAL_MIGRATIONS"], str(MD / "_datadict.md")], check=True)
    subprocess.run([sys.executable, str(B / "gen_rtm.py")], check=True)   # 14 RTM tables from 03/04/05/08
    PDF.mkdir(exist_ok=True); css = CSS(filename=str(B / "style.css"))
    files = sorted(p for p in MD.glob("[0-9][0-9]_*.md"))
    chosen = [p for p in files if not args or p.name[:2] in args]
    sections = []
    for p in files:
        m, did, sec = doc_section(p); sections.append((m, did, sec))
        if p in chosen:
            out = PDF / (p.stem + ".pdf"); HTML(string=page(sec, m["title"]), base_url=str(ROOT)).write_pdf(out, stylesheets=[css])
            print("built", out.relative_to(ROOT))
    if not args:
        idx = "".join(f'<li class="l1"><a href="#doc{d}">{d} · {html.escape(m["title"])}</a></li>' for m, d, _ in sections)
        mc = {"title": "Crystal Project Documentation Set (Combined)", "code": "CRY-SET", "subtitle": "All documents 00–19 in one volume: governance, requirements, architecture, design, operations, planning, quality and security."}
        master = f'''<div class="doc" data-title="Combined Documentation Set" data-code="CRY-SET">{cover(mc, "SET")}{control(mc)}
<section class="toc"><h2>Documents in This Volume</h2><ul>{idx}</ul></section></div>'''
        allh = master + "".join(f'<div class="docstart">{s}</div>' for _, _, s in sections)
        out = PDF / "Crystal_Documentation_Set_v1.0.pdf"
        HTML(string=page(allh, mc["title"]), base_url=str(ROOT)).write_pdf(out, stylesheets=[css]); print("built", out.relative_to(ROOT))

if __name__ == "__main__":
    main(sys.argv[1:])
