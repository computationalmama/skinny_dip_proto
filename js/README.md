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
| `seeds/data.js` | Where the canvas gets its data — server or static |
| `seeds/build.mjs` | esbuild config → `static/` (gitignored) |

`seeds/data.js` is the one seam between the canvas and its data. Locally it
calls the Express routes; the Pages build reads exported JSON instead. Which one
is compiled in is a build-time flag, so the unused half is stripped from the
bundle rather than branched on at runtime. See
[Hosting on GitHub Pages](#hosting-on-github-pages).

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

**Clicking a source box** opens its action pills — Find a neighbour, Compare
this, Counterexample, Zoom in, Zoom out, Find evidence — plus an "ask your own
question" box that fires on Enter. Clicking the box again closes them.

**Find a neighbor**, **Counterexample** and **Zoom in** are wired up. The first
two search the vector DB from opposite ends of the same ranking and hang the
results off the box as new boxes, joined by edges carrying the action's pill;
`/neighbors` and `/counterexamples` share one implementation in `searchByCosine`.
**Zoom in** is the agentic one — see [its section](#zoom-in) below.

Running locally, all three go out live on every click; nothing comes from the
pre-computed `sources` column. The hosted build reads precomputed answers
instead, for the reasons in
[Hosting on GitHub Pages](#hosting-on-github-pages).

The collection was built without an `hnsw:space`, so Chroma indexed it with its
default squared-L2, not cosine. The Gemini vectors are unit length, which makes
the two orderings equivalent and the distance exactly convertible — and it's
what makes the farthest search possible at all, since Chroma can only search for
nearest:

    squaredL2(a, v)  = 2 - 2(a·v)   ->  cos = 1 - d/2   (smallest d = nearest)
    squaredL2(a, -v) = 2 + 2(a·v)   ->  cos = d/2 - 1   (smallest d = farthest)

So `Counterexample` searches for the nearest neighbours of the **negated** query
vector. Both directions were checked against brute-force cosine over the whole
collection: same passages, same scores to four decimals.

Caveat on `Counterexample`: farthest-by-cosine finds the most *unrelated*
passage, not a rebuttal. In this corpus that skews toward the degenerate chunks
— captions, bare URLs, fragments. Measured over 12 lookups, 5 came back
degenerate (under 120 chars or a bare URL) against 1 of 12 for the nearest
search.

### Zoom in

The agentic pill. One click, three steps, three boxes:

1. **Plan.** Gemini reads the passage and decides what's worth looking up — the
   topic it's really about, two or three retrieval queries for the corpus, and
   one question to put to the open web. Nothing here is hardcoded; the queries
   are the model's.
2. **Corpus.** Those queries are embedded as `RETRIEVAL_QUERY` and run against
   the vector DB, alongside the passage's own neighbours. Gemini writes up what
   came back as two boxes — `In this corpus` (the passage and its immediate
   surroundings) and `Related threads` (the other threads its queries turned up).
   This step is told to use only the retrieved passages.
3. **Web.** A grounded call answers the web question, and its citations become
   the links on the third box, `On the web`.

The pipeline lives in `zoom.js` and is shared: `/zoom` runs it live, and
`export-static.js --zoom` runs it ahead of time for the hosted build. Generation
goes through `gemini.js` — REST rather than the SDK, which is pinned at 0.1.3
here and predates grounding entirely.

Three things about the Gemini side are worth knowing before changing it.

**A `responseSchema` on a grounded call silently drops the citations.** The model
still searches and the answer is still grounded, but `groundingMetadata` doesn't
come back at all. So the two corpus boxes use structured output and the web box
deliberately doesn't.

**Grounding is a tool the model chooses, not retrieval that happens to it.** On
topics it thinks it knows, it sometimes answers from memory and cites nothing —
about one topic in five. Instructing it harder makes this *worse*, not better: a
prompt saying "you must search, do not answer from memory" grounded 0/1 where a
plain "search the web and answer" grounded 5/5. Asking it to cite is what works,
so that's the retry. If both attempts come back bare, the box is renamed
`Unverified — model recall` and captioned, because an ungrounded answer still
states specific dates and project names — one was wrong in testing — and under
an "On the web" heading that reads as a web finding nobody cited.

**Citation URLs expire.** Grounding returns `vertexaisearch.cloud.google.com`
redirects that stop resolving after roughly a month, which would quietly rot
every link in a static export. `resolveLinks` follows each one and stores the
real destination, so the exported links are permanent.

Costs and timing, measured: 25-50s and three Gemini calls per passage live. A
full `--zoom` export is 283 passages, so budget ~45 minutes and ~900 generation
calls of which ~340 are grounded searches. It resumes — passages already in
`data/zoom.json` are skipped — so an interrupted run only costs what it hadn't
reached, and `--limit N` does a handful at a time.

The other three pills and the ask box are **still inert**. Every one of them
calls `runAction(action, payload)` in `ChunkNode` — the single seam. Adding a
move means a row in `ACTIONS` (id, label, colour) and a branch in `runAction`;
`spawn()` and `actionEdge()` handle placing the results and labelling the edge.
A box carrying a `links` array renders them as green source chips and gets the
roomier prose styling, which is how the zoom boxes differ from a quoted passage.

Because results can spawn results, removing a box takes its whole subtree —
`withDescendants` walks `data.parentId`.

The canvas opens at `DEFAULT_ZOOM` (0.6), set alongside `MIN_ZOOM`/`MAX_ZOOM`
in `app.jsx` — pulled back far enough to hold a card and its whole cascade in
view at once. `1` is 1:1.

The fan cascades down and to the right — `GAP_Y` (305) sets the vertical pitch
and `STAGGER_X` (56) the sideways step. The pitch sits just under a full-height
box on purpose: source boxes are meant to overlap each other a little, and each
one down the fan paints over the one above it. An open action panel overlaps the
box below outright and is lifted clear with z-index rather than the layout being
spread out to make room. `.chunk-body` is capped at `180px` to keep box heights
roughly even down the fan.

The chunk titles are `Source 1..3`. If those should instead be the prompt-style
moves from the mock — Compare this / Find evidence / Counterexample — that's the
`title` field in `onNodeClick`.

**Every box carries an ×** on its top-right corner, revealed on hover — the
shared `CloseButton`, placed by `.box-close`. Removing a box takes its whole
subtree with it (`useRemoveSubtree` → `withDescendants`), so closing a source
box also clears any neighbours it found, and closing the card clears everything.

Hovering a card reveals two controls, both in `CardNode`:

- **×**, centred on the top-right corner — removes the card and its subtree.
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

## Hosting on GitHub Pages

The canvas runs as a fully static site — no server, no ChromaDB, no API key on
the host. One command builds it:

```bash
npm run export:static   # -> ../dist/   (needs Chroma + GOOGLE_API_KEY)
npm run export:zoom     # ...including Zoom in (slow — see below)
npx serve dist          # check it locally first
npm run deploy          # push dist/ to the gh-pages branch
```

`export:zoom` is its own script rather than `export:static -- --zoom`, because
npm appends passed-through args to the end of a `&&` chain, which lands them in
the wrong place often enough not to rely on.

`npm run deploy` runs the plain export and keeps whatever `data/zoom.json`
already holds, so a routine redeploy doesn't re-run the expensive half. Use
`export:zoom` when the corpus has changed.

Then set Pages once, in the repo's **Settings → Pages**, to branch `gh-pages` /
root. After that `npm run deploy` is the whole loop.

`dist/` is gitignored — it's build output, and `deploy.js` pushes it to an
orphan `gh-pages` branch from a temporary worktree, so your working tree is
never touched and `main` stays free of build artifacts.

### What gets exported

| File | From |
| --- | --- |
| `data/provocations.json` | `provocations_with_sources.csv`, parsed — the tray samples its ten in the browser |
| `data/search.json` | The whole cosine ranking, ~140 kB |
| `data/zoom.json` | Zoom in, precomputed per passage — only with `--zoom` |
| `index.html`, `seeds.html` | The same shell, so the bare URL is the share link |
| `static/seeds.{js,css}` | `npm run build:seeds:static` |

### Why the vector search survives the move

Every text the canvas can search is **already a chunk in the collection**.
Source boxes carry `flatten(chunk)` — that's what `provocations.js` writes into
the `sources` column — and result boxes carry `flatten(chunk)` returned by the
search itself. Results can spawn results, but a result is still a chunk. So
there are only 283 possible queries, and `export-static.js` precomputes all of
them: every chunk re-embedded as a `RETRIEVAL_QUERY` (the asymmetry in
`config.google.taskType` is preserved — the matrix diagonal is deliberately not
1), the full 283² cosine matrix, top eight from each end.

Checked against the live endpoints over a sample of the corpus:

- **`Find a neighbor` is identical** — same passages, and the similarity scores
  agree to every one of the four decimals they're rounded to. The only
  divergence found was a genuine tie, two passages at `0.7367`, ordered
  differently by the two code paths.
- **`Counterexample` differs, and the export is the more accurate one.** Chroma
  reaches the farthest passages by searching for the nearest neighbours of the
  *negated* vector, and HNSW's approximation is weak out there — it under-recalls.
  Over 21 sampled queries the export returned a strictly farther top result for
  7 of them and never a nearer one. The export computes exact cosine over the
  whole collection, so the ANN error is gone. Expect the hosted canvas to give
  slightly *better* counterexamples than localhost.

Because the export is keyed on flattened chunk text, it's checked for closure at
build time: all 120 passages across the 40 provocations resolve, and so does
every result any of them can spawn.

**Zoom in rides the same argument.** Its pipeline is agentic — Gemini picks the
queries — so unlike near/far it can't be reduced to a lookup table computed from
vectors alone. But it's still keyed on the passage, and there are still only 283
of those, so `--zoom` runs the real pipeline once per chunk at build time and the
canvas reads the result. The boxes are identical to the live ones; what's lost is
freshness, since the web half is a snapshot from export time rather than from the
moment of the click.

### What can't come along

- **The ask box and the three unwired pills.** Free text needs a live embedding
  and a live model, and that needs a key the browser can't be given. They're
  inert on Pages exactly as they're inert locally, so nothing regresses — but
  wiring them up later means either asking each visitor for their own Gemini key
  or putting a small proxy in front.
- **The `/` chat page.** It generates with local Ollama. Not hostable.
- **The `visualize-*.html` pages.** They pull `/embeddings` live. Exportable the
  same way if wanted (~3.5 MB of vectors, or ~870 kB truncated to 768 dims), but
  out of scope here.

### Re-exporting

Anything that changes the corpus or the provocations needs a fresh export —
`npm run export:static` re-embeds all 283 chunks, so it costs a little Gemini
quota each time:

```bash
node rag_web.js build                  # corpus changed
node provocations.js                   # provocations.csv changed
npm run export:zoom                    # new chunks need zoom data too
npm run deploy
```

New chunks shift every index, so a corpus change invalidates `data/zoom.json`
wholesale — the export notices the length mismatch and starts it over rather
than mapping old answers onto new passages.

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
