# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A static collection of single-page browser tools (Portuguese, pt-BR) that automate manual workflows around the **Prosoft** Brazilian accounting software — annotating fiscal-book PDFs, comparing supplier ledgers, and matching bank-statement credits to fiscal notes. There is no build step and no package manager. Each tool is one self-contained HTML file with inline CSS/JS. Regression tests for the parsers live in `tests/` (see the "Testing" section) and are runnable with plain `node` — no `node_modules`.

Deployed via **GitHub Pages**. Local folder is `prosoftmais`; GitHub repo is **`bittencourtRodrigo/prosoft-mais`** (renamed from `rodrigo-bittencourt-10/d12` in 2026-05). `conferir livro.html` fetches `CFOP.xlsx` from a hardcoded raw URL on this repo (see "CFOP dictionary sync" below) — renaming the repo or moving the file breaks the sync for all live users.

## How to run / develop

- Open `index.html` directly in a browser, OR serve with any static server (`python -m http.server`, etc.). `fetch('tools.json')` works from `file://` in most browsers but a local server is safer.
- Nothing to build or lint. Edit the HTML and reload. After touching any parser, run `node tests/run.js` (see "Testing" below).
- All third-party libs (`pdf.js`, `xlsx`, `jspdf`, `jspdf-autotable`) load from cdnjs — no `node_modules`.

## Architecture

### The launcher (`index.html` + `tools.json`)

`index.html` is a thin loader. It fetches `tools.json`, groups tools by `categoria` (empty string = uncategorized, rendered without a section header), and renders one card per entry that links to the tool's HTML file. To add a new tool: drop the HTML file in the root and append an entry to `tools.json` with `file`, `titulo`, `desc`, `icone`, and `categoria`. Filenames with spaces and accents are intentional — they're encoded with `encodeURI` in `index.html:155`.

### Each tool is self-contained

There is no shared CSS or JS file. Every tool duplicates the design tokens inline:

```
--bg #F7F8FA  --surface #FFFFFF  --border #D8DEE7  --muted #8A99AE
--text #1A2436  --sub #5C7191  --accent #1E3A5F  --accent-h #15293F  --danger #C0392B
font: 'Sora' (UI) / 'JetBrains Mono' (codes, timestamps, file paths)
radius: 6px  transition: 140ms ease
```

When changing visual style, update **every** tool — there is no single source of truth. The same applies to shared UI patterns (upload `.ucard` with drag/drop, `.toast` notifications, dashed-border drop zones turning solid navy on `loaded`).

The animated brand SVG (`prosoftmais.svg`, used as the `index.html` header) is **maintained by the user externally** (generated in another tool). Use its color tokens (`#1E3A5F` / `#15293F`) when keeping the palette in sync, but do not modify the SVG's internal `<title>`, `aria-label`, animation keyframes, or path data without an explicit ask — the page-level `<object aria-label="prosoftMais">` handles accessibility.

### CFOP dictionary sync (`conferir livro.html` ↔ `CFOP.xlsx`)

This is the only piece of cross-file state. `CFOP.xlsx` (root of repo) is the master spreadsheet mapping CFOP codes → `{ sigla, categoria }`. The tool:

1. Fetches it from `https://raw.githubusercontent.com/bittencourtRodrigo/prosoft-mais/refs/heads/main/CFOP.xlsx` (hardcoded at `conferir livro.html:778`).
2. Parses with SheetJS, replaces the entire local dict, persists to `localStorage` key `p9-cfop-dict-v2` (with auto-migration from `p9-cfop-dict-v1`).
3. Tracks last sync time at `localStorage['p9-gh-last']`.

To update CFOP mappings for all users: edit `CFOP.xlsx` (columns: CFOP | Sigla | Categoria), commit, push. Users then hit "Atualizar CFOPs". **Do not** rely on the user adding entries via the in-page form for anything that should propagate — that path only writes to their own localStorage.

The `categoria` field is **load-bearing semantics**, not free text. The PDF annotator (`drawTotals` at `conferir livro.html:935`) sums values whose CFOP's category equals one of: `calcula (comercio)`, `calcula (industria)`, `devolução (comercio)`, `devolução (industria)`. The P1 CSV processor (`parseP1CSV` at line 1029) keys off `anotar despesas`, `anotar despesas (comercio)`, `anotar despesas (industria)`. Adding a new category string in `CFOP.xlsx` does nothing unless you also handle it in the JS.

### PDF extraction pattern

Both PDF tools use the same approach: `pdf.js` → `page.getTextContent()` → iterate `items`. `item.transform[4]` is X, `item.transform[5]` is Y. To reconstruct visual lines, group items by Y (rounded), sort within each group by X. `fechar fornecedor.html:488` uses a simpler Y-delta heuristic.

**Important — pdf.js reorders items within the same visual line.** In some Prosoft reports (notably `cprmodi.pdf` / Contas a Pagar) the order of text items returned by `getTextContent()` does **not** match visual reading order. Real cases seen: the label `"CNPJ/CPF:"` appears **after** the CNPJ value on the same line; the label `"Total a pagar para o Fornecedor ---->"` appears **after** the value; the supplier name lands on a line several positions **below** the `"Nome do Fornecedor:"` label. Parsers that assume "label → value" on the same line **fail silently** (matching nothing). The workaround in `parseContasPagar` is a state machine: detect block start by `"CNPJ/CPF:"` anywhere on the line, collect lines until `"Total a pagar para o Fornecedor"`, and within the block pick the supplier name as the first line that isn't a known label / column header / invoice row / repeated page header. When in doubt about a tool's parsing, inspect the raw pdf.js output by following the fixture-capture workflow in the "Testing" section.

`conferir livro.html` is the odd one — it doesn't just extract text, it **renders** each PDF page to a canvas at `SCALE = 1.8`, then overlays sigla labels next to detected CFOP codes by mapping `item.transform[4..5]` through `viewport.convertToViewportPoint`. Printing uses `window.print()` against the canvas-rendered pages (see the `@media print` block).

### The tools

- **`conferir livro.html` (Conferir Livro)** — Annotates the P9 PDF (ICMS Apuração Registry) with CFOP siglas drawn directly onto the rendered canvases, plus optional P1 CSV (Livro de Entradas) that adds despesa totals to page 1. State: CFOP dict in localStorage.
- **`fechar fornecedor.html` (Fechar Fornecedor)** — Two PDF uploads (Balancete + Conta Corrente), parses supplier balances from each (regex anchored on Prosoft account codes like `2101010100`, `20100-2`), diffs them, exports a divergence report via `jsPDF` + `autoTable`. Each upload runs `validateFile` to detect swapped files. No persistence.
- **`fechar fornecedor por nome.html` (Fechar Fornecedor — por nome)** — Sibling of `fechar fornecedor` for the case where the second report (Contas a Pagar) has no supplier code — only CNPJ + full name. Joins balancete and contas-a-pagar entries by **prefix-matching the normalized supplier name** (the balancete truncates names to ~20 chars at variable cut points — sometimes mid-word, sometimes word-boundary). Surfaces 4 buckets: divergence, ambiguous (one balancete row matched by multiple contas-a-pagar entries), only-in-balancete, only-in-contas-a-pagar. Strict-equality on cents (`Math.round(v*100)`). Output is `window.print()` against the on-page HTML (with `@media print` styles) — no `jsPDF`.

### Brazilian conventions baked in

- Numbers: `1.234,56` (dot thousands, comma decimal). Use `parseBRL` (`.replace(/\./g,'').replace(',','.')`) and `toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
- Dates: `dd/mm/yyyy`.
- CSV from Prosoft P1 is **Windows-1252 (latin-1)** encoded — read with `reader.readAsText(file, 'windows-1252')` (`conferir livro.html:1080`). UTF-8 will mangle accents.
- CFOP codes are 4 digits, first digit ∈ 1–9. First digit encodes direction: `1`/`2` = entrada (compras), `5`/`6` = saída (vendas). The totals logic in `drawTotals` depends on this.

## Testing

Regression tests for the parsers live in `tests/`. No build, no npm. Two runners — one for the browser, one for node — share the same suite format:

```
tests/
  index.html                              # Browser runner — open in a static server
  run.js                                  # Node runner — `node tests/run.js`
  runner.js                               # Browser runner library
  fixtures/                               # Deterministic text snapshots (pdf.js output)
    balancete-andrade-lessa.txt
    contas-pagar-andrade-lessa.txt
  suites/
    fechar-fornecedor-por-nome.test.js
```

### How to run

- **CLI** (fast, no server): `node tests/run.js`. Exits 0 on pass, 1 on fail. Output is compact: only lists failures, ends with `N/M pass`. **This runs automatically via a Stop hook in `.claude/settings.json`** — agents must end every session with green tests.
- **Browser** (visual): `python -m http.server 8765` then open `http://localhost:8765/tests/`.

### When to run

**Always after touching any parser** (`parseBalancete`, `parseContasPagar`, `parseContaCorrente`, `normalizeName`, `parseBRL`). The runner extracts the real inline `<script>` from the tool's HTML and runs it against deterministic fixtures — break the parser, break the test. The Stop hook enforces this for any agent-driven edits.

### How `loadTool` works (no shared code)

The single-file-per-tool ethos (no shared JS) is preserved by `loadTool('<tool>.html')`: it `fetch`es / `fs.readFileSync`s the HTML, extracts the last inline `<script>` block, and runs it inside a `new Function(...)` sandbox with stubs for `pdfjsLib`, `window`, `document`, `URL`, `Blob`. The tool's top-level function declarations (`parseBalancete`, etc.) are captured via an `__ns` object injected into the scope. **Tests run against the real tool code, with zero duplication.**

### Adding a fixture and test for a new failure case

Whenever you find a parsing case that fails:

1. Capture the raw pdf.js extraction for the failing PDF. Temporarily add `console.log(text);` right after `var text = await extractText(file);` in the tool's `handleFile`, load the PDF in the browser, copy the output from the devtools console, then revert the `console.log`.
2. Save the captured text under `tests/fixtures/` as `<descriptive-name>.txt`
3. Add `assert` calls in the relevant `tests/suites/<tool>.test.js` for the values you expect (supplier count, specific names, specific saldos)
4. Run `node tests/run.js` — should fail (red baseline)
5. Fix the parser
6. Run `node tests/run.js` — should pass (regression locked in)

Step 4 is the crucial one: **never write a test that already passes**. A test that didn't fail before the fix doesn't prove the fix worked.

## Conventions

- All user-facing text is Portuguese. Keep new strings in pt-BR.
- No frameworks, no bundler, no TypeScript — keep tools as single inline HTML files. The duplication is intentional: each file must work standalone when opened from disk.
- When extending a tool's CSS, follow the existing token vocabulary (`--accent`, `--sub`, `--muted`, etc.) rather than introducing new colors.
- localStorage keys are versioned (`p9-cfop-dict-v2`) — if you change the schema, bump the version and write a migration like the existing `loadDict()`.
