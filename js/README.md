# JavaScript Version

## Requirements

- Node.js 18+
- Python + ChromaDB (for the vector database server)
- [Ollama](https://ollama.com/download) installed and running

## Setup

```bash
# 1. Pull Ollama models
ollama pull nomic-embed-text
ollama pull qwen2.5:7b

# 2. Install ChromaDB (Python package — provides the database server)
python -m venv venv
pip install chromadb
chroma run --path ./rag_database

# 3. Install Node dependencies
cd js
npm install
```
## Test here

You can test the visualizations here: http://localhost:6601/visualize-d3.html 

## Starting ChromaDB

The JS version connects to ChromaDB running as a local HTTP server.
You need to start it in a separate terminal before running any commands:

```bash
# Run this from the project root (skinny_dip_proto/)
source venv/bin/activate
chroma run --path ./rag_database
```

Leave this terminal running. ChromaDB listens on `http://localhost:8000`.

> **Why?** The Python version embeds ChromaDB directly in-process.
> The JavaScript client doesn't support embedded mode — it connects over HTTP instead.

## Usage

Open a second terminal in the `js/` folder.

### Build the database

Drop PDFs into `../docs/` first, then:

```bash
node rag_web.js build   # for web version
node rag.js build       # for CLI version
```

### Web interface

```bash
node rag_web.js serve
```

Open `http://localhost:6601` in your browser.

### CLI — interactive mode

```bash
node rag.js
```

### CLI — single question

```bash
node rag.js ask "what is this document about?"
```

### CLI — check database stats

```bash
node rag.js stats
```

### Seeds canvas

An infinite canvas with a tray of ten random provocations on the right. Drag a
seed out of the tray and it becomes a card on the canvas.

```bash
npm run build:seeds   # once, and after editing seeds/app.jsx
node rag_web.js serve
```

Open `http://localhost:6601/seeds.html`.

Built on [React Flow](https://reactflow.dev) — it supplies the pan/zoom canvas,
the dot grid, the zoom controls, and node dragging.

| Path | What it is |
| --- | --- |
| `seeds.html` | Shell page — loads the bundle, nothing else |
| `seeds/app.jsx` | The canvas and tray. **Edit this one.** |
| `seeds/seeds.css` | Tray, card, and React Flow styling |
| `seeds/build.mjs` | esbuild config → `static/` (gitignored) |

`npm run watch:seeds` rebuilds on save.

The cards come from `/provocations`, which reads `provocations_with_sources.csv`
(falling back to `provocations.csv`) and returns a random sample with `?n=10`.
`parseSources` in `csv.js` splits each `sources` cell back into `{ file,
passages[] }` server-side — splitting on the full `" | "` sequence rather than a
bare pipe, so passages containing a stray quote or pipe survive intact — and the
canvas gets structured data rather than a string to pick apart.

**Clicking a card** fans its three retrieved passages out to the right as
bordered chunk cards, joined by curved arrows. Clicking it again puts them away;
removing the card takes its chunks and edges with it. Each chunk card carries a
`Source` chip naming the document, plus a second mint `Source` chip linking out
whenever that passage quotes a URL inline (only three passages in the current
corpus do).

The chunk titles are `Source 1..3`. If those should instead be the prompt-style
moves from the mock — Compare this / Find evidence / Counterexample — that's the
`title` field in `onNodeClick`.

Hovering a card reveals two controls, both in `CardNode`:

- **×**, centred on the top-right corner — removes the card from the canvas.
- **Expand**, a pill on the bottom edge — reveals that provocation's retrieved
  source passages beneath a divider. The passages are capped at `260px` and
  scroll, so a card can't grow tall enough to push its own Collapse button
  offscreen.

Every card uses one type size (`.card-text`, 30px) whatever the text length —
a long quote grows the card downward rather than shrinking to fit, so a canvas
full of cards reads as a single weight. Short text sits at the bottom of the
`345px` minimum; long text fills and grows past it.

Two more behaviours worth knowing, both one-liners in `seeds/app.jsx`:

- A seed is **removed from the tray** once dropped. Delete the `setSeeds(...)`
  filter in `onDrop` to let seeds be dragged out more than once.
- The tray is refilled only on reload, so the ten change every refresh.

### Provocation sources

Runs every row of `provocations.csv` through the retriever and writes
`provocations_with_sources.csv` with an added `sources` column holding the
source document and the passages that matched:

```bash
node provocations.js               # or: node provocations.js in.csv out.csv
```

Retrieval only — no LLM generation, since the sources come straight from the
returned chunks. Needs ChromaDB running, same as everything else.

## Running order (summary)

```
Terminal 1: chroma run --path ./rag_database   ← keep running
Terminal 2: node rag_web.js build              ← run once
Terminal 2: node rag_web.js serve              ← start the app
```

## Customization

### Change the model

In `rag.js` or `rag_web.js`, at the top of the file:

```js
const LLM_MODEL = 'llama3.2:1b';   // faster, less accurate
const LLM_MODEL = 'llama3.1:8b';   // slower, more accurate
```

### Change chunk size

```js
const CHUNK_SIZE    = 500;
const CHUNK_OVERLAP = 50;
```

### Change number of retrieved chunks

```js
const results = await collection.query({
  queryEmbeddings: [res.embedding],
  nResults: 3,   // increase to pull more context
});
```

### Change the port

```js
const PORT = 6601;
```

## Troubleshooting

**"Connection refused" or ChromaDB errors**

ChromaDB server isn't running. Start it first:
```bash
chroma run --path ./rag_database
```

**"No database found"**
```bash
node rag_web.js build
```

**The page still shows the old build after `npm run build:seeds`**

Hard-reload once (Cmd+Shift+R). The server sends `Cache-Control: no-cache` on
`/static` and `seeds.html` so this shouldn't recur, but a tab that was already
open before that header existed can still be holding a stale bundle in Chrome's
memory cache.

**Port already in use**
```bash
lsof -i :6601        # Mac/Linux
netstat -ano | findstr :6601   # Windows
```

**`No matching export ... handleAttributionWarning` when building seeds**

`@xyflow/react` is pinned to an exact `12.11.2` in `package.json`. Versions
12.11.3 and 12.11.4 import a symbol that `@xyflow/system@0.0.80` doesn't
export, so they fail to bundle. Don't loosen it to a caret range without
checking that upstream has published a matching `@xyflow/system`.

**Slow responses**
- Switch to a smaller model
- Reduce `nResults` in the query
- Check Ollama is using GPU: `ollama ps`
