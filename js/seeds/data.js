/**
 * Where the canvas gets its data.
 *
 * Two modes, chosen at build time by `SEEDS_STATIC` (see build.mjs):
 *
 *   server — fetches the live Express routes, which query ChromaDB. Local dev.
 *   static — reads JSON files written by `node export-static.js`. GitHub Pages.
 *
 * The static mode is a complete substitute rather than a degraded one for the
 * two cosine searches, because every text the canvas can search is *already* a
 * chunk in the collection: source-box text comes from the `sources` column,
 * which provocations.js writes as `flatten(chunk)`, and result-box text comes
 * back from the search as `flatten(chunk)` too. There are only 283 possible
 * queries, so all of them are precomputed and the answers are identical.
 *
 * Zoom in works the same way, for the same reason — the pipeline is agentic and
 * slow (25-40s live), so the export runs it ahead of time per chunk and the
 * hosted canvas reads the result.
 *
 * The ask box and the three still-unwired pills are the exception — arbitrary
 * text needs a live embedding and a live model, and that needs a key the browser
 * can't hold.
 */

// esbuild replaces this with a literal, so the unused branch is stripped out.
const STATIC = process.env.SEEDS_STATIC === 'true';

/** The same whitespace collapse the server and provocations.js both apply. */
const flatten = (t) => t.replace(/\s+/g, ' ').trim();

async function getBinary(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Float32Array(await res.arrayBuffer());
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Uniform sample without disturbing the source order. */
function sample(rows, n) {
  if (!n || n >= rows.length) return rows;
  const pool = [...rows];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

// ── Provocations ──────────────────────────────────────────────────────────────

export async function loadProvocations(n) {
  if (!STATIC) return getJSON(`/provocations?n=${n}`);

  // Sampled here rather than at export time so a reload still gives a new ten.
  return sample(await getJSON('data/provocations.json'), n);
}

// ── Cosine search ─────────────────────────────────────────────────────────────

// Fetched once and kept — it's the whole search index, and every click reads it.
let indexPromise = null;

function searchIndex() {
  indexPromise ??= getJSON('data/search.json').then((data) => ({
    ...data,
    // Chunk texts are exported already flattened, so they are their own keys.
    byText: new Map(data.chunks.map((c, i) => [c.text, i])),
  }));
  return indexPromise;
}

/**
 * Passages nearest to, or farthest from, `text`.
 *
 * `direction` is 'near' or 'far'. Returns `{ text, file, similarity }[]`,
 * highest similarity first for 'near', lowest first for 'far' — matching what
 * /neighbors and /counterexamples return.
 */
export async function searchPassage(text, direction, n) {
  if (!STATIC) {
    const route = direction === 'far' ? 'counterexamples' : 'neighbors';
    return getJSON(`/${route}?text=${encodeURIComponent(text)}&n=${n}`);
  }

  const index = await searchIndex();
  const i = index.byText.get(flatten(text));
  if (i === undefined) {
    throw new Error('That passage is not in the exported index — re-run the export.');
  }

  const ranked = direction === 'far' ? index.far[i] : index.near[i];
  return ranked.slice(0, n).map(([j, similarity]) => ({
    text: index.chunks[j].text,
    file: index.chunks[j].file,
    similarity,
  }));
}

// ── Zoom in ───────────────────────────────────────────────────────────────────

let zoomPromise = null;

function zoomIndex() {
  zoomPromise ??= getJSON('data/zoom.json');
  return zoomPromise;
}

/**
 * The boxes behind the Zoom in / Zoom out pills: two from the corpus, one from
 * the web. `mode` is 'in' (deepen) or 'out' (situate).
 *
 * Live, this is a 25-50s round trip through Gemini. Static, it's a lookup into
 * the export — same boxes, computed at build time.
 */
export async function zoom(text, mode = 'in') {
  if (!STATIC) return getJSON(`/zoom?mode=${mode}&text=${encodeURIComponent(text)}`);

  const [index, data] = await Promise.all([searchIndex(), zoomIndex()]);
  const i = index.byText.get(flatten(text));
  if (i === undefined) {
    throw new Error('That passage is not in the exported index — re-run the export.');
  }

  // `modes` is the two-mode shape; `boxes` is the older single-mode file, which
  // held zoom-in only. Read both, so a deploy that lands before the next export
  // still serves whatever zoom-in data is already published.
  const rows = data.modes?.[mode] || (mode === 'in' ? data.boxes : null);
  const boxes = rows?.[i];
  if (!boxes?.length) {
    // A partial export is a normal state — it runs for the better part of an
    // hour per mode — so this is worded for whoever is reading the canvas, not
    // for whoever runs the export.
    throw new Error("This passage hasn't been zoomed yet. Try another one.");
  }
  return boxes;
}

// ── Ask box ───────────────────────────────────────────────────────────────────

let askIndexPromise = null;

/**
 * What the live ask box needs: the Worker URL, and the vectors to search.
 *
 * Both are fetched only when someone actually asks something — the vectors are
 * ~850 kB, and most visits never type a question.
 */
function askIndex() {
  askIndexPromise ??= (async () => {
    const config = await getJSON('data/config.json');
    const dims = config.vectorDims || 768;
    const [index, vectors] = await Promise.all([
      searchIndex(),
      getBinary(`data/vectors-${dims}.bin`),
    ]);
    return { proxy: config.proxy, index: { vectors, dims, chunks: index.chunks } };
  })();
  return askIndexPromise;
}

/**
 * Answer a typed question about `passage`.
 *
 * The only move that runs live in both builds. Locally it goes through the
 * server, which already holds the key; hosted it goes through the Cloudflare
 * Worker and does its retrieval in the browser. See seeds/ask.js.
 */
export async function askQuestion(passage, question) {
  if (!STATIC) {
    return getJSON(`/ask-passage?text=${encodeURIComponent(passage)}` +
                   `&q=${encodeURIComponent(question)}`);
  }

  const { askQuestion: run } = await import('./ask.js');
  const { proxy, index } = await askIndex();
  return run({ passage, question, proxy, index });
}

export const isStatic = STATIC;
