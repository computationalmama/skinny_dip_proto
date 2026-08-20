# Text Chunking Strategies

This document explains the different chunking strategies available in the RAG system and how to choose the best one for your documents.

---

## Why Chunking Matters

Good chunking is crucial for RAG quality:
- **Readable chunks** = Better context for LLM
- **Natural boundaries** = Preserved meaning
- **Right size** = Balance between context and specificity

**Bad chunking:**
```
...machine learning is a subset of AI that fo
cuses on algorithms. Deep learning uses neur...
```
❌ Splits mid-sentence, loses context

**Good chunking:**
```
Machine learning is a subset of AI that focuses
on algorithms. Deep learning uses neural networks
to process data.
```
✅ Complete thoughts, natural boundaries

---

## Available Strategies

### 1. **Smart** (Default - Recommended)

**Auto-detects** the best strategy based on content type.

**How it works:**
- Markdown files → Uses markdown-aware chunking
- Well-structured text → Uses recursive chunking
- Long-form text → Uses sentence-based chunking

**Configuration:**
```javascript
// config.js
rag: {
  chunkingStrategy: 'smart'
}
```

**Best for:** Most use cases (let the system decide)

---

### 2. **Character** (Simplest, Fastest)

**Fixed-size chunks** with character overlap.

**How it works:**
```
Text: "Machine learning is AI. Deep learning uses neural networks."
Chunk 1: "Machine learning is AI. Deep le"
Chunk 2: "ep learning uses neural networks."
```

**Pros:**
- Very fast
- Predictable chunk sizes
- Simple to understand

**Cons:**
- Splits mid-sentence
- Breaks words
- Poor readability

**Configuration:**
```javascript
rag: {
  chunkingStrategy: 'character',
  chunkSize: 500,
  overlap: 50
}
```

**Best for:** Testing, benchmarking, when speed > quality

---

### 3. **Sentence** (Readable)

**Respects sentence boundaries**, combines sentences until reaching target size.

**How it works:**
```
Sentences:
1. "Machine learning is a subset of AI."
2. "It focuses on learning from data."
3. "Deep learning uses neural networks."

Chunk 1: "Machine learning is a subset of AI. It focuses on learning from data."
Chunk 2: "It focuses on learning from data. Deep learning uses neural networks."
```
(Note: Sentence 2 appears in both chunks for overlap)

**Pros:**
- Complete sentences
- Very readable
- Natural language flow

**Cons:**
- Variable chunk sizes
- May be too small if sentences are short

**Configuration:**
```javascript
rag: {
  chunkingStrategy: 'sentence',
  chunkSize: 500,
  overlap: 1  // Number of sentences to overlap
}
```

**Best for:**
- Articles and blog posts
- News content
- Any well-punctuated text

---

### 4. **Paragraph** (Very Readable)

**Keeps paragraphs together**, combines until reaching target size.

**How it works:**
```
Paragraph 1:
"Machine learning is AI. It learns from data."

Paragraph 2:
"Deep learning uses neural networks. It processes complex patterns."

Chunk 1: Paragraph 1
Chunk 2: Paragraph 1 + Paragraph 2 (if both fit)
```

**Pros:**
- Preserves logical grouping
- Excellent readability
- Maintains context

**Cons:**
- Large paragraphs may exceed chunk size
- Variable chunk sizes

**Configuration:**
```javascript
rag: {
  chunkingStrategy: 'paragraph',
  chunkSize: 500,
  overlap: 1  // Number of paragraphs to overlap
}
```

**Best for:**
- Well-formatted documents
- Essays and reports
- Content with clear paragraph structure

---

### 5. **Recursive** (Balanced)

**Progressively splits** using paragraphs → sentences → characters.

**How it works:**
1. Try to keep paragraphs intact
2. If paragraph too large, split by sentences
3. If sentence too large, split by characters
4. Respects natural boundaries when possible

**Example:**
```
Large paragraph (800 chars):
  → Too big, split by sentences
  → Sentence 1 (200 chars) ✓
  → Sentence 2 (300 chars) ✓
  → Sentence 3 (600 chars) → Too big, split by characters
```

**Pros:**
- Best balance of readability and size
- Handles varied content well
- Adapts to document structure

**Cons:**
- Slightly slower than other methods
- More complex logic

**Configuration:**
```javascript
rag: {
  chunkingStrategy: 'recursive',
  chunkSize: 500,
  overlap: 50  // Character overlap for final splits
}
```

**Best for:**
- Mixed content types
- Documents with varied structure
- General-purpose chunking

---

### 6. **Markdown** (Structure-Aware)

**Preserves heading structure**, keeps sections together.

**How it works:**
```markdown
# Introduction
Machine learning is AI.

## Types of ML
### Supervised Learning
Uses labeled data.

### Unsupervised Learning
Finds patterns in unlabeled data.
```

**Chunks:**
```
Chunk 1:
# Introduction
Machine learning is AI.

Chunk 2:
## Types of ML
### Supervised Learning
Uses labeled data.

Chunk 3:
## Types of ML
### Unsupervised Learning
Finds patterns in unlabeled data.
```

**Features:**
- Preserves section headers in each chunk
- Respects document hierarchy
- Falls back to recursive for large sections

**Pros:**
- Perfect for markdown documentation
- Preserves structure
- Headers provide context

**Cons:**
- Only useful for markdown files
- May create small chunks if sections are brief

**Configuration:**
```javascript
rag: {
  chunkingStrategy: 'markdown',
  chunkSize: 500,
  overlap: 50
}
```

**Best for:**
- README files
- Documentation
- Notes in markdown format
- Any .md files

---

## Configuration

### In config.js

```javascript
export const config = {
  // ... other config

  rag: {
    chunkSize: 500,           // Target chunk size in characters
    overlap: 50,              // Overlap amount (meaning varies by strategy)
    nResults: 3,              // Query result count
    chunkingStrategy: 'smart' // Choose strategy here
  }
};
```

### Via Environment Variable

```bash
export CHUNKING_STRATEGY="recursive"
```

Then update config.js:
```javascript
chunkingStrategy: process.env.CHUNKING_STRATEGY || 'smart'
```

---

## Overlap Explained

### Character-based Strategies
`overlap` = number of characters

```
Chunk 1: "...learning from data."
Chunk 2: "from data. Deep learning..."
          ^^^^^^^^^^^ 50 character overlap
```

### Sentence/Paragraph Strategies
`overlap` = number of units (sentences or paragraphs)

```
overlap: 1 (sentence-based)

Chunk 1: [Sentence 1] [Sentence 2]
Chunk 2: [Sentence 2] [Sentence 3]  ← Sentence 2 repeated
```

**Why overlap?**
- Provides context across chunk boundaries
- Prevents information loss at edges
- Helps LLM understand connections

---

## Comparison Table

| Strategy | Readability | Speed | Predictability | Best For |
|----------|-------------|-------|----------------|----------|
| **Character** | ⭐ | ⚡⚡⚡ | ⭐⭐⭐ | Testing |
| **Sentence** | ⭐⭐⭐⭐ | ⚡⚡ | ⭐⭐ | Articles |
| **Paragraph** | ⭐⭐⭐⭐⭐ | ⚡⚡ | ⭐⭐ | Essays |
| **Recursive** | ⭐⭐⭐⭐ | ⚡⚡ | ⭐⭐⭐ | General |
| **Markdown** | ⭐⭐⭐⭐⭐ | ⚡⚡ | ⭐⭐ | Docs |
| **Smart** | ⭐⭐⭐⭐ | ⚡⚡ | ⭐⭐⭐ | Auto |

---

## Examples

### Example 1: Blog Post

**Content:**
```
Understanding Machine Learning

Machine learning is fascinating. It enables computers
to learn from data without explicit programming.

Deep Learning

Deep learning is a subset of machine learning. It uses
neural networks with many layers.
```

**Character chunking (500 chars):**
```
Chunk 1: "Understanding Machine Learning\n\nMachine learning is fascinating. It enables computers\nto learn from data without explicit programming.\n\nDeep Learning\n\nDeep learning is a subset of machine learning. It uses\nneural networks with many layers."
```
✓ Everything in one chunk (worked out in this case)

**Sentence chunking:**
```
Chunk 1: "Machine learning is fascinating. It enables computers to learn from data without explicit programming."

Chunk 2: "It enables computers to learn from data without explicit programming. Deep learning is a subset of machine learning."

Chunk 3: "Deep learning is a subset of machine learning. It uses neural networks with many layers."
```
✓ Complete sentences, good overlap

**Markdown chunking:**
```
Chunk 1:
"# Understanding Machine Learning

Machine learning is fascinating. It enables computers
to learn from data without explicit programming."

Chunk 2:
"# Deep Learning

Deep learning is a subset of machine learning. It uses
neural networks with many layers."
```
✓ Preserves headers for context

---

### Example 2: Technical Documentation

**Best strategy:** `markdown` or `recursive`

Markdown files benefit from structure preservation:
- Headers provide topic context
- Code blocks stay together
- Lists remain intact

---

### Example 3: Chat Logs (JSONL)

**Best strategy:** `sentence` or `character`

Chat messages are typically:
- Short (already bite-sized)
- Conversational (sentence-based works)
- Sequential (overlap helpful)

---

## Testing Different Strategies

### Quick Test

```bash
# Build with current strategy
npm run build

# Check output - you'll see chunk counts per file
# Example:
#   ✓ notes.md (md) - 12 chunks
#   ✓ paper.pdf (pdf) - 45 chunks
```

### Inspect Chunks

After building, query the database and look at results:

```bash
node rag.js ask "machine learning"
# Check if returned chunks make sense and are readable
```

### A/B Testing

1. Build with strategy A:
```javascript
chunkingStrategy: 'character'
```

2. Query and note quality

3. Rebuild with strategy B:
```javascript
chunkingStrategy: 'recursive'
```

4. Same query, compare results

**Look for:**
- Complete thoughts
- Readable text
- Relevant context
- Natural boundaries

---

## Recommendations by Document Type

| Document Type | Recommended Strategy | Why |
|---------------|---------------------|-----|
| **Markdown (.md)** | `markdown` | Preserves structure |
| **PDFs** | `recursive` | Handles varied formatting |
| **JSONL (chat)** | `sentence` | Conversational flow |
| **JSONL (structured)** | `paragraph` | Logical grouping |
| **Code files** | `recursive` | Respects function boundaries |
| **Articles/Blogs** | `sentence` | Natural reading flow |
| **Technical docs** | `markdown` or `recursive` | Structure + flexibility |
| **Mixed corpus** | `smart` | Auto-detects best fit |

---

## Performance Considerations

### Speed

```
character   ⚡⚡⚡  ~0.1ms per 1000 chars
sentence    ⚡⚡   ~0.5ms per 1000 chars
paragraph   ⚡⚡   ~0.3ms per 1000 chars
recursive   ⚡⚡   ~0.7ms per 1000 chars
markdown    ⚡⚡   ~0.8ms per 1000 chars
smart       ⚡⚡   ~0.5ms per 1000 chars (varies)
```

**Real impact:** Negligible for most use cases (<1 second for entire corpus)

### Memory

All strategies process chunks iteratively - memory usage is constant regardless of document size.

---

## Troubleshooting

### "Chunks are too small"

**Problem:** Getting many tiny chunks (< 100 chars)

**Solutions:**
1. Increase `chunkSize`:
   ```javascript
   chunkSize: 1000  // Larger chunks
   ```

2. Switch to `recursive` or `paragraph` strategy

3. Check if documents have excessive newlines

---

### "Chunks split mid-sentence"

**Problem:** Using `character` strategy

**Solution:** Switch to `sentence`, `paragraph`, or `recursive`

```javascript
chunkingStrategy: 'sentence'
```

---

### "Markdown headers missing from chunks"

**Problem:** Using non-markdown strategy on .md files

**Solution:** Use `markdown` or `smart` strategy

```javascript
chunkingStrategy: 'markdown'  // or 'smart' (auto-detects .md)
```

---

### "Chunks are inconsistent sizes"

**Problem:** Natural - sentence/paragraph strategies create variable sizes

**Solution:** This is expected and actually better for readability. If you need consistent sizes, use `character` strategy (but sacrifice readability).

---

## Advanced: Custom Chunking

To add a custom strategy, edit `chunking.js`:

```javascript
export function chunkByCustom(text, chunkSize, overlap) {
  // Your custom logic here
  const chunks = [];

  // ... implementation

  return chunks;
}

// Add to chunkText() switch:
case 'custom':
  return chunkByCustom(text, chunkSize, overlap);
```

---

## Best Practices

1. **Start with `smart`** - Let the system choose
2. **Test with your data** - Different content needs different strategies
3. **Inspect results** - Query and check chunk quality
4. **Adjust chunk size** - 500 is good default, but experiment
5. **Use overlap wisely** - More overlap = more context but more duplicates
6. **Match to content** - Structure

d docs need structure-aware chunking
7. **Rebuild after changes** - Run `npm run build` to see effects

---

## Summary

**Quick Decision Guide:**

| If your documents are... | Use... |
|-------------------------|--------|
| Mostly markdown | `markdown` |
| Mixed types | `smart` |
| Need max readability | `paragraph` |
| Need balanced approach | `recursive` |
| Need speed over quality | `character` |
| Well-punctuated text | `sentence` |

**Default recommendation:** `smart` (already configured)

The chunking strategy significantly impacts RAG quality. Better chunks = better context = better answers!
