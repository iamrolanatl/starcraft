# Crystal documentation build

In the repository this folder is `docs/project/build/`; paths below assume you run commands from it.

Sources live in `../md/` (one Markdown file per document, `00_`–`19_`, plus generated `_*.md` includes).
`build.py` renders each document to `../pdf/<name>.pdf` and, with no arguments, also `../pdf/Crystal_Documentation_Set_v1.0.pdf`.

## Toolchain (one-time setup)

```bash
cd build
python3 -m venv .venv
.venv/bin/pip install weasyprint markdown pymdown-extensions pypdf
# Mermaid diagrams (needs Chrome/Chromium; puppeteer.json points at /usr/bin/google-chrome)
PUPPETEER_SKIP_DOWNLOAD=1 npm install          # installs @mermaid-js/mermaid-cli from package.json
```

Fonts: IBM Plex Sans / IBM Plex Mono installed system-wide (falls back to sans-serif).

## Build

```bash
.venv/bin/python build.py            # all documents + combined PDF
.venv/bin/python build.py 04 14      # only selected documents (two-digit prefixes)
```

Each build regenerates `md/_rtm.md` (traceability from 03/04/05/08/15) via `gen_rtm.py`.
Optional generators:

```bash
CRYSTAL_MIGRATIONS=../../../supabase/migrations .venv/bin/python build.py   # regenerate the 07 data dictionary
.venv/bin/python gen_changelog.py ../../.. HEAD                           # regenerate the 18 change log from git
```

## Authoring conventions

- First line of each document: `<!-- code: CRY-NN-XXX | title: ... | subtitle: ... -->`.
- Mermaid: fenced ```` ```mermaid ```` blocks; first line `%% caption: Figure N-n. ...`. PNGs are cached in `../diagrams/` by content hash.
- Status pills: `[[ok|Live]]`, `[[partial|Partial]]`, `[[no|Open]]`. The word TBD is highlighted automatically.
- Includes: `<!-- include: _file.md -->`.
- Never put secret values in these documents; refer to environment variable names only.
