# Google Gemini Embedding Task Types

This document explains how to use Google Gemini's task-specific embeddings to optimize for different use cases.

---

## Overview

Google Gemini's embedding models optimize for a **task type**: you tell the model what
the embedding is *for*, and it adjusts the vector accordingly.

This is a real request field, not a text prefix. You pass `taskType` alongside the
content, and the API validates it against a fixed enum — an unrecognized value is
rejected with a 400.

```javascript
// What actually goes over the wire
{
  "model": "models/gemini-embedding-001",
  "content": { "parts": [{ "text": "small AI is about scale" }] },
  "taskType": "RETRIEVAL_DOCUMENT"
}
```

The task type measurably changes the vector. Embedding the same sentence four
different ways, compared against `RETRIEVAL_DOCUMENT` by cosine similarity:

| Task type | cos vs `RETRIEVAL_DOCUMENT` |
|---|---|
| `RETRIEVAL_DOCUMENT` | 1.000 |
| `QUESTION_ANSWERING` | 0.942 |
| `RETRIEVAL_QUERY` | 0.938 |
| `CLASSIFICATION` | 0.908 |
| `SEMANTIC_SIMILARITY` | 0.899 |
| `CLUSTERING` | 0.885 |

> **Note:** earlier versions of this document described a
> `task: {name} | query: {text}` text prefix. That format was never real — writing it
> into the text would just embed the literal words "task:" and "query:" along with
> your content, and pollute whatever you store. Use the `taskType` field.

---

## Available Task Types

All five below are verified working against `gemini-embedding-001` and
`gemini-embedding-2`. You select one by passing it to `createEmbeddingFunction()`.

### 1. **`SEMANTIC_SIMILARITY`**

**Best for:**
- Finding similar documents
- Recommendation systems
- Duplicate detection
- Content clustering
- Topic grouping

**Example:**
```javascript
import { createEmbeddingFunction } from './embeddings.js';

const ef = createEmbeddingFunction('SEMANTIC_SIMILARITY');
const [vector] = await ef.generate(['Machine learning is a subset of AI']);
```

**Use in this project:**
- Visualization clustering (`visualize-d3-semantic.html`, via `/embeddings-semantic`)
- Finding related content
- Organizing by theme

---

### 2. **`RETRIEVAL_DOCUMENT`**

**Best for:**
- Indexing documents for search
- Building RAG knowledge bases
- Creating searchable databases

**Example:**
```javascript
const ef = createEmbeddingFunction('RETRIEVAL_DOCUMENT');
const vectors = await ef.generate(['Python is a programming language']);
```

**Use in this project:**
- Building the main RAG database (this is `config.google.taskType.indexing`)
- Indexing PDF, markdown, plain text and JSONL chunks

---

### 3. **`RETRIEVAL_QUERY`**

The counterpart to `RETRIEVAL_DOCUMENT` — this is the "search query" side.

**Best for:**
- User search queries
- Finding relevant documents

**Example:**
```javascript
const ef = createEmbeddingFunction('RETRIEVAL_QUERY');
const [qv] = await ef.generate(['How do I install Python?']);
```

**Use in this project:**
- Embedding the user's question in `ask()` / `POST /ask`
  (this is `config.google.taskType.querying`)

**Related:** `QUESTION_ANSWERING` is a distinct enum value, tuned for questions
expecting a direct answer rather than a document match. Worth trying as an
alternative on the query side.

---

### 4. **`CLASSIFICATION`**

**Best for:**
- Categorizing text
- Sentiment analysis
- Spam detection
- Topic assignment

**Example:**
```javascript
const ef = createEmbeddingFunction('CLASSIFICATION');
const vectors = await ef.generate(['This product is amazing!']);
```

---

### 5. **`CLUSTERING`**

**Best for:**
- Grouping similar items
- Topic modeling
- Document organization
- Market segmentation

**Example:**
```javascript
const ef = createEmbeddingFunction('CLUSTERING');
const vectors = await ef.generate(['Customer feedback about pricing']);
```

---

## Implementation in This Project

### Configuration (config.js)

```javascript
google: {
  apiKey: process.env.GOOGLE_API_KEY || '',
  model: process.env.GOOGLE_EMBED_MODEL || 'gemini-embedding-001',
  taskType: {
    indexing: 'RETRIEVAL_DOCUMENT',        // build: chunks we store
    querying: 'RETRIEVAL_QUERY',           // ask: the user's question
    visualization: 'SEMANTIC_SIMILARITY',  // clustering / viz
  },
}
```

### Helper Function (embeddings.js)

`createEmbeddingFunction` takes the task type and hands it to ChromaDB's Google
embedding function, which forwards it as the `taskType` request field. It defaults
to the indexing task, so `build` needs no argument.

```javascript
export function createEmbeddingFunction(taskType = config.google.taskType.indexing) {
  // ...
  return new GoogleGenerativeAiEmbeddingFunction({
    googleApiKey: config.google.apiKey,
    model: config.google.model,
    taskType,
  });
}
```

Providers other than Google ignore the argument — neither OpenAI nor Ollama has a
task-type concept.

### Usage Example

```javascript
// Indexing documents — build()
const indexEF = createEmbeddingFunction(config.google.taskType.indexing);
const col = await chroma.createCollection({ name: 'docs', embeddingFunction: indexEF });
await col.add({ ids, documents, metadatas });   // Chroma embeds as RETRIEVAL_DOCUMENT

// User queries — ask()
const queryEF = createEmbeddingFunction(config.google.taskType.querying);
const col = await chroma.getCollection({ name: 'docs', embeddingFunction: queryEF });
await col.query({ queryTexts: [question] });    // question embeds as RETRIEVAL_QUERY

// Visualization — GET /embeddings-semantic
const vizEF = createEmbeddingFunction(config.google.taskType.visualization);
const vectors = await vizEF.generate(chunkTexts);
```

**Why two embedding functions?** Retrieval is asymmetric by design. The stored
vectors keep whatever task type they were built with, so the collection is created
with the indexing function and *queried* through the querying function. Attaching one
shared function to both would embed questions as though they were documents.

---

## Visualizations

### Standard Visualization
**URL:** `http://localhost:6601/visualize-d3.html`

Uses embeddings optimized for **retrieval** (the default database embeddings).

**Task type:** `RETRIEVAL_DOCUMENT`

**Best for:** Seeing how documents are organized for search/RAG

---

### Semantic Similarity Visualization
**URL:** `http://localhost:6601/visualize-d3-semantic.html`

Re-generates embeddings on-the-fly using **semantic similarity** task type.

**Task type:** `SEMANTIC_SIMILARITY`

**Best for:**
- Finding truly similar content
- Better clustering
- Duplicate detection
- Thematic grouping

**How it works:**
1. Fetches document text from database
2. Re-embeds with semantic similarity task
3. Clusters using cosine similarity
4. Displays as interactive pools

---

## Comparison: Retrieval vs Semantic Similarity

| Aspect | Retrieval Document | Semantic Similarity |
|--------|-------------------|---------------------|
| **Purpose** | Search optimization | Finding similar content |
| **Use case** | RAG, Q&A, search | Clustering, recommendations |
| **Optimization** | Query-document matching | Content-to-content matching |
| **Best for** | "Find documents about X" | "Show me similar documents" |

### Example Scenario

**Documents:**
1. "Python programming tutorial"
2. "Learn Python for beginners"
3. "JavaScript tutorial"

**With Retrieval Document:**
- Query: "python tutorial" → Finds doc #1 and #2 (optimized for search)

**With Semantic Similarity:**
- Doc #1 and #2 cluster together (both Python tutorials)
- Doc #3 clusters separately (different language, but still tutorial)

---

## API Endpoint: `/embeddings-semantic`

### Purpose
Re-generates embeddings with semantic similarity task type for visualization.

### Request
```bash
GET http://localhost:6601/embeddings-semantic
```

### Response
```json
{
  "collection": "docs (semantic similarity)",
  "chunks": [
    {
      "id": "chunk_0",
      "text": "Document text...",
      "source": "document.pdf",
      "embedding": [0.123, 0.456, ...]
    }
  ]
}
```

### Process
1. Gets document text from database
2. Re-embeds it with `taskType: 'SEMANTIC_SIMILARITY'`
3. Batches requests (100 per batch — Google's `batchEmbedContents` limit)
4. Returns fresh embeddings; the stored collection is left untouched

**Note:** This is slower than `/embeddings` because it regenerates all embeddings.
Measured: 283 chunks in ~4.6s. Returns 400 if the provider is Ollama, which has no
task types.

---

## Performance Considerations

### Cost
Each embedding API call costs tokens. Using `/embeddings-semantic`:
- Calls Google API for every chunk
- Good for testing/visualization
- **Don't** use in production queries

### Speed
- `/embeddings`: Instant (reads from database)
- `/embeddings-semantic`: Slow (regenerates all embeddings)

**For 500 chunks:**
- Standard: < 100ms
- Semantic: ~30-60 seconds (depending on API speed)

---

## When to Use Each Task Type

### Use **Retrieval Document + Search Query** for:
- RAG systems
- Q&A applications
- Document search
- Knowledge bases

### Use **Semantic Similarity** for:
- Content recommendations
- Duplicate detection
- Document clustering
- Topic analysis
- Similar item suggestions

### Use **Classification** for:
- Categorizing content
- Sentiment analysis
- Tagging systems

### Use **Clustering** for:
- Topic modeling
- Market segmentation
- Content organization

---

## Testing Task Types

### 1. View Standard Retrieval
```bash
npm run serve
# Visit: http://localhost:6601/visualize-d3.html
```

### 2. View Semantic Similarity
```bash
npm run serve
# Visit: http://localhost:6601/visualize-d3-semantic.html
```

### 3. Compare Results
- Same documents
- Different embeddings
- Different clustering

**Look for:**
- Tighter clusters with semantic similarity
- Different pool groupings
- More accurate topic separation

---

## Rebuilding with Different Task Types

### Current Default
The database is built with `RETRIEVAL_DOCUMENT` and queried with `RETRIEVAL_QUERY`.

### To Change Default
Edit `config.js`:

```javascript
google: {
  taskType: {
    indexing: 'SEMANTIC_SIMILARITY',  // Change this
    querying: 'SEMANTIC_SIMILARITY',  // And this
    visualization: 'SEMANTIC_SIMILARITY',
  },
}
```

Then rebuild:
```bash
npm run build
```

**Warning:** This changes how RAG queries work. `SEMANTIC_SIMILARITY` is optimized for
content-to-content matching, not query-to-document matching.

**Changing `indexing` requires a rebuild; changing `querying` does not.** The stored
vectors are fixed at build time, so a new querying task type takes effect on the next
question. Changing `indexing` without rebuilding leaves the collection on the old task
type — the two sides silently stop matching, and retrieval quality degrades without any
error.

---

## Best Practices

1. **Use retrieval for RAG** - Keep the database indexed with `RETRIEVAL_DOCUMENT` and query with `RETRIEVAL_QUERY`
2. **Use semantic for viz** - Generate semantic embeddings on-demand for clustering
3. **Don't mix task types** - Query and documents should use matching task types
4. **Test both** - Compare visualizations to see differences
5. **Consider costs** - Regenerating embeddings costs API calls

---

## Troubleshooting

### "Task type not working"
**Problem:** Embeddings look the same

**Solution:**
- Both `gemini-embedding-001` and `gemini-embedding-2` honour task types — the model
  is not the problem
- Confirm the task type reaches the constructor: `build` prints it, e.g.
  `Using embeddings: Google Gemini (gemini-embedding-001, task: RETRIEVAL_DOCUMENT)`
- Do **not** prefix the text with `task:` — that embeds the literal words and is not
  how the API works
- Compare vectors by cosine similarity rather than eyeballing them; the difference is
  real but small (0.88–0.94 between task types), so the first few values look alike

### "404 model not found"
**Problem:** `models/... is not found for API version v1`

**Solution:** the model name is wrong. Only `gemini-embedding-001`,
`gemini-embedding-2` and `gemini-embedding-2-preview` (v1beta only) exist. List what
your key can actually reach:

```bash
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_API_KEY" \
  | grep -o '"name": "models/[^"]*embedding[^"]*"'
```

### "Google API key not configured"
**Problem:** Thrown from `createEmbeddingFunction` even though `.env` has the key.

**Solution:** nothing in the repo auto-loads `.env`. The npm scripts pass
`--env-file-if-exists=.env`, so use `npm run build` / `npm run ask` rather than calling
`node rag.js ...` directly — or export the variable yourself.

### "Slow visualization load"
**Problem:** `/embeddings-semantic` takes too long

**Solution:**
- Normal for first load (regenerating all embeddings)
- Consider reducing chunk count
- Cache results if needed

### "Different clusters"
**Problem:** Semantic similarity shows different groupings

**Solution:**
- This is expected! Different task types optimize differently
- Semantic similarity focuses on content meaning
- Retrieval focuses on query matching

---

## Further Reading

- [Google Gemini Embedding Docs](https://ai.google.dev/gemini-api/docs/embeddings)
- [Task Types Reference](https://ai.google.dev/gemini-api/docs/embeddings#task-types-embeddings-1)
- See `COSINE_SIMILARITY.md` for how clustering works
- See `LABEL_EXTRACTION_METHODS.md` for pool labeling

---

## Summary

**Quick Reference:**

| What You're Doing | Task Type |
|-------------------|-----------|
| Building RAG database | `RETRIEVAL_DOCUMENT` |
| User asking questions | `RETRIEVAL_QUERY` |
| Finding similar docs | `SEMANTIC_SIMILARITY` |
| Grouping by topic | `CLUSTERING` |
| Categorizing content | `CLASSIFICATION` |

**Files Modified:**
- `config.js` - Task type configuration
- `embeddings.js` - Text formatting helper
- `rag_web.js` - New `/embeddings-semantic` endpoint
- `visualize-d3-semantic.html` - New visualization page
