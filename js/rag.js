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
import { config } from "./config.js";
import {
  createEmbeddingFunction,
  generateEmbedding,
  usesChromaEmbeddingFunction,
  getEmbeddingInfo,
} from "./embeddings.js";
import { findDocuments, parseDocument } from "./parsers.js";
import { chunkText, getChunkingInfo } from "./chunking.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_PATH = path.resolve(__dirname, "../docs");

const ollama = new Ollama();
const chroma = new ChromaClient();
const embeddingFunction = createEmbeddingFunction();

// ── Commands ──────────────────────────────────────────────────────────────────

async function build() {
  const documents = findDocuments(DOCS_PATH);
  if (!documents.length) {
    console.log(`No documents found in ${DOCS_PATH}`);
    console.log(`Supported formats: .pdf, .md, .jsonl`);
    return;
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
    return;
  }

  console.log(`Split into ${chunks.length} chunks. Embedding...`);

  const ids = [];
  const chunkTexts = [];
  const metadatas = [];

  for (let i = 0; i < chunks.length; i++) {
    const { text, source } = chunks[i];
    ids.push(`chunk_${i}`);
    chunkTexts.push(text);
    metadatas.push({ source });
  }

  try {
    await chroma.deleteCollection({ name: "docs" });
  } catch {}

  // Create collection with embedding function if using OpenAI/Google
  const collectionConfig = { name: "docs" };
  if (usesChromaEmbeddingFunction()) {
    collectionConfig.embeddingFunction = embeddingFunction;
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
}

async function ask(question, showSources = false) {
  let col;
  try {
    // Get collection with embedding function if using OpenAI/Google
    const collectionConfig = { name: "docs" };
    if (usesChromaEmbeddingFunction()) {
      collectionConfig.embeddingFunction = embeddingFunction;
    }
    col = await chroma.getCollection(collectionConfig);
  } catch {
    return "No database found. Run: node rag.js build";
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

  if (!results.documents[0].length) return "Nothing relevant found.";

  const context = results.documents[0].join("\n\n");
  const prompt = `Answer using only this context. If unsure, say so.\n\nContext:\n${context}\n\nQuestion: ${question}\nAnswer:`;
  const answer = (await ollama.generate({ model: config.llm.model, prompt })).response;

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
