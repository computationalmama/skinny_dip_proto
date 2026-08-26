#!/usr/bin/env node
/**
 * Provocations → sources
 *
 * Runs each row of provocations.csv through the RAG retriever and writes a copy
 * of the CSV with an extra `sources` column holding the source document plus the
 * passages that matched.
 *
 * Retrieval only — no LLM generation. The sources come from the chunks Chroma
 * returns, so there is nothing for a model to add here.
 *
 * Requires: chroma run --path ../rag_database (in a separate terminal)
 *
 * Usage: node --env-file-if-exists=.env provocations.js [in.csv] [out.csv]
 */

import { ChromaClient } from "chromadb";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { createEmbeddingFunction, generateEmbedding, usesChromaEmbeddingFunction } from "./embeddings.js";
import { parseCSV, csvEscape } from "./csv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IN = path.resolve(process.argv[2] || path.join(__dirname, "../provocations.csv"));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, "../provocations_with_sources.csv"));

const chroma = new ChromaClient();
const queryEmbeddingFunction = createEmbeddingFunction(config.google.taskType.querying);

// ── Retrieval ─────────────────────────────────────────────────────────────────

async function retrieve(col, question) {
  if (usesChromaEmbeddingFunction()) {
    return col.query({ queryTexts: [question], nResults: config.rag.nResults });
  }
  const embedding = await generateEmbedding(question);
  return col.query({ queryEmbeddings: [embedding], nResults: config.rag.nResults });
}

/** `file.md: "passage" | "passage"` — one cell naming the document and what matched. */
function formatSources(results) {
  const docs = results.documents[0];
  if (!docs?.length) return "";

  const files = [...new Set(results.metadatas[0].map(m => m?.source).filter(Boolean))];
  const passages = docs.map(d => `"${d.replace(/\s+/g, " ").trim()}"`).join(" | ");

  return files.length ? `${files.join(", ")}: ${passages}` : passages;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const raw = fs.readFileSync(IN, "utf8").replace(/^﻿/, "");
const rows = parseCSV(raw);
if (!rows.length) {
  console.error(`No rows in ${IN}`);
  process.exit(1);
}

const collectionConfig = { name: "docs" };
if (usesChromaEmbeddingFunction()) collectionConfig.embeddingFunction = queryEmbeddingFunction;

let col;
try {
  col = await chroma.getCollection(collectionConfig);
} catch {
  console.error("No database found. Run: node rag.js build");
  process.exit(1);
}

console.log(`${rows.length} provocations, ${await col.count()} chunks, top ${config.rag.nResults} each\n`);

const out = [["provocation", "sources"].map(csvEscape).join(",")];

for (let i = 0; i < rows.length; i++) {
  const provocation = rows[i][0];
  try {
    const sources = formatSources(await retrieve(col, provocation));
    out.push([provocation, sources].map(csvEscape).join(","));
    console.log(`  ${String(i + 1).padStart(2)}/${rows.length} ✓ ${provocation.slice(0, 60)}…`);
  } catch (e) {
    out.push([provocation, ""].map(csvEscape).join(","));
    console.error(`  ${String(i + 1).padStart(2)}/${rows.length} ✗ ${e.message}`);
  }
}

fs.writeFileSync(OUT, out.join("\n") + "\n");
console.log(`\nWrote ${OUT}`);
