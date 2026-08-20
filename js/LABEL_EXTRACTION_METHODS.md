# Alternative Label Extraction Methods

This document explores different approaches to automatically generating meaningful labels for document clusters beyond simple word frequency counting.

---

## Current Method: Word Frequency (Term Frequency)

**What it does:** Counts how often words appear in the cluster, takes top 2.

**Pros:**
- Fast and simple
- No dependencies
- Works well for focused topics

**Cons:**
- Ignores context across the entire corpus
- Common words within a topic may not be distinctive
- No awareness of semantic importance

---

## 1. TF-IDF (Term Frequency-Inverse Document Frequency)

**What it does:** Weights words by how unique they are to this cluster vs. all clusters.

**Formula:**
```
TF-IDF(word, cluster) = TF(word, cluster) × IDF(word, all_clusters)
IDF(word) = log(total_clusters / clusters_containing_word)
```

**Implementation:**

```javascript
function extractLabelTFIDF(pools) {
  // Calculate IDF for each word across all pools
  const wordInPools = {};
  const allWords = new Set();

  pools.forEach(pool => {
    const text = pool.members.map(m => m.text).join(' ');
    const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    const uniqueWords = new Set(words.filter(w => !STOPWORDS.has(w)));

    uniqueWords.forEach(w => {
      allWords.add(w);
      wordInPools[w] = (wordInPools[w] || 0) + 1;
    });
  });

  const totalPools = pools.length;
  const idf = {};
  allWords.forEach(w => {
    idf[w] = Math.log(totalPools / wordInPools[w]);
  });

  // Calculate TF-IDF for each pool
  return pools.map(pool => {
    const text = pool.members.map(m => m.text).join(' ');
    const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    const tf = {};

    words.forEach(w => {
      if (STOPWORDS.has(w)) return;
      tf[w] = (tf[w] || 0) + 1;
    });

    const tfidf = {};
    Object.keys(tf).forEach(w => {
      tfidf[w] = tf[w] * (idf[w] || 0);
    });

    const top = Object.entries(tfidf)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([w]) => w.toUpperCase());

    return top.length ? top.join(' ') : 'POOL';
  });
}
```

**Pros:**
- Finds words that are distinctive to each cluster
- Better than pure frequency for diverse datasets

**Cons:**
- Still doesn't understand semantic meaning
- Needs access to all pools at once

---

## 2. N-grams (Phrases Instead of Words)

**What it does:** Extracts 2-3 word phrases instead of single words.

**Implementation:**

```javascript
function extractLabelNgrams(text) {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) || [];
  const filtered = words.filter(w => !STOPWORDS.has(w));

  // Generate bigrams (2-word phrases)
  const bigrams = {};
  for (let i = 0; i < filtered.length - 1; i++) {
    const phrase = `${filtered[i]} ${filtered[i + 1]}`;
    bigrams[phrase] = (bigrams[phrase] || 0) + 1;
  }

  // Get most frequent bigram
  const top = Object.entries(bigrams)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([phrase]) => phrase.toUpperCase());

  return top.length ? top[0] : 'POOL';
}
```

**Example outputs:**
- "MACHINE LEARNING"
- "DATA PIPELINE"
- "USER INTERFACE"

**Pros:**
- More descriptive than single words
- Captures common phrases

**Cons:**
- Requires more text to have meaningful frequency
- Longer labels

---

## 3. LLM-Based Summarization

**What it does:** Uses the LLM (Ollama/OpenAI/Google) to generate a concise topic name.

**Implementation:**

```javascript
async function extractLabelLLM(pool, ollama) {
  // Sample a few representative chunks
  const samples = pool.members
    .slice(0, 5)
    .map(m => m.text.slice(0, 200))
    .join('\n\n');

  const prompt = `Given these text excerpts from a document cluster, generate a 1-3 word topic label that captures the main theme. Only output the label, nothing else.

Excerpts:
${samples}

Topic label:`;

  const response = await ollama.generate({
    model: 'qwen2.5:7b',
    prompt,
    options: { temperature: 0.3, max_tokens: 10 }
  });

  return response.response.trim().toUpperCase();
}
```

**Pros:**
- Understands semantic meaning
- Can generate creative, accurate labels
- Handles complex topics well

**Cons:**
- Slow (requires LLM call per pool)
- Costs API credits (if using OpenAI/Google)
- Non-deterministic

---

## 4. Named Entity Recognition (NER)

**What it does:** Extracts proper nouns, organizations, concepts.

**Simple implementation (regex-based):**

```javascript
function extractLabelNER(text) {
  // Find capitalized words (potential named entities)
  const entities = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

  const freq = {};
  entities.forEach(e => {
    const normalized = e.toUpperCase();
    if (normalized.length > 3) {
      freq[normalized] = (freq[normalized] || 0) + 1;
    }
  });

  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([entity]) => entity);

  return top.length ? top.join(' ') : 'POOL';
}
```

**Example outputs:**
- "GOOGLE CLOUD"
- "JAVASCRIPT NODEJS"
- "LINUX UBUNTU"

**Pros:**
- Good for technical/product documentation
- Captures specific technologies/tools

**Cons:**
- Misses conceptual topics
- Relies on capitalization
- Limited without proper NER library

---

## 5. Part-of-Speech Filtering (Nouns Only)

**What it does:** Only counts nouns, ignoring verbs/adjectives.

**Conceptual (requires NLP library):**

```javascript
// Using a library like compromise or natural
function extractLabelNouns(text) {
  const doc = nlp(text);
  const nouns = doc.nouns().out('array');

  const freq = {};
  nouns.forEach(noun => {
    const word = noun.toLowerCase();
    if (word.length > 3 && !STOPWORDS.has(word)) {
      freq[word] = (freq[word] || 0) + 1;
    }
  });

  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w.toUpperCase());

  return top.length ? top.join(' ') : 'POOL';
}
```

**Pros:**
- Nouns are often more meaningful for topics
- Filters out action words

**Cons:**
- Requires NLP library (compromise, natural, etc.)
- Slower than regex

---

## 6. Centroid-Based: Most Similar Chunk

**What it does:** Finds the chunk closest to the centroid and extracts its key words.

**Implementation:**

```javascript
function extractLabelCentroid(pool, centroid) {
  // Find chunk with highest similarity to centroid
  let bestChunk = null;
  let bestSim = -Infinity;

  pool.members.forEach(chunk => {
    const sim = cosineSim(chunk.embedding, centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestChunk = chunk;
    }
  });

  // Extract label from the most representative chunk
  if (bestChunk) {
    return extractLabel(bestChunk.text);
  }

  return 'POOL';
}
```

**Pros:**
- Uses the most "representative" text
- Leverages existing embeddings

**Cons:**
- Single chunk may not capture full cluster theme
- Still uses word frequency

---

## 7. Document Title Extraction

**What it does:** If chunks have metadata (like section headers), use those.

**Implementation:**

```javascript
function extractLabelFromTitles(pool) {
  // Assumes chunks might have section headers or titles
  const titles = pool.members
    .map(m => {
      // Extract text that looks like a title (short, capitalized)
      const lines = m.text.split('\n');
      const titleLine = lines.find(line =>
        line.length < 50 &&
        line.length > 5 &&
        /^[A-Z]/.test(line)
      );
      return titleLine;
    })
    .filter(Boolean);

  if (titles.length === 0) {
    return extractLabel(pool.members.map(m => m.text).join(' '));
  }

  // Get most common title words
  const words = titles.join(' ').toLowerCase().match(/[a-z]{4,}/g) || [];
  const freq = {};

  words.forEach(w => {
    if (!STOPWORDS.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });

  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w.toUpperCase());

  return top.length ? top.join(' ') : 'POOL';
}
```

**Pros:**
- Uses existing document structure
- Often more accurate than body text

**Cons:**
- Requires structured documents
- Not all PDFs have clear headers

---

## 8. RAKE (Rapid Automatic Keyword Extraction)

**What it does:** Identifies multi-word key phrases based on word co-occurrence.

**Algorithm:**
1. Split text into candidate keywords (sequences of words not separated by stopwords)
2. Calculate word scores (word frequency / word degree)
3. Sum scores for multi-word phrases
4. Rank phrases

**Conceptual implementation:**

```javascript
function extractLabelRAKE(text) {
  const sentences = text.split(/[.!?;\n]+/);
  const phrases = [];

  sentences.forEach(sentence => {
    const words = sentence.toLowerCase().match(/[a-z]{3,}/g) || [];
    let phrase = [];

    words.forEach(w => {
      if (STOPWORDS.has(w)) {
        if (phrase.length > 0) {
          phrases.push(phrase.join(' '));
          phrase = [];
        }
      } else {
        phrase.push(w);
      }
    });

    if (phrase.length > 0) {
      phrases.push(phrase.join(' '));
    }
  });

  // Score phrases (simplified)
  const phraseScores = {};
  phrases.forEach(p => {
    phraseScores[p] = (phraseScores[p] || 0) + p.split(' ').length;
  });

  const top = Object.entries(phraseScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([phrase]) => phrase.toUpperCase());

  return top.length ? top[0] : 'POOL';
}
```

**Pros:**
- Extracts meaningful phrases automatically
- Language-independent

**Cons:**
- More complex than word frequency
- Can be sensitive to text quality

---

## 9. Hybrid: Frequency + Embeddings

**What it does:** Combines word frequency with semantic clustering of words.

**Implementation:**

```javascript
function extractLabelHybrid(pool, allEmbeddings) {
  // Get frequent words
  const text = pool.members.map(m => m.text).join(' ');
  const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  const freq = {};

  words.forEach(w => {
    if (!STOPWORDS.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  });

  // Take top 10 candidates
  const candidates = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);

  // If we had word embeddings, we could cluster them
  // and pick words from different semantic clusters
  // For now, just take first and last from top candidates
  const diverse = [candidates[0], candidates[candidates.length - 1]]
    .map(w => w.toUpperCase());

  return diverse.join(' ');
}
```

**Pros:**
- More diverse labels
- Captures different aspects of cluster

**Cons:**
- Requires word-level embeddings
- More complex

---

## 10. First Sentence Extraction

**What it does:** Uses the first meaningful sentence from the most central chunk.

**Implementation:**

```javascript
function extractLabelFirstSentence(pool, centroid) {
  // Find most representative chunk
  let bestChunk = null;
  let bestSim = -Infinity;

  pool.members.forEach(chunk => {
    const sim = cosineSim(chunk.embedding, centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestChunk = chunk;
    }
  });

  if (!bestChunk) return 'POOL';

  // Extract first sentence
  const sentences = bestChunk.text.split(/[.!?]+/);
  const firstSentence = sentences[0] || '';

  // Get key words from first sentence
  const words = firstSentence.toLowerCase().match(/[a-z]{4,}/g) || [];
  const filtered = words
    .filter(w => !STOPWORDS.has(w))
    .slice(0, 2)
    .map(w => w.toUpperCase());

  return filtered.length ? filtered.join(' ') : 'POOL';
}
```

**Pros:**
- First sentences often contain topic information
- Simple to implement

**Cons:**
- Assumes well-structured writing
- May miss broader theme

---

## Comparison Matrix

| Method | Speed | Accuracy | Dependencies | Best For |
|--------|-------|----------|--------------|----------|
| Word Frequency (current) | ⚡⚡⚡ | ⭐⭐ | None | General purpose, fast |
| TF-IDF | ⚡⚡ | ⭐⭐⭐ | None | Distinctive topics |
| N-grams | ⚡⚡ | ⭐⭐⭐ | None | Phrases, concepts |
| LLM-based | ⚡ | ⭐⭐⭐⭐⭐ | LLM API | High quality, slow |
| NER | ⚡⚡ | ⭐⭐⭐ | Optional | Product/tech docs |
| POS Filtering | ⚡⚡ | ⭐⭐⭐ | NLP library | Conceptual topics |
| Centroid-based | ⚡⚡ | ⭐⭐⭐ | None | Using embeddings |
| Title Extraction | ⚡⚡⚡ | ⭐⭐⭐⭐ | None | Structured docs |
| RAKE | ⚡⚡ | ⭐⭐⭐⭐ | None | Multi-word phrases |
| Hybrid | ⚡⚡ | ⭐⭐⭐⭐ | Word embeddings | Diverse labels |

---

## Recommendations

### Quick wins (no dependencies):
1. **TF-IDF** - Simple upgrade from current method
2. **N-grams** - Better for phrase-based topics
3. **Centroid-based** - Already have embeddings

### Best quality (with dependencies):
1. **LLM-based** - Best accuracy, use sparingly
2. **POS filtering** - Install `compromise` or `natural`
3. **RAKE** - Good balance of quality and speed

### Hybrid approach:
```javascript
async function smartLabelExtraction(pool, centroid, ollama) {
  // Try title extraction first
  const titleLabel = extractLabelFromTitles(pool);
  if (titleLabel !== 'POOL') return titleLabel;

  // Fall back to TF-IDF
  const tfidfLabel = extractLabelTFIDF([pool])[0];
  if (tfidfLabel !== 'POOL') return tfidfLabel;

  // For important clusters, use LLM
  if (pool.members.length > 50) {
    return await extractLabelLLM(pool, ollama);
  }

  // Default to frequency
  return extractLabel(pool.members.map(m => m.text).join(' '));
}
```

---

## Next Steps

To implement any of these:

1. Copy the function into `visualize-d3.html`
2. Replace the call to `extractLabel()` in `buildPools()` (line 360)
3. For LLM-based, add async/await handling
4. For libraries, install via npm and import

Example:
```javascript
// In buildPools() function, line 360:
nodes.push({
  id: nodes.length,
  label: extractLabelTFIDF([{ members }])[0],  // Use TF-IDF instead
  // ... rest of the node properties
});
```
