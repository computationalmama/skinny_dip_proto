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
 * The ask box and the four unwired pills are the exception — arbitrary text
 * needs a live embedding, and that needs a key the browser can't hold.
 */

// esbuild replaces this with a literal, so the unused branch is stripped out.
const STATIC = process.env.SEEDS_STATIC === 'true';

/** The same whitespace collapse the server and provocations.js both apply. */
const flatten = (t) => t.replace(/\s+/g, ' ').trim();

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

export const isStatic = STATIC;
