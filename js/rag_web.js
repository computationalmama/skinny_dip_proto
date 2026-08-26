#!/usr/bin/env node
/**
 * Simple Local RAG - Web version
 * Requires: chroma run --path ../rag_database (in a separate terminal)
 */

import express from 'express';
import { ChromaClient } from 'chromadb';
import { Ollama } from 'ollama';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import {
  createEmbeddingFunction,
  generateEmbedding,
  usesChromaEmbeddingFunction,
  getEmbeddingInfo,
} from './embeddings.js';
import { findDocuments, parseDocument } from './parsers.js';
import { chunkText, getChunkingInfo } from './chunking.js';
import { readProvocations } from './csv.js';
import { zoomIn } from './zoom.js';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DOCS_PATH   = path.resolve(__dirname, '../docs');
const PROVOCATIONS      = path.resolve(__dirname, '../provocations.csv');
const PROVOCATIONS_SRC  = path.resolve(__dirname, '../provocations_with_sources.csv');
const PORT        = Number(process.env.PORT) || 6601;

const ollama = new Ollama();
const chroma = new ChromaClient();

// Two embedding functions, because retrieval is asymmetric: chunks are embedded
// as documents, questions as queries. See config.google.taskType.
const indexEmbeddingFunction = createEmbeddingFunction(config.google.taskType.indexing);
const queryEmbeddingFunction = createEmbeddingFunction(config.google.taskType.querying);

const app    = express();
app.use(express.json());

// ── RAG logic ─────────────────────────────────────────────────────────────────

async function build() {
  const documents = findDocuments(DOCS_PATH);
  if (!documents.length) {
    console.log(`No documents found in ${DOCS_PATH}`);
    console.log(`Supported formats: .pdf, .md, .txt, .jsonl`);
    return false;
  }

  // Count by type
  const typeCounts = {};
  documents.forEach(doc => {
    typeCounts[doc.type] = (typeCounts[doc.type] || 0) + 1;
  });

  console.log(`Found ${documents.length} document(s):`);
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  - ${count} ${type.toUpperCase()} file(s)`);
  });
  console.log(`Using embeddings: ${getEmbeddingInfo()}`);
  console.log(`Chunking strategy: ${getChunkingInfo()}`);
  console.log('Parsing...');

  const chunks = [];
  for (const doc of documents) {
    try {
      const text = await parseDocument(doc.path);
      if (!text || !text.trim()) {
        console.warn(`  Skipping ${doc.name} - no text content`);
        continue;
      }

      // Use smart chunking with file type awareness
      const docChunks = chunkText(text, doc.type);
      for (const chunk of docChunks) {
        chunks.push({ text: chunk, source: doc.name });
      }
      console.log(`  ✓ ${doc.name} (${doc.type}) - ${docChunks.length} chunks`);
    } catch (error) {
      console.error(`  ✗ ${doc.name} - ${error.message}`);
    }
  }

  if (!chunks.length) {
    console.log('No text content extracted from documents.');
    return false;
  }

  console.log(`Split into ${chunks.length} chunks. Embedding...`);

  const ids        = [];
  const chunkTexts = [];
  const metadatas  = [];

  for (let i = 0; i < chunks.length; i++) {
    const { text, source } = chunks[i];
    ids.push(`chunk_${i}`);
    chunkTexts.push(text);
    metadatas.push({ source });
  }

  try { await chroma.deleteCollection({ name: 'docs' }); } catch {}

  // Create collection with embedding function if using OpenAI/Google
  const collectionConfig = { name: 'docs' };
  if (usesChromaEmbeddingFunction()) {
    collectionConfig.embeddingFunction = indexEmbeddingFunction;
  }
  const col = await chroma.createCollection(collectionConfig);

  // For Ollama, we need to generate embeddings manually
  if (!usesChromaEmbeddingFunction()) {
    const embeddings = [];
    for (let i = 0; i < chunkTexts.length; i++) {
      const embedding = await generateEmbedding(chunkTexts[i]);
      embeddings.push(embedding);
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1} / ${chunkTexts.length}`);
    }
    await col.add({ ids, documents: chunkTexts, embeddings, metadatas });
  } else {
    // For OpenAI/Google, ChromaDB handles embeddings but we need to batch
    // Google has a limit of 100 requests per batch
    const batchSize = config.EMBEDDING_PROVIDER.toLowerCase() === 'google' ||
                      config.EMBEDDING_PROVIDER.toLowerCase() === 'gemini' ? 100 : 1000;

    for (let i = 0; i < chunkTexts.length; i += batchSize) {
      const end = Math.min(i + batchSize, chunkTexts.length);
      const batchIds = ids.slice(i, end);
      const batchDocs = chunkTexts.slice(i, end);
      const batchMetas = metadatas.slice(i, end);

      await col.add({
        ids: batchIds,
        documents: batchDocs,
        metadatas: batchMetas
      });

      console.log(`  ${end} / ${chunkTexts.length}`);
    }
  }

  console.log(`Done. ${chunks.length} chunks stored.`);
  return true;
}

async function query(question) {
  let col;
  try {
    // Get collection with embedding function if using OpenAI/Google.
    // The query task type is what matters here - the stored vectors keep
    // whatever task type they were built with.
    const collectionConfig = { name: 'docs' };
    if (usesChromaEmbeddingFunction()) {
      collectionConfig.embeddingFunction = queryEmbeddingFunction;
    }
    col = await chroma.getCollection(collectionConfig);
  } catch {
    return { answer: 'Database not found. Run: node rag_web.js build', sources: [], error: true };
  }

  let results;
  if (usesChromaEmbeddingFunction()) {
    // For OpenAI/Google, ChromaDB handles query embeddings automatically
    results = await col.query({
      queryTexts: [question],
      nResults: config.rag.nResults,
    });
  } else {
    // For Ollama, generate embeddings manually
    const embedding = await generateEmbedding(question);
    results = await col.query({
      queryEmbeddings: [embedding],
      nResults: config.rag.nResults,
    });
  }

  if (!results.documents[0].length) {
    return { answer: 'Nothing relevant found in the documents.', sources: [], error: false };
  }

  const context = results.documents[0].join('\n\n');
  const prompt  = `Answer using only this context. If unsure, say so.\n\nContext:\n${context}\n\nQuestion: ${question}\nAnswer:`;
  const answer  = (await ollama.generate({ model: config.llm.model, prompt })).response;
  const sources = [...new Set(results.metadatas[0].map(m => m.source))];

  return { answer, sources, error: false };
}

async function getStats() {
  try {
    const col   = await chroma.getCollection({ name: 'docs' });
    const count = await col.count();
    return { count, exists: true };
  } catch {
    return { count: 0, exists: false };
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/stats', async (_req, res) => {
  res.json(await getStats());
});

app.post('/ask', async (req, res) => {
  const question = (req.body.question || '').trim();
  if (!question) return res.json({ answer: 'No question provided.', sources: [], error: true });
  try {
    res.json(await query(question));
  } catch (e) {
    res.json({ answer: `Error: ${e.message}`, sources: [], error: true });
  }
});

// Fetch the stored collection. Uses the index embedding function so the returned
// vectors are exactly what build() wrote - no re-embedding happens here.
async function getDocsCollection() {
  const collectionConfig = { name: 'docs' };
  if (usesChromaEmbeddingFunction()) {
    collectionConfig.embeddingFunction = indexEmbeddingFunction;
  }
  return await chroma.getCollection(collectionConfig);
}

app.get('/embeddings', async (_req, res) => {
  let col;
  try {
    col = await getDocsCollection();
  } catch {
    return res.status(404).json({ error: 'Collection "docs" not found. Run: node rag_web.js build' });
  }

  const data = await col.get({ include: ['embeddings', 'documents', 'metadatas'] });
  const chunks = data.ids.map((id, i) => ({
    id,
    text: data.documents[i],
    source: data.metadatas[i]?.source || 'Unknown',
    embedding: data.embeddings[i],
  }));

  res.json({ collection: 'docs', chunks });
});

/**
 * Re-embed every stored chunk with the SEMANTIC_SIMILARITY task type.
 *
 * The database is built for retrieval (query-to-document matching), which is the
 * wrong optimization for clustering. This regenerates vectors tuned for
 * content-to-content similarity instead, so the pools group by actual topic.
 *
 * This calls the embedding API for every chunk, so it is slow and costs quota.
 * It is a visualization aid - never use it on the query path.
 */
app.get('/embeddings-semantic', async (_req, res) => {
  if (!usesChromaEmbeddingFunction()) {
    return res.status(400).json({
      error: 'Semantic re-embedding requires the Google or OpenAI provider. ' +
             `Current provider: ${config.EMBEDDING_PROVIDER}`,
    });
  }

  let col;
  try {
    col = await getDocsCollection();
  } catch {
    return res.status(404).json({ error: 'Collection "docs" not found. Run: node rag_web.js build' });
  }

  try {
    const data = await col.get({ include: ['documents', 'metadatas'] });
    if (!data.ids.length) {
      return res.status(404).json({ error: 'Collection "docs" is empty. Run: node rag_web.js build' });
    }

    const taskType = config.google.taskType.visualization;
    const semanticFunction = createEmbeddingFunction(taskType);
    console.log(`Re-embedding ${data.ids.length} chunks as ${taskType}...`);

    // Google caps batchEmbedContents at 100 requests per call
    const batchSize = 100;
    const embeddings = [];
    for (let i = 0; i < data.documents.length; i += batchSize) {
      const batch = data.documents.slice(i, i + batchSize);
      embeddings.push(...await semanticFunction.generate(batch));
      console.log(`  ${Math.min(i + batchSize, data.documents.length)} / ${data.documents.length}`);
    }

    const chunks = data.ids.map((id, i) => ({
      id,
      text: data.documents[i],
      source: data.metadatas[i]?.source || 'Unknown',
      embedding: embeddings[i],
    }));

    res.json({ collection: `docs (${taskType})`, taskType, chunks });
  } catch (e) {
    console.error('Semantic re-embed failed:', e.message);
    res.status(500).json({ error: `Re-embedding failed: ${e.message}` });
  }
});

// Provocations for the seeds canvas. `?n=10` returns a random sample.
app.get('/provocations', (req, res) => {
  try {
    const all = readProvocations(PROVOCATIONS_SRC, PROVOCATIONS);
    const n = Number(req.query.n);

    if (!n || n >= all.length) return res.json(all);

    // Fisher-Yates on a copy, so the sample is uniform and the source order stays put.
    const pool = [...all];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    res.json(pool.slice(0, n));
  } catch (e) {
    console.error('Provocations read failed:', e.message);
    res.status(500).json({ error: `Could not read provocations: ${e.message}` });
  }
});

// `no-cache` means "store it, but revalidate every time". Express's default of
// `max-age=0` lets Chrome serve the bundle from its in-memory cache without
// asking, so an open tab keeps running a stale build after `npm run build:seeds`.
const noCache = (res) => res.setHeader('Cache-Control', 'no-cache');

/**
 * Snippets nearest to, or farthest from, a passage — searched live against the
 * vector DB. Not the pre-computed sources column: this embeds the passage and
 * asks Chroma every time it's called.
 *
 * The collection was built without an `hnsw:space`, so Chroma indexed it with
 * its default squared-L2 rather than cosine. The Gemini vectors are unit
 * length, which makes the two orderings equivalent and the distance exactly
 * convertible, and it's what makes the `far` direction possible at all:
 *
 *   squaredL2(a, v)  = 2 - 2(a·v)   ->  cos = 1 - d/2   (smallest d = nearest)
 *   squaredL2(a, -v) = 2 + 2(a·v)   ->  cos = d/2 - 1   (smallest d = farthest)
 *
 * Chroma can only search for nearest, so `far` searches for the nearest
 * neighbours of the *negated* query vector, which are the farthest from the
 * passage itself. Both conversions are checked against hand-computed cosines
 * over the full collection in the tests.
 */
async function queryVector(text) {
  if (!usesChromaEmbeddingFunction()) return generateEmbedding(text);
  return (await queryEmbeddingFunction.generate([text]))[0];
}

async function searchByCosine(text, want, direction) {
  const collectionConfig = { name: 'docs' };
  if (usesChromaEmbeddingFunction()) collectionConfig.embeddingFunction = queryEmbeddingFunction;
  const col = await chroma.getCollection(collectionConfig);

  const far = direction === 'far';
  const v = await queryVector(text);

  // Over-fetch: the passage is itself a chunk in the collection, so a `near`
  // search returns it as its own closest match and it has to be dropped.
  const results = await col.query({
    queryEmbeddings: [far ? v.map((x) => -x) : v],
    nResults: want + 4,
  });

  const toSimilarity = far ? (d) => d / 2 - 1 : (d) => 1 - d / 2;
  const flatten = (t) => t.replace(/\s+/g, ' ').trim();
  const self = flatten(text).toLowerCase();

  const out = [];
  for (let i = 0; i < results.documents[0].length && out.length < want; i++) {
    const doc = flatten(results.documents[0][i]);
    if (doc.toLowerCase() === self) continue;

    out.push({
      text: doc,
      file: results.metadatas[0][i]?.source || '',
      similarity: Number(toSimilarity(results.distances[0][i]).toFixed(4)),
    });
  }
  return out;
}

function cosineSearchRoute(direction) {
  return async (req, res) => {
    const text = String(req.query.text || '').trim();
    const want = Math.min(Math.max(Number(req.query.n) || 2, 1), 8);

    if (!text) return res.status(400).json({ error: 'text is required' });

    try {
      res.json(await searchByCosine(text, want, direction));
    } catch (e) {
      console.error(`Cosine search (${direction}) failed:`, e.message);
      res.status(500).json({ error: `Search failed: ${e.message}` });
    }
  };
}

app.get('/neighbors', cosineSearchRoute('near'));
app.get('/counterexamples', cosineSearchRoute('far'));

/**
 * Zoom in on a passage — the agentic pill.
 *
 * Runs the whole pipeline live: Gemini plans what to look up, the plan is
 * searched against the vector DB, and a grounded call reaches the open web. It
 * takes 25-40s, which is why the hosted build reads a precomputed copy instead
 * (see export-static.js). Same zoom.js either way.
 */
app.get('/zoom', async (req, res) => {
  const text = String(req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    const search = async (query, n) => searchByCosine(query, n, 'near');
    const { boxes } = await zoomIn(text, search);
    res.json(boxes);
  } catch (e) {
    console.error('Zoom failed:', e.message);
    res.status(500).json({ error: `Zoom failed: ${e.message}` });
  }
});

app.use('/static', express.static(path.join(__dirname, 'static'), { setHeaders: noCache }));
app.get('/seeds.html', (_req, res) =>
  res.sendFile(path.join(__dirname, 'seeds.html'), { headers: { 'Cache-Control': 'no-cache' } }));
app.get('/visualize.html', (_req, res) => res.sendFile(path.join(__dirname, 'visualize.html')));
app.get('/visualize-d3.html', (_req, res) => res.sendFile(path.join(__dirname, 'visualize-d3.html')));
app.get('/visualize-d3-semantic.html', (_req, res) => res.sendFile(path.join(__dirname, 'visualize-d3-semantic.html')));

app.get('/', (_req, res) => res.send(HTML));

// ── HTML ──────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Local RAG Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Courier New', Courier, monospace;
      background: #1a1a1a;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }

    .container {
      background: #fff;
      border: 4px solid #000;
      box-shadow: 10px 10px 0 #000;
      width: 100%;
      max-width: 900px;
      height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .header {
      background: #F5F5A0;
      padding: 20px 30px;
      border-bottom: 4px solid #000;
    }

    .header h1 {
      font-size: 22px;
      font-weight: 900;
      letter-spacing: 3px;
      text-transform: uppercase;
      margin-bottom: 6px;
    }

    .header .stats {
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
      background: #efefef;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .empty {
      text-align: center;
      padding: 60px 20px;
      border: 3px dashed #000;
      background: #fff;
    }

    .empty h2 {
      font-size: 18px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 3px;
      margin-bottom: 10px;
    }

    .empty p {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .msg {
      display: flex;
      animation: in 0.1s ease;
    }

    @keyframes in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .msg.user  { justify-content: flex-end; }

    .bubble {
      max-width: 70%;
      padding: 12px 16px;
      border: 3px solid #000;
      line-height: 1.6;
      white-space: pre-wrap;
    }

    .msg.user  .bubble { background: #000;  color: #F5F5A0; box-shadow:  4px 4px 0 #F5F5A0; }
    .msg.bot   .bubble { background: #fff;  color: #000;    box-shadow:  4px 4px 0 #000; }
    .msg.error .bubble { background: #fff;  color: #000;    box-shadow:  4px 4px 0 #c00; }

    .sources {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 2px solid #000;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .dots {
      display: flex;
      gap: 6px;
      padding: 12px 16px;
      border: 3px solid #000;
      background: #fff;
      box-shadow: 4px 4px 0 #000;
      width: fit-content;
    }

    .dots span {
      width: 8px; height: 8px;
      background: #000;
      animation: bounce 1.2s infinite;
    }
    .dots span:nth-child(2) { animation-delay: 0.2s; }
    .dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40%           { transform: scale(1); }
    }

    .input-row {
      padding: 20px 30px;
      background: #fff;
      border-top: 4px solid #000;
      display: flex;
      gap: 12px;
    }

    #q {
      flex: 1;
      padding: 12px 14px;
      border: 3px solid #000;
      font-family: inherit;
      font-size: 14px;
      outline: none;
      background: #fff;
    }

    #q:focus { background: #F5F5A0; }

    #send {
      padding: 12px 28px;
      background: #F5F5A0;
      border: 3px solid #000;
      font-family: inherit;
      font-size: 13px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 2px;
      cursor: pointer;
      box-shadow: 4px 4px 0 #000;
    }

    #send:hover:not(:disabled) {
      background: #000;
      color: #F5F5A0;
      box-shadow: none;
      transform: translate(4px, 4px);
    }

    #send:disabled { opacity: 0.4; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Local RAG Chat</h1>
      <div class="stats" id="stats">Loading...</div>
    </div>

    <div class="messages" id="messages">
      <div class="empty">
        <h2>Welcome</h2>
        <p>Ask a question about your documents</p>
      </div>
    </div>

    <div class="input-row">
      <input id="q" type="text" placeholder="Ask a question..." autocomplete="off">
      <button id="send">Ask</button>
    </div>
  </div>

  <script>
    const box    = document.getElementById('messages');
    const input  = document.getElementById('q');
    const btn    = document.getElementById('send');
    const statsEl = document.getElementById('stats');

    fetch('/stats').then(r => r.json()).then(d => {
      statsEl.textContent = d.exists ? d.count + ' chunks ready' : 'No database — run build first';
    }).catch(() => { statsEl.textContent = 'Could not reach server'; });

    function addMsg(text, type, sources) {
      box.querySelector('.empty')?.remove();
      const wrap   = document.createElement('div');
      wrap.className = 'msg ' + type;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      if (sources?.length) {
        const s = document.createElement('div');
        s.className = 'sources';
        s.textContent = 'Sources: ' + sources.join(', ');
        bubble.appendChild(s);
      }
      wrap.appendChild(bubble);
      box.appendChild(wrap);
      box.scrollTop = box.scrollHeight;
    }

    function addLoader() {
      box.querySelector('.empty')?.remove();
      const el = document.createElement('div');
      el.className = 'msg bot';
      el.id = 'loader';
      el.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
      return el;
    }

    async function send() {
      const q = input.value.trim();
      if (!q) return;
      addMsg(q, 'user');
      input.value = '';
      input.disabled = btn.disabled = true;
      const loader = addLoader();
      try {
        const data = await fetch('/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q })
        }).then(r => r.json());
        loader.remove();
        addMsg(data.answer, data.error ? 'error' : 'bot', data.sources);
      } catch (e) {
        loader.remove();
        addMsg('Request failed: ' + e.message, 'error');
      } finally {
        input.disabled = btn.disabled = false;
        input.focus();
      }
    }

    btn.addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    input.focus();
  </script>
</body>
</html>`;

// ── Entry point ───────────────────────────────────────────────────────────────

const [,, cmd] = process.argv;

if (cmd === 'build') {
  build().catch(e => console.error('Error:', e.message));
} else if (cmd === 'serve' || cmd === 'web') {
  getStats().then(s => {
    if (s.exists) console.log(`Database ready: ${s.count} chunks`);
    else console.log('No database found. Run: node rag_web.js build');
  }).catch(() => console.log('Warning: could not reach ChromaDB'));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nChat:        http://localhost:${PORT}`);
    console.log(`Seeds:       http://localhost:${PORT}/seeds.html`);
    console.log(`Pools (p5):  http://localhost:${PORT}/visualize.html`);
    console.log(`Pools (d3):  http://localhost:${PORT}/visualize-d3.html`);
    console.log(`Pools (sem): http://localhost:${PORT}/visualize-d3-semantic.html`);
    console.log('Ctrl+C to stop\n');
  });
} else {
  console.log('Commands:');
  console.log('  node rag_web.js build  — index documents (.pdf, .md, .txt, .jsonl)');
  console.log('  node rag_web.js serve  — start web UI');
}
