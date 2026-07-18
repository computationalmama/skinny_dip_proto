#!/usr/bin/env node
/**
 * Simple Local RAG - CLI version
 * Requires: chroma run --path ../rag_database (in a separate terminal)
 */

import { ChromaClient } from "chromadb";
import { Ollama } from "ollama";
import fs from "fs";
import path from "path";
import readline from "readline";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_PATH = path.resolve(__dirname, "../docs");
const EMBED_MODEL = "nomic-embed-text";
const LLM_MODEL = "qwen2.5:7b";
const CHUNK_SIZE = 500;
const OVERLAP = 50;

const ollama = new Ollama();
const chroma = new ChromaClient();

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
    else if (entry.name.toLowerCase().endsWith(".pdf")) results.push(full);
  }
  return results;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function build() {
  const pdfFiles = findPDFs(DOCS_PATH);
  if (!pdfFiles.length) {
    console.log(`No PDFs found in ${DOCS_PATH}`);
    return;
  }
  console.log(`Found ${pdfFiles.length} PDF(s). Parsing...`);

  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");

  const chunks = [];
  for (const file of pdfFiles) {
    const data = await pdfParse(fs.readFileSync(file));
    for (const chunk of chunkText(data.text)) {
      chunks.push({ text: chunk, source: path.basename(file) });
    }
  }
  console.log(`Split into ${chunks.length} chunks. Embedding...`);

  const ids = [];
  const documents = [];
  const embeddings = [];
  const metadatas = [];

  for (let i = 0; i < chunks.length; i++) {
    const { text, source } = chunks[i];
    const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: text });
    ids.push(`chunk_${i}`);
    documents.push(text);
    embeddings.push(res.embedding);
    metadatas.push({ source });
    if ((i + 1) % 10 === 0) console.log(`  ${i + 1} / ${chunks.length}`);
  }

  try {
    await chroma.deleteCollection({ name: "docs" });
  } catch {}
  const col = await chroma.createCollection({ name: "docs" });
  await col.add({ ids, documents, embeddings, metadatas });

  console.log(`Done. ${chunks.length} chunks stored.`);
}

async function ask(question, showSources = false) {
  let col;
  try {
    col = await chroma.getCollection({ name: "docs" });
  } catch {
    return "No database found. Run: node rag.js build";
  }

  const res = await ollama.embeddings({ model: EMBED_MODEL, prompt: question });
  const results = await col.query({
    queryEmbeddings: [res.embedding],
    nResults: 3,
  });

  if (!results.documents[0].length) return "Nothing relevant found.";

  const context = results.documents[0].join("\n\n");
  const prompt = `Answer using only this context. If unsure, say so.\n\nContext:\n${context}\n\nQuestion: ${question}\nAnswer:`;
  const answer = (await ollama.generate({ model: LLM_MODEL, prompt })).response;

  if (showSources) {
    const sources = [...new Set(results.metadatas[0].map((m) => m.source))];
    return `${answer}\n\nSources: ${sources.join(", ")}`;
  }
  return answer;
}

async function stats() {
  try {
    const col = await chroma.getCollection({ name: "docs" });
    const count = await col.count();
    console.log(`Database: ${count} chunks`);
  } catch {
    console.log("No database found. Run: node rag.js build");
  }
}

// ── Interactive REPL ──────────────────────────────────────────────────────────

async function interactive() {
  console.log('\nLocal RAG — type a question or "quit" to exit\n');
  await stats();
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const next = () => {
    rl.question("> ", async (line) => {
      const q = line.trim();
      if (!q) {
        next();
        return;
      }
      if (["quit", "exit", "q"].includes(q.toLowerCase())) {
        rl.close();
        return;
      }
      if (q.toLowerCase() === "stats") {
        await stats();
        next();
        return;
      }
      try {
        console.log("\n" + (await ask(q, true)) + "\n");
      } catch (e) {
        console.log("Error:", e.message);
      }
      next();
    });
  };
  next();
}

async function visualize() {
  let col;
  try {
    col = await chroma.getCollection({ name: "docs" });
  } catch {
    console.log("No database found. Run: node rag.js build");
    return;
  }

  const results = await col.get({
    include: ["embeddings", "documents"],
  });

  console.log("Documents (chunks):", results.documents);
  console.log("Embeddings (vectors):", results.embeddings);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;

if (cmd === "build") build().catch((e) => console.error("Error:", e.message));
else if (cmd === "stats")
  stats().catch((e) => console.error("Error:", e.message));
else if (cmd === "visualize")
  visualize().catch((e) => console.error("Error:", e.message));
else if (cmd === "ask") {
  const q = rest.join(" ");
  if (!q) {
    console.log("Usage: node rag.js ask 'your question'");
    process.exit(1);
  }
  ask(q, true)
    .then((a) => console.log("\n" + a + "\n"))
    .catch((e) => console.error("Error:", e.message));
} else interactive();
