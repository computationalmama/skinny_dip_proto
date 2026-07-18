# AGENTS.md

Instructions for AI coding agents working in this repo.

## What this is

A fully local/offline RAG (retrieval-augmented generation) chat app over the PDFs in
`docs/`, plus a vector-database "pools" visualizer. **JavaScript/Node only** — there was
previously a parallel Python implementation under `python/`, but it was removed; don't
recreate it unless explicitly asked.

## Stack

- Node.js 18+, Express, vanilla JS (no bundler, no framework, no build step anywhere)
- ChromaDB — vector store, but note: it's used as an **HTTP server**, not embedded. See
  "The Chroma server" below.
- Ollama, local models: `nomic-embed-text` (embeddings) and `qwen2.5:7b` (chat)
- p5.js and D3.js — both loaded via CDN `<script>` tags in the visualizer pages, no npm
  install needed for them

## File map

```
docs/                   PDFs to index (drop new ones here)
rag_database/           Chroma's on-disk store — gitignored, auto-created by build
js/
  rag.js                CLI: build / ask / stats
  rag_web.js            Express server — chat UI (/) + /ask + /stats + serves the two
                         visualizer pages + /embeddings (raw chunk+vector dump)
  visualize.html         Pools visualizer, p5.js + canvas, hand-rolled k-means/layout
  visualize-d3.html      Pools visualizer, D3.js + SVG, d3-force layout + d3.zoom,
                         click a pool to zoom into a per-PDF detail view
  VISUALIZE.md           Plain-language explainer of how the visualizers work
  README.md              Full setup/run/troubleshooting instructions
```

## Running it (the important gotcha)

The JS Chroma client talks to Chroma over HTTP — it does **not** support the embedded
mode Python's `PersistentClient` had. So even though there's no Python *application* code
anymore, a Python-installed `chromadb` package is still required to run the server:

```bash
# Terminal 1 (from repo root) — keep running
./venv/bin/chroma run --path ./rag_database   # or: chroma run --path ./rag_database

# Terminal 2 (from js/)
node rag_web.js build     # only needed once, or after adding PDFs to docs/
node rag_web.js serve     # http://localhost:6601
```

Chroma listens on `:8000`, the app on `:6601`. If either command errors with a connection
refused / "collection not found", the Chroma server usually isn't running yet — check
Terminal 1 first.

Full detail: [`js/README.md`](js/README.md).

## Conventions to preserve

- **No bundler, no shared JS modules.** Every file is self-contained — `rag.js` and
  `rag_web.js` duplicate their RAG logic rather than importing a shared module, and
  `visualize.html`/`visualize-d3.html` duplicate the same clustering/labeling math
  (`cosineSim`, `kmeans`, `extractLabel`) rather than sharing a file. This is intentional
  for this project, not an oversight — keep following it rather than introducing a
  bundler or a shared `lib.js` unless asked.
- **Two independent visualizer styles, on purpose**: `visualize.html` (p5/canvas, all
  math hand-rolled) and `visualize-d3.html` (D3/SVG, layout and zoom are library-provided)
  exist side by side as a deliberate comparison. Don't delete or merge one into the other
  without checking — see the "Two versions of this page" section in `VISUALIZE.md`.
- **Chat UI vs. pools UI have different visual languages, on purpose**: the chat UI
  (`rag_web.js`'s inline `HTML` template) uses a brutalist black-border/yellow-accent,
  monospace look. The pools visualizer pages use a soft, neutral, sans-serif look
  (light gray blurred blobs, rounded pill buttons) modeled on a product mockup. Don't
  unify these styles unless asked.
- New data sources / swapped embedding models need no visualizer changes — both
  visualizer pages only consume whatever `/embeddings` returns, regardless of what
  produced the vectors.

## No test suite

There isn't one. Verify changes by actually running the flow above (build, serve, open
the relevant page in a browser) rather than looking for a test command to run.
