# The Pools Visualizer — Explainer

`visualize.html` draws the vector database as a picture instead of a list. Every chunk of
text we've indexed lives somewhere in a 768-number "space" (its embedding). Chunks with
similar meaning sit close together in that space. This page groups the nearby chunks into
blobs ("pools"), gives each blob a short label, and draws it on screen — so instead of
seeing 51 rows of data, you see a handful of topics.

Open it at **http://localhost:6601/visualize.html** (after `chroma run` and
`node rag_web.js serve` are both running — see the main `README.md`).

## The pipeline, in plain words

```
Chroma DB  →  /embeddings route  →  group similar chunks  →  name each group  →  spread them out  →  draw
```

1. **Fetch the data.** The page asks the server (`GET /embeddings`, added in `rag_web.js`)
   for every chunk's text, source PDF, and its embedding (a list of 768 numbers).

2. **Group similar chunks (clustering).** We don't know ahead of time what the "topics"
   are — so we let the numbers tell us. The code compares every chunk's embedding to
   every other one and groups the ones that are numerically close, into `k` groups
   (`k` is auto-picked from how many chunks there are — right now that's 5 or 6 groups
   for ~50 chunks). This is a classic technique called **k-means**. Think of it like
   sorting a pile of photos into stacks by "how similar they look," except a computer is
   doing the sorting by comparing numbers instead of eyes.

   How "similar" is measured: **cosine similarity** — it checks whether two
   embeddings point in the same direction, ignoring how "long" the vector is. 1.0 means
   identical direction, 0 means unrelated, negative means opposite. This is the standard
   way to compare text embeddings.

3. **Name each group (labeling).** Each pool needs a label like "SLOW AI" in the
   screenshot we based this on. We don't call any AI for this — we just take all the
   text in that group, strip out common words ("the", "with", "because", etc. — the
   `STOPWORDS` list), and pick the two words that show up most often. It's rough but
   free and fast, since with only two source PDFs there isn't much to summarize.

4. **Spread the pools out (layout).** We want pools that are similar to each other to
   land near each other on screen, and all pools to have breathing room so labels don't
   overlap. This is done with a tiny physics simulation: every pool pushes every other
   pool away (like magnets with the same pole), but pools that are similar also pull
   toward each other a bit. Run that tug-of-war a few hundred times and it settles into
   a stable, readable layout. This is the same basic idea behind any "network graph" or
   "mind map" tool you've seen.

5. **Draw it.** Each pool is drawn as several soft, blurred, overlapping circles (that's
   what makes it look like a "cloud" instead of a hard circle), with its label on top.
   Lines are drawn between pools that are similar. Then you can drag to pan and
   scroll/click +/− to zoom.

## Where things live in the code (`visualize.html`)

| What | Function | Roughly |
|---|---|---|
| Fetch data from the server | `loadData()` | Runs once when the page loads |
| "How similar are these two chunks?" | `cosineSim()` | The core math primitive everything else uses |
| Group chunks into pools | `kmeans()` | The clustering step |
| Pick a label for a pool | `extractLabel()` | The word-frequency-counting step |
| Turn clusters into pools + lay them out | `buildPools()` | Groups chunks, decides which pools connect, runs the physics simulation |
| Draw everything, every frame | `draw()` | Runs ~60 times a second — lines, then blurred blobs, then labels |
| Pan / zoom | `mouseDragged()`, `mouseWheel()`, the +/− buttons | Just move `panX`/`panY`/`zoom` — everything redraws using those |

## Common things you might want to change

- **More or fewer pools:** line ~170, the `k = ...` formula. Hard-code a number instead
  (e.g. `const k = 4;`) if you want a fixed pool count regardless of how much data there is.
- **Better/worse labels:** edit the `STOPWORDS` list near the top, or change
  `extractLabel()` to keep more/fewer words (currently top 2).
- **How "spread out" pools are:** the `300` (simulation steps), `30000` (push strength),
  and `220` (target distance) numbers inside `buildPools()`. Bigger push strength = more
  spread out; bigger target distance = pools sit farther apart even when similar.
- **Which pools get a connecting line:** the `sim > 0.3` check in `buildPools()` — raise it
  to show fewer, stronger connections; lower it to show more.
- **Blob look:** `blur(16px)` and the `fill(70, 70, 70, 70)` color/opacity inside `draw()`.
- **Colors, fonts, the top bar, zoom buttons:** all in the `<style>` block at the top —
  regular CSS, nothing p5-specific.
- **New data source (e.g. swapping the embedding model, or adding a cloud collection):**
  nothing here needs to change — the page only cares about whatever vectors `/embeddings`
  hands it, regardless of what produced them.

## Two versions of this page

There are two files that show the exact same pools, built from the exact same
`/embeddings` data and the exact same clustering/labeling logic — they just draw it
differently:

- **`visualize.html`** — http://localhost:6601/visualize.html — built with **p5.js** and
  a plain `<canvas>`. Pan/zoom/blur/layout are all hand-rolled (see above).
- **`visualize-d3.html`** — http://localhost:6601/visualize-d3.html — built with **D3.js**
  and SVG instead of canvas. Same pools, but layout uses D3's built-in
  `d3.forceSimulation` (a proper physics engine for exactly this kind of "push apart,
  pull together" layout — no hand-rolled physics needed), pan/zoom uses D3's built-in
  `d3.zoom()`, and the blur is an SVG filter (`feGaussianBlur`) instead of a canvas trick.
  It also animates into place when it loads, since D3's simulation runs live instead of
  being pre-settled before the first draw.

Both pages support hover tooltips and click-to-read (clicking a pool opens the same
side panel with every chunk's text). Pick whichever is easier for the team to extend —
D3's version has less custom math to maintain (the layout and zoom are library-provided),
while the p5 version has simpler, more explicit code if you'd rather see every step spelled
out.

## Things it does *not* do (yet)

- The `+ UPLOAD` button is a placeholder — it doesn't index anything. Real uploads still
  go through `node rag_web.js build`.
- It doesn't show individual chunks — only pools. Clicking/hovering a pool only tells you
  its chunk count and dominant source PDF, not the actual text. Adding a "click to see the
  chunks in this pool" panel would be a natural next step if the team wants it.
- Clustering re-runs (with a bit of randomness) every time you reload the page, so pool
  shapes and exact positions can shift slightly between reloads — the *groupings*
  themselves stay meaningfully consistent since they're driven by the actual embeddings,
  just the layout/labels can vary a little.
