# Google Gemini Embedding Task Types

This document explains how to use Google Gemini's task-specific embeddings to optimize for different use cases.

---

## Overview

Google Gemini's `gemini-embedding-2` model supports **task-based prompting** to optimize embeddings for specific purposes. Instead of using a generic embedding, you can tell the model what you're using the embedding for, and it will optimize accordingly.

**Format:**
```
task: {task_name} | query: {your_text}
```

---

## Available Task Types

### 1. **Semantic Similarity**
`task: semantic similarity`

**Best for:**
- Finding similar documents
- Recommendation systems
- Duplicate detection
- Content clustering
- Topic grouping

**Example:**
```javascript
const text = formatGoogleTaskText(
  "Machine learning is a subset of AI",
  "semantic similarity"
);
// Output: "task: semantic similarity | query: Machine learning is a subset of AI"
```

**Use in this project:**
- Visualization clustering (visualize-d3-semantic.html)
- Finding related content
- Organizing by theme

---

### 2. **Retrieval Document**
`task: retrieval document`

**Best for:**
- Indexing documents for search
- Building RAG knowledge bases
- Creating searchable databases

**Example:**
```javascript
const text = formatGoogleTaskText(
  "Python is a programming language",
  "retrieval document"
);
```

**Use in this project:**
- Building the main RAG database (default)
- Indexing PDFs, markdown, JSONL files

---

### 3. **Search Query**
`task: search query`

**Best for:**
- User search queries
- Question answering
- Finding relevant documents

**Example:**
```javascript
const query = formatGoogleTaskText(
  "How do I install Python?",
  "search query"
);
```

**Use in this project:**
- When users ask questions
- RAG query embedding

---

### 4. **Classification**
`task: classification`

**Best for:**
- Categorizing text
- Sentiment analysis
- Spam detection
- Topic assignment

**Example:**
```javascript
const text = formatGoogleTaskText(
  "This product is amazing!",
  "classification"
);
```

---

### 5. **Clustering**
`task: clustering`

**Best for:**
- Grouping similar items
- Topic modeling
- Document organization
- Market segmentation

**Example:**
```javascript
const text = formatGoogleTaskText(
  "Customer feedback about pricing",
  "clustering"
);
```

---

## Implementation in This Project

### Configuration (config.js)

```javascript
google: {
  apiKey: process.env.GOOGLE_API_KEY || '',
  model: 'gemini-embedding-2',
  taskType: {
    indexing: 'retrieval document',      // Building database
    querying: 'search query',             // User questions
    visualization: 'semantic similarity' // Clustering/viz
  }
}
```

### Helper Function (embeddings.js)

```javascript
export function formatGoogleTaskText(text, taskType) {
  if (config.google.model === 'gemini-embedding-2') {
    return `task: ${taskType} | query: ${text}`;
  }
  return text; // No formatting for other models
}
```

### Usage Example

```javascript
// For indexing documents
const docText = formatGoogleTaskText(
  chunk.text,
  config.google.taskType.indexing
);

// For user queries
const queryText = formatGoogleTaskText(
  userQuestion,
  config.google.taskType.querying
);

// For visualization
const vizText = formatGoogleTaskText(
  chunk.text,
  config.google.taskType.visualization
);
```

---

## Visualizations

### Standard Visualization
**URL:** `http://localhost:6601/visualize-d3.html`

Uses embeddings optimized for **retrieval** (the default database embeddings).

**Task type:** `retrieval document`

**Best for:** Seeing how documents are organized for search/RAG

---

### Semantic Similarity Visualization
**URL:** `http://localhost:6601/visualize-d3-semantic.html`

Re-generates embeddings on-the-fly using **semantic similarity** task type.

**Task type:** `semantic similarity`

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
2. Formats with `task: semantic similarity | query: {text}`
3. Batches requests (100 per batch for Google)
4. Returns fresh embeddings

**Note:** This is slower than `/embeddings` because it regenerates all embeddings.

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
Database is built with **retrieval document** task type.

### To Change Default
Edit `config.js`:

```javascript
google: {
  taskType: {
    indexing: 'semantic similarity',  // Change this
    querying: 'semantic similarity',  // And this
    visualization: 'semantic similarity'
  }
}
```

Then rebuild:
```bash
npm run build
```

**Warning:** This changes how RAG queries work. Semantic similarity is optimized for content-to-content matching, not query-to-document matching.

---

## Best Practices

1. **Use retrieval for RAG** - Keep database indexed with `retrieval document`
2. **Use semantic for viz** - Generate semantic embeddings on-demand for clustering
3. **Don't mix task types** - Query and documents should use matching task types
4. **Test both** - Compare visualizations to see differences
5. **Consider costs** - Regenerating embeddings costs API calls

---

## Troubleshooting

### "Task type not working"
**Problem:** Embeddings look the same

**Solution:**
- Verify you're using `gemini-embedding-2` (not `gemini-embedding-001`)
- Check the formatted text includes `task:` prefix
- Look at console logs to confirm task type

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
| Building RAG database | `retrieval document` |
| User asking questions | `search query` |
| Finding similar docs | `semantic similarity` |
| Grouping by topic | `clustering` |
| Categorizing content | `classification` |

**Files Modified:**
- `config.js` - Task type configuration
- `embeddings.js` - Text formatting helper
- `rag_web.js` - New `/embeddings-semantic` endpoint
- `visualize-d3-semantic.html` - New visualization page
