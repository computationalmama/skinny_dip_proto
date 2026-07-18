#!/usr/bin/env node
/**
 * Simple Local RAG - Web version
 * Requires: chroma run --path ../rag_database (in a separate terminal)
 */

import express from 'express';
import { ChromaClient } from 'chromadb';
import { Ollama } from 'ollama';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const DOCS_PATH   = path.resolve(__dirname, '../docs');
const EMBED_MODEL = 'nomic-embed-text';
const LLM_MODEL   = 'qwen2.5:7b';
const CHUNK_SIZE  = 500;
const OVERLAP     = 50;
const PORT        = 6601;

const ollama = new Ollama();
const chroma = new ChromaClient();
const app    = express();
app.use(express.json());

// ── Text helpers ──────────────────────────────────────────────────────────────

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start += CHUNK_SIZE - OVERLAP;
  }
  return chunks;
}

function findPDFs(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findPDFs(full));
    else if (entry.name.toLowerCase().endsWith('.pdf')) results.push(full);
  }
  return results;
}

// ── RAG logic ─────────────────────────────────────────────────────────────────

async function build() {
  const pdfFiles = findPDFs(DOCS_PATH);
  if (!pdfFiles.length) {
    console.log(`No PDFs found in ${DOCS_PATH}`);
    return false;
  }
  console.log(`Found ${pdfFiles.length} PDF(s). Parsing...`);

  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');

  const chunks = [];
  for (const file of pdfFiles) {
    const data = await pdfParse(fs.readFileSync(file));
    for (const chunk of chunkText(data.text)) {
      chunks.push({ text: chunk, source: path.basename(file) });
    }
  }
  console.log(`Split into ${chunks.length} chunks. Embedding...`);

  const ids        = [];
  const documents  = [];
  const embeddings = [];
  const metadatas  = [];

  for (let i = 0; i < chunks.length; i++) {
    const { text, source } = chunks[i];
    const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: text });
    ids.push(`chunk_${i}`);
    documents.push(text);
    embeddings.push(res.embedding);
    metadatas.push({ source });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1} / ${chunks.length}`);
  }

  try { await chroma.deleteCollection({ name: 'docs' }); } catch {}
  const col = await chroma.createCollection({ name: 'docs' });
  await col.add({ ids, documents, embeddings, metadatas });

  console.log(`Done. ${chunks.length} chunks stored.`);
  return true;
}

async function query(question) {
  let col;
  try {
    col = await chroma.getCollection({ name: 'docs' });
  } catch {
    return { answer: 'Database not found. Run: node rag_web.js build', sources: [], error: true };
  }

  const res     = await ollama.embeddings({ model: EMBED_MODEL, prompt: question });
  const results = await col.query({ queryEmbeddings: [res.embedding], nResults: 3 });

  if (!results.documents[0].length) {
    return { answer: 'Nothing relevant found in the documents.', sources: [], error: false };
  }

  const context = results.documents[0].join('\n\n');
  const prompt  = `Answer using only this context. If unsure, say so.\n\nContext:\n${context}\n\nQuestion: ${question}\nAnswer:`;
  const answer  = (await ollama.generate({ model: LLM_MODEL, prompt })).response;
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

app.get('/embeddings', async (_req, res) => {
  let col;
  try {
    col = await chroma.getCollection({ name: 'docs' });
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

app.get('/visualize.html', (_req, res) => res.sendFile(path.join(__dirname, 'visualize.html')));
app.get('/visualize-d3.html', (_req, res) => res.sendFile(path.join(__dirname, 'visualize-d3.html')));

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
    console.log(`Pools (p5):  http://localhost:${PORT}/visualize.html`);
    console.log(`Pools (d3):  http://localhost:${PORT}/visualize-d3.html`);
    console.log('Ctrl+C to stop\n');
  });
} else {
  console.log('Commands:');
  console.log('  node rag_web.js build  — index PDFs');
  console.log('  node rag_web.js serve  — start web UI');
}
