#!/usr/bin/env node
/**
 * Export the seeds canvas as a static site.
 *
 * Writes ../dist/, which is everything GitHub Pages needs: the page, the
 * bundle, and the data the canvas used to ask the server for.
 *
 *   node export-static.js                  # or: npm run export:static
 *   node export-static.js --zoom           # also precompute the Zoom in pill
 *   node export-static.js --zoom --limit 5 # ...for the first 5 chunks only
 *
 * Needs ChromaDB running and GOOGLE_API_KEY set, same as build.
 *
 * `--zoom` is separate because it is the expensive half: three Gemini calls per
 * chunk per mode, one of them a grounded web search, and there are two modes
 * (Zoom in and Zoom out). It resumes rather than restarting — anything already
 * in data/zoom.json is left alone — so an interrupted run costs only what it
 * hadn't finished. `--zoom-mode in|out` does one mode at a time.
 *
 * ── Why the search can be precomputed ────────────────────────────────────────
 *
 * Every text the canvas can search is already a chunk in the collection. Source
 * boxes carry `flatten(chunk)` written by provocations.js into the `sources`
 * column; result boxes carry `flatten(chunk)` returned by the search itself.
 * Results spawn results, but a result is still a chunk. So there are only as
 * many possible queries as there are chunks, and all of them fit in one file.
 *
 * Retrieval is asymmetric (see config.google.taskType): the stored vectors are
 * RETRIEVAL_DOCUMENT, and a query is embedded as RETRIEVAL_QUERY. So every
 * chunk is re-embedded here as a *query* — the diagonal of the resulting matrix
 * is not 1, and that is correct rather than a bug.
 *
 * The server converts Chroma's squared-L2 distance to cosine assuming unit
 * vectors. Here cosine is computed directly from explicitly normalized vectors,
 * which is the same number for unit input and right regardless.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChromaClient } from 'chromadb';
import { config } from './config.js';
import { createEmbeddingFunction, usesChromaEmbeddingFunction, generateEmbedding } from './embeddings.js';
import { readProvocations } from './csv.js';
import { zoomIn, zoomOut } from './zoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PROVOCATIONS     = path.join(ROOT, 'provocations.csv');
const PROVOCATIONS_SRC = path.join(ROOT, 'provocations_with_sources.csv');

// The server clamps `n` to 1..8, so eight each way covers every request it
// could serve. RESULT_COUNT in app.jsx is 2 today.
const TOP_K = 8;
const BATCH = 100;   // Google caps batchEmbedContents at 100 per call

// Zoom is ~30s and 3 Gemini calls per chunk, so it runs concurrently. Kept low
// deliberately: the grounded search is the rate-limited endpoint of the three.
const ZOOM_CONCURRENCY = 5;

const wantZoom = process.argv.includes('--zoom');
const limitArg = process.argv.indexOf('--limit');
const zoomLimit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const modeArg = process.argv.indexOf('--zoom-mode');
const ZOOM_FNS = { in: zoomIn, out: zoomOut };
const zoomModes = modeArg > -1 && ZOOM_FNS[process.argv[modeArg + 1]]
  ? [process.argv[modeArg + 1]]
  : Object.keys(ZOOM_FNS);

const flatten = (t) => t.replace(/\s+/g, ' ').trim();

// ── Vector helpers ────────────────────────────────────────────────────────────

function normalize(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum);
  if (!len) return Float64Array.from(v);
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / len;
  return out;
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function readCollection() {
  const chroma = new ChromaClient();
  const collectionConfig = { name: 'docs' };
  if (usesChromaEmbeddingFunction()) {
    collectionConfig.embeddingFunction = createEmbeddingFunction(config.google.taskType.indexing);
  }

  const col = await chroma.getCollection(collectionConfig);
  const data = await col.get({ include: ['embeddings', 'documents', 'metadatas'] });

  if (!data.ids.length) throw new Error('Collection "docs" is empty. Run: node rag_web.js build');

  return data.ids.map((id, i) => ({
    id,
    text: flatten(data.documents[i]),
    file: data.metadatas[i]?.source || '',
    vector: normalize(data.embeddings[i]),
  }));
}

/** Re-embed every chunk as a QUERY, which is the side the search asks from. */
async function queryVectors(texts) {
  if (!usesChromaEmbeddingFunction()) {
    const out = [];
    for (const text of texts) out.push(normalize(await generateEmbedding(text)));
    return out;
  }

  const embed = createEmbeddingFunction(config.google.taskType.querying);
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = await embed.generate(texts.slice(i, i + BATCH));
    out.push(...batch.map(normalize));
    process.stdout.write(`  embedded ${Math.min(i + BATCH, texts.length)} / ${texts.length}\r`);
  }
  console.log();
  return out;
}

/**
 * Full cosine ranking, top TOP_K from each end.
 *
 * Self-exclusion matches the server exactly: it drops any candidate whose
 * flattened text equals the query's, case-insensitively — by text rather than
 * by id, so a chunk duplicated in the corpus drops all its copies.
 */
function rank(chunks, queries) {
  const keys = chunks.map((c) => c.text.toLowerCase());
  const near = [];
  const far = [];

  for (let i = 0; i < chunks.length; i++) {
    const scored = [];
    for (let j = 0; j < chunks.length; j++) {
      if (keys[j] === keys[i]) continue;
      scored.push([j, Number(dot(queries[i], chunks[j].vector).toFixed(4))]);
    }

    scored.sort((a, b) => b[1] - a[1]);
    near.push(scored.slice(0, TOP_K));
    far.push(scored.slice(-TOP_K).reverse());   // least similar first
  }

  return { near, far };
}

/** Every passage on a card must resolve to a chunk, or its box can't search. */
function checkPassages(provocations, chunks) {
  const known = new Set(chunks.map((c) => c.text));
  const misses = [];

  for (const p of provocations) {
    for (const passage of p.passages) {
      if (!known.has(flatten(passage.text))) misses.push(passage.text);
    }
  }
  return misses;
}

/**
 * The bundle is built by a separate step, so it can silently be older than the
 * data written beside it — which looks like the export didn't work rather than
 * like the page is stale. Running through npm gets this right; running this file
 * directly, as its own usage line suggests, does not.
 */
function checkBundle() {
  const bundle = path.join(DIST, 'static/seeds.js');
  const sources = ['seeds/app.jsx', 'seeds/data.js', 'seeds/seeds.css']
    .map((f) => path.join(__dirname, f))
    .filter((f) => fs.existsSync(f));

  if (!fs.existsSync(bundle)) {
    console.log('! No dist/static/seeds.js yet — run: npm run build:seeds:static');
    return;
  }

  const built = fs.statSync(bundle).mtimeMs;
  const stale = sources.filter((f) => fs.statSync(f).mtimeMs > built);
  if (stale.length) {
    console.log(`! dist/static/seeds.js is older than ${stale.map((f) => path.basename(f)).join(', ')}`);
    console.log('  Run: npm run build:seeds:static   (npm run export:static does this for you)');
  }
}

const write = (rel, body, { quiet = false } = {}) => {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (quiet) return;
  const kb = (Buffer.byteLength(body) / 1024).toFixed(1);
  console.log(`  dist/${rel}  ${kb} kB`);
};

// ── Zoom ──────────────────────────────────────────────────────────────────────

/**
 * Exact-cosine retrieval over the vectors already in memory.
 *
 * The zoom planner invents its own queries, so unlike the near/far tables these
 * lookups can't be precomputed — each query is embedded here and scored against
 * the whole collection. Exact rather than Chroma's ANN, for the same reason the
 * far table is.
 */
function makeSearch(chunks) {
  const embed = createEmbeddingFunction(config.google.taskType.querying);

  return async (query, n) => {
    const [raw] = await embed.generate([query]);
    const v = normalize(raw);

    return chunks
      .map((c, i) => ({ i, score: dot(v, c.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(({ i }) => ({ text: chunks[i].text, file: chunks[i].file }));
  };
}

/**
 * Whatever previous runs finished, so this one only pays for the rest.
 *
 * Reads the old single-mode shape (`{ boxes: [...] }`, written before Zoom out
 * existed) as the `in` mode rather than discarding it — that file is an hour of
 * API spend, and the zoom-in boxes in it are still exactly what zoom-in
 * produces.
 */
function loadExistingZoom(count) {
  const empty = () => Object.fromEntries(Object.keys(ZOOM_FNS).map((m) => [m, new Array(count).fill(null)]));
  const file = path.join(DIST, 'data/zoom.json');
  if (!fs.existsSync(file)) return empty();

  const store = empty();
  try {
    const prior = JSON.parse(fs.readFileSync(file, 'utf8'));

    // Old shape: one unlabelled array, which was zoom-in.
    const legacy = Array.isArray(prior?.boxes) ? { in: prior.boxes } : null;
    const modes = legacy || prior?.modes || {};

    let carried = 0;
    for (const mode of Object.keys(store)) {
      const rows = modes[mode];
      if (!Array.isArray(rows)) continue;
      if (rows.length !== count) {
        console.log(`  (existing ${mode} data does not match the collection — starting it over)`);
        continue;
      }
      store[mode] = rows;
      carried += rows.filter(Boolean).length;
    }
    if (legacy && carried) console.log(`  (carried ${carried} pre-existing zoom-in results forward)`);
  } catch {
    console.log('  (existing zoom.json is unreadable — starting over)');
  }
  return store;
}

/** Fixed pool of workers pulling from a shared queue. */
async function runPool(tasks, size, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) await worker(tasks[next++]);
  });
  await Promise.all(runners);
}

async function precomputeZoom(chunks) {
  const store = loadExistingZoom(chunks.length);
  const search = makeSearch(chunks);

  // One flat work list across both modes, so the pool stays saturated rather
  // than draining at each mode boundary.
  const todo = [];
  for (const mode of zoomModes) {
    for (let i = 0; i < chunks.length; i++) if (!store[mode][i]) todo.push({ mode, i });
  }
  const work = todo.slice(0, zoomLimit);

  const done = zoomModes.map((m) => `${m}: ${store[m].filter(Boolean).length}/${chunks.length}`).join(', ');
  console.log(`  have ${done}`);
  console.log(`  ${work.length} to go` +
              (work.length < todo.length ? ` of ${todo.length} outstanding (--limit ${zoomLimit})` : ''));
  if (!work.length) return store;

  // Written after every completion, so killing the run keeps the work.
  const save = () => write('data/zoom.json', JSON.stringify({ modes: store }), { quiet: true });

  let finished = 0;
  const failures = [];
  await runPool(work, ZOOM_CONCURRENCY, async ({ mode, i }) => {
    try {
      const { boxes } = await ZOOM_FNS[mode](chunks[i].text, search);
      store[mode][i] = boxes;
      save();
    } catch (e) {
      failures.push(`${mode}/${i}`);
      console.log(`\n  ! ${mode} chunk ${i}: ${e.message}`);
    }
    process.stdout.write(`  zoomed ${++finished} / ${work.length}\r`);
  });

  console.log(`\n  ${finished - failures.length} succeeded, ${failures.length} failed` +
              (failures.length ? ' — rerun with --zoom to retry just those' : ''));
  return store;
}

// ── Main ──────────────────────────────────────────────────────────────────────

checkBundle();

console.log('Reading collection "docs"…');
const chunks = await readCollection();
console.log(`  ${chunks.length} chunks, ${chunks[0].vector.length} dims`);

console.log(`Re-embedding as ${config.google.taskType.querying}…`);
const queries = await queryVectors(chunks.map((c) => c.text));

console.log(`Ranking ${chunks.length}² pairs…`);
const { near, far } = rank(chunks, queries);

const provocations = readProvocations(PROVOCATIONS_SRC, PROVOCATIONS);
const misses = checkPassages(provocations, chunks);
console.log(`${provocations.length} provocations, ${misses.length} passage(s) not found in the collection`);
for (const m of misses.slice(0, 5)) console.log(`  ! ${m.slice(0, 90)}…`);

console.log('Writing dist/…');
write('data/provocations.json', JSON.stringify(provocations));
write('data/search.json', JSON.stringify({
  built: 'node export-static.js',
  chunks: chunks.map((c) => ({ text: c.text, file: c.file })),
  near,
  far,
}));

if (wantZoom) {
  console.log(`Precomputing zoom [${zoomModes.join(', ')}] — 3 Gemini calls per chunk per mode…`);
  const store = await precomputeZoom(chunks);
  write('data/zoom.json', JSON.stringify({ modes: store }));

  for (const mode of Object.keys(store)) {
    const filled = store[mode].filter(Boolean);
    const ungrounded = filled.filter((b) => b.some((x) => x.kind === 'web' && !x.grounded)).length;
    console.log(`  ${mode}: ${filled.length} / ${chunks.length} chunks` +
                `, ${ungrounded} whose web box returned no citations`);
  }
} else if (fs.existsSync(path.join(DIST, 'data/zoom.json'))) {
  console.log('Keeping the existing data/zoom.json (pass --zoom to refresh it).');
}

// Pages serves the site from a subdirectory, so the shell's asset paths are
// relative. index.html is the same page — it makes the bare URL the share link.
const shell = fs.readFileSync(path.join(__dirname, 'seeds.html'), 'utf8');
write('index.html', shell);
write('seeds.html', shell);

// Without this, Pages runs Jekyll, which ignores directories it doesn't like.
write('.nojekyll', '');

console.log('\nDone. Serve it locally with:\n  npx serve dist\n');
