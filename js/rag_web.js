#!/usr/bin/env node
/**
 * Simple Local RAG — Web Interface
 * JS port of rag_web.py
 */

import express from 'express';
import { Ollama } from 'ollama';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const DOCS_PATH   = path.resolve(__dirname, '../docs');
const DB_PATH     = path.resolve(__dirname, '../rag_database/js_store.json');
const EMBED_MODEL = 'nomic-embed-text';
const LLM_MODEL   = 'qwen2.5:7b';
const CHUNK_SIZE  = 500;
const CHUNK_OVERLAP = 50;
const PORT        = 6601; // 6600 reserved for the Python version

const ollama = new Ollama({ host: 'http://localhost:11434' });
const app = express();
app.use(express.json());

// ── Helpers ───────────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function splitText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

function walkPDFs(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkPDFs(full));
    } else if (entry.name.toLowerCase().endsWith('.pdf')) {
      files.push(full);
    }
  }
  return files;
}

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return null;
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function getStats() {
  const records = loadDB();
  if (!records) return { count: 0, exists: false };
  return { count: records.length, exists: true };
}

// ── RAG ───────────────────────────────────────────────────────────────────────

async function build() {
  console.log('📂 Loading PDFs...');
  const pdfFiles = walkPDFs(DOCS_PATH);
  if (pdfFiles.length === 0) {
    console.log(`❌ No PDFs found in ${DOCS_PATH}/`);
    return false;
  }

  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');

  const allChunks = [];
  for (const filePath of pdfFiles) {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    for (const chunk of splitText(data.text)) {
      allChunks.push({ text: chunk, source: filePath });
    }
  }

  console.log(`✂️  Split into ${allChunks.length} chunks...`);
  console.log(`🧮 Creating embeddings...`);

  const records = [];
  for (let i = 0; i < allChunks.length; i++) {
    const { text, source } = allChunks[i];
    const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: text });
    records.push({
      id: `chunk_${i}`,
      text,
      metadata: { source },
      embedding: res.embedding,
    });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${allChunks.length}`);
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(records));
  console.log(`✅ Database built! ${records.length} chunks ready`);
  return true;
}

async function askQuestion(question) {
  const records = loadDB();
  if (!records) {
    return { answer: 'Database not found. Please build the database first.', sources: [], error: true };
  }

  const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: question });
  const qEmb = res.embedding;

  const scored = records
    .map(r => ({ ...r, score: cosineSimilarity(qEmb, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) {
    return { answer: 'No relevant information found in the documents.', sources: [], error: false };
  }

  const context = scored.map(r => r.text).join('\n\n');
  const prompt = `Use this context to answer. If unsure, say so.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

  const response = await ollama.generate({ model: LLM_MODEL, prompt });
  const sources = [...new Set(scored.map(r => path.basename(r.metadata.source)))];

  return { answer: response.response, sources, error: false };
}

// ── HTML Template ─────────────────────────────────────────────────────────────

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Local RAG Chat</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

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
            background: #ffffff;
            border: 4px solid #000000;
            box-shadow: 10px 10px 0px #000000;
            width: 100%;
            max-width: 900px;
            height: 90vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .header {
            background: #F5F5A0;
            color: #000000;
            padding: 20px 30px;
            border-bottom: 4px solid #000000;
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

        .chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 30px;
            background: #efefef;
        }

        .message {
            margin-bottom: 20px;
            display: flex;
            gap: 15px;
            animation: slideIn 0.1s ease;
        }

        @keyframes slideIn {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0);   }
        }

        .message.user { justify-content: flex-end; }

        .message-content {
            max-width: 70%;
            padding: 12px 16px;
            border: 2px solid #000000;
            line-height: 1.6;
        }

        .message.user .message-content {
            background: #000000;
            color: #F5F5A0;
            box-shadow: 4px 4px 0px #F5F5A0;
        }

        .message.assistant .message-content {
            background: #ffffff;
            color: #000000;
            box-shadow: 4px 4px 0px #000000;
        }

        .message.assistant .sources {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 2px solid #000000;
            font-size: 11px;
            color: #000000;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .message.assistant .sources strong {
            color: #000000;
            font-weight: 900;
        }

        .input-container {
            padding: 20px 30px;
            background: #ffffff;
            border-top: 4px solid #000000;
            display: flex;
            gap: 12px;
        }

        #questionInput {
            flex: 1;
            padding: 12px 14px;
            border: 3px solid #000000;
            font-size: 14px;
            font-family: 'Courier New', Courier, monospace;
            outline: none;
            background: #ffffff;
            transition: none;
        }

        #questionInput:focus { background: #F5F5A0; }

        #askButton {
            padding: 12px 28px;
            background: #F5F5A0;
            color: #000000;
            border: 3px solid #000000;
            font-size: 13px;
            font-weight: 900;
            font-family: 'Courier New', Courier, monospace;
            text-transform: uppercase;
            letter-spacing: 2px;
            cursor: pointer;
            transition: none;
            box-shadow: 4px 4px 0px #000000;
        }

        #askButton:hover:not(:disabled) {
            background: #000000;
            color: #F5F5A0;
            box-shadow: none;
            transform: translate(4px, 4px);
        }

        #askButton:disabled { opacity: 0.4; cursor: not-allowed; }

        .loading {
            display: none;
            padding: 12px 16px;
            background: #ffffff;
            border: 3px solid #000000;
            max-width: 70%;
            box-shadow: 4px 4px 0px #000000;
        }

        .loading.active { display: block; }

        .loading-dots { display: flex; gap: 6px; }

        .loading-dots span {
            width: 8px;
            height: 8px;
            background: #000000;
            animation: bounce 1.4s infinite;
        }

        .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
        .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); }
            40%            { transform: scale(1); }
        }

        .empty-state {
            text-align: center;
            color: #000000;
            padding: 60px 20px;
            border: 3px dashed #000000;
            margin: 20px;
            background: #ffffff;
        }

        .empty-state h2 {
            font-size: 18px;
            margin-bottom: 12px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: 3px;
        }

        .empty-state p {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .error-message {
            background: #ffffff;
            border: 3px solid #000000;
            color: #000000;
            padding: 12px 16px;
            max-width: 70%;
            box-shadow: 4px 4px 0px #cc0000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 Local RAG Chat</h1>
            <div class="stats" id="stats">Loading...</div>
        </div>

        <div class="chat-container" id="chatContainer">
            <div class="empty-state">
                <h2>👋 Welcome!</h2>
                <p>Ask questions about your documents</p>
            </div>
        </div>

        <div class="input-container">
            <input
                type="text"
                id="questionInput"
                placeholder="Ask a question about your documents..."
                autocomplete="off"
            >
            <button id="askButton">Ask</button>
        </div>
    </div>

    <script>
        const chatContainer  = document.getElementById('chatContainer');
        const questionInput  = document.getElementById('questionInput');
        const askButton      = document.getElementById('askButton');
        const statsEl        = document.getElementById('stats');

        async function loadStats() {
            try {
                const data = await fetch('/stats').then(r => r.json());
                statsEl.textContent = data.exists
                    ? \`📚 \${data.count} chunks ready\`
                    : '⚠️ No database found — run build first';
            } catch {
                statsEl.textContent = '❌ Error loading stats';
            }
        }

        function addMessage(text, isUser, sources = []) {
            const empty = chatContainer.querySelector('.empty-state');
            if (empty) empty.remove();

            const div = document.createElement('div');
            div.className = \`message \${isUser ? 'user' : 'assistant'}\`;

            const sourcesHTML = sources.length
                ? \`<div class="sources"><strong>📄 Sources:</strong> \${sources.join(', ')}</div>\`
                : '';

            div.innerHTML = \`<div class="message-content">\${text}\${sourcesHTML}</div>\`;
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function showLoading(show) {
            let el = chatContainer.querySelector('.loading');
            if (show) {
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'loading';
                    el.innerHTML = \`<div class="loading-dots"><span></span><span></span><span></span></div>\`;
                    chatContainer.appendChild(el);
                }
                el.classList.add('active');
                chatContainer.scrollTop = chatContainer.scrollHeight;
            } else {
                if (el) el.remove();
            }
        }

        async function askQuestion() {
            const question = questionInput.value.trim();
            if (!question) return;

            addMessage(question, true);
            questionInput.value = '';
            questionInput.disabled = true;
            askButton.disabled = true;
            showLoading(true);

            try {
                const data = await fetch('/ask', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ question }),
                }).then(r => r.json());

                showLoading(false);

                if (data.error) {
                    const err = document.createElement('div');
                    err.className = 'message assistant';
                    err.innerHTML = \`<div class="error-message">\${data.answer}</div>\`;
                    chatContainer.appendChild(err);
                } else {
                    addMessage(data.answer, false, data.sources);
                }
            } catch (e) {
                showLoading(false);
                const err = document.createElement('div');
                err.className = 'message assistant';
                err.innerHTML = \`<div class="error-message">Error: \${e.message}</div>\`;
                chatContainer.appendChild(err);
            } finally {
                questionInput.disabled = false;
                askButton.disabled = false;
                questionInput.focus();
            }
        }

        askButton.addEventListener('click', askQuestion);
        questionInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') askQuestion();
        });

        loadStats();
        questionInput.focus();
    </script>
</body>
</html>`;

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => res.send(HTML_TEMPLATE));

app.get('/stats', (_req, res) => res.json(getStats()));

app.post('/ask', async (req, res) => {
  const question = (req.body.question || '').trim();
  if (!question) {
    return res.json({ answer: 'Please ask a question.', sources: [], error: true });
  }
  try {
    const result = await askQuestion(question);
    res.json(result);
  } catch (e) {
    res.json({ answer: `Error: ${e.message}`, sources: [], error: true });
  }
});

// ── Main ──────────────────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'build') {
  build().catch(console.error);

} else if (command === 'serve' || command === 'web') {
  const s = getStats();
  console.log('\n🌐 Starting web interface...');
  if (s.exists) {
    console.log(`📊 Database ready: ${s.count} chunks`);
  } else {
    console.log('⚠️  No database found. Build it first with: node rag_web.js build');
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✨ Open in your browser:`);
    console.log(`   http://localhost:${PORT}`);
    console.log('\n🛑 Press Ctrl+C to stop\n');
  });

} else {
  console.log('\n🤖 Local RAG Web Interface (JS)');
  console.log('='.repeat(50));
  console.log('\nCommands:');
  console.log('  node rag_web.js build  - Build database from PDFs');
  console.log('  node rag_web.js serve  - Start web interface');
}
