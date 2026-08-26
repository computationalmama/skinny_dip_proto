#!/usr/bin/env node
/**
 * Export the seeds canvas as a static site.
 *
 * Writes ../dist/, which is everything GitHub Pages needs: the page, the
 * bundle, and the data the canvas used to ask the server for.
 *
 *   node export-static.js          # or: npm run export:static
 *
 * Needs ChromaDB running and GOOGLE_API_KEY set, same as build.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PROVOCATIONS     = path.join(ROOT, 'provocations.csv');
const PROVOCATIONS_SRC = path.join(ROOT, 'provocations_with_sources.csv');

// The server clamps `n` to 1..8, so eight each way covers every request it
// could serve. RESULT_COUNT in app.jsx is 2 today.
const TOP_K = 8;
const BATCH = 100;   // Google caps batchEmbedContents at 100 per call

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

const write = (rel, body) => {
  const file = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const kb = (Buffer.byteLength(body) / 1024).toFixed(1);
  console.log(`  dist/${rel}  ${kb} kB`);
};

// ── Main ──────────────────────────────────────────────────────────────────────

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

// Pages serves the site from a subdirectory, so the shell's asset paths are
// relative. index.html is the same page — it makes the bare URL the share link.
const shell = fs.readFileSync(path.join(__dirname, 'seeds.html'), 'utf8');
write('index.html', shell);
write('seeds.html', shell);

// Without this, Pages runs Jekyll, which ignores directories it doesn't like.
write('.nojekyll', '');

console.log('\nDone. Serve it locally with:\n  npx serve dist\n');
