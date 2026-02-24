#!/usr/bin/env node
/**
 * Simple Local RAG - 100% Offline
 * JS port of rag.py
 * No server, no internet required after setup
 */

import { Ollama } from 'ollama';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────

const DOCS_PATH   = path.resolve(__dirname, '../docs');
const DB_PATH     = path.resolve(__dirname, '../rag_database/js_store.json');
const EMBED_MODEL = 'nomic-embed-text';
const LLM_MODEL   = 'qwen2.5:7b';
const CHUNK_SIZE  = 500;
const CHUNK_OVERLAP = 50;

const ollama = new Ollama({ host: 'http://localhost:11434' });

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

// ── Core ──────────────────────────────────────────────────────────────────────

async function build() {
  console.log('📂 Loading PDFs...');

  const pdfFiles = walkPDFs(DOCS_PATH);
  if (pdfFiles.length === 0) {
    console.log(`❌ No PDFs found in ${DOCS_PATH}/`);
    return;
  }

  // Lazy import to avoid pdf-parse test runner on module load
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');

  const allChunks = [];
  for (const filePath of pdfFiles) {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    for (const chunk of splitText(data.text)) {
      allChunks.push({ text: chunk, source: filePath });
    }
  }

  console.log(`✂️  Splitting into ${allChunks.length} chunks...`);
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
}

async function ask(question, showSources = false) {
  const records = loadDB();
  if (!records) {
    console.log('❌ No database found. Run build first.');
    return null;
  }

  const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: question });
  const qEmb = res.embedding;

  const scored = records
    .map(r => ({ ...r, score: cosineSimilarity(qEmb, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) return 'No relevant information found.';

  const context = scored.map(r => r.text).join('\n\n');
  const prompt = `Use this context to answer. If unsure, say so.\n\nContext:\n${context}\n\nQuestion: ${question}\n\nAnswer:`;

  const response = await ollama.generate({ model: LLM_MODEL, prompt });
  const answer = response.response;

  if (showSources) {
    const sources = [...new Set(scored.map(r => path.basename(r.metadata.source)))];
    return `${answer}\n\n📚 Sources: ${sources.join(', ')}`;
  }
  return answer;
}

function stats() {
  const records = loadDB();
  if (!records) {
    console.log('❌ No database found. Run build first.');
    return;
  }
  console.log(`📊 Database has ${records.length} chunks`);
}

// ── Interactive REPL ──────────────────────────────────────────────────────────

async function interactive() {
  console.log('\n🤖 Simple Local RAG');
  console.log('='.repeat(50));
  stats();
  console.log("\n💬 Ask questions (or 'quit' to exit)\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('❓ ', async (input) => {
      const question = input.trim();
      if (!question) { prompt(); return; }

      if (['quit', 'exit', 'q'].includes(question.toLowerCase())) {
        console.log('\n👋 Bye!');
        rl.close();
        return;
      }

      if (question.toLowerCase() === 'stats') {
        stats();
        console.log();
        prompt();
        return;
      }

      try {
        const answer = await ask(question, true);
        if (answer) {
          console.log(`\n💡 ${answer}\n`);
          console.log('-'.repeat(50) + '\n');
        }
      } catch (e) {
        console.log(`\n❌ Error: ${e.message}\n`);
      }
      prompt();
    });
  };

  prompt();
}

// ── Main ──────────────────────────────────────────────────────────────────────

const command = process.argv[2];

if (command === 'build') {
  build().catch(console.error);

} else if (command === 'ask') {
  const question = process.argv.slice(3).join(' ');
  if (!question) {
    console.log("Usage: node rag.js ask 'your question'");
    process.exit(1);
  }
  console.log(`\n❓ ${question}\n`);
  ask(question, true).then(answer => {
    if (answer) console.log(`💡 ${answer}\n`);
  }).catch(console.error);

} else if (command === 'stats') {
  stats();

} else {
  interactive();
}
