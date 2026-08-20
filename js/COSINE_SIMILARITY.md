# Cosine Similarity & Label Extraction

This document explains how `visualize-d3.html` calculates semantic similarity between embeddings and generates meaningful labels for pools.

---

## Cosine Similarity

**Location:** `visualize-d3.html` lines 269-273

### What It Does

Measures how similar two embedding vectors are by calculating the cosine of the angle between them.

### The Math

```javascript
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];    // dot product
    na += a[i] * a[i];      // magnitude squared of vector a
    nb += b[i] * b[i];      // magnitude squared of vector b
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}
```

**Formula:**
```
cos(θ) = (a · b) / (||a|| × ||b||)
```

Where:
- `a · b` = dot product = sum of element-wise products
- `||a||` = magnitude of vector a = √(a₁² + a₂² + ... + aₙ²)
- `||b||` = magnitude of vector b = √(b₁² + b₂² + ... + bₙ²)

**Result Range:**
- `1.0` = identical direction (very similar semantically)
- `0.0` = perpendicular (unrelated)
- `-1.0` = opposite direction (very different)

The `+ 1e-10` prevents division by zero for null vectors.

---

## How It's Used

### 1. K-means Clustering (lines 283, 298)

Groups similar document chunks into pools:

```javascript
// Find which centroid each vector is closest to
for (let c = 0; c < k; c++) {
  const s = cosineSim(vectors[i], centroids[c]);
  if (s > bestSim) { bestSim = s; best = c; }
}
```

Each chunk is assigned to the pool whose centroid (center point) it's most similar to.

### 2. Pool Linking (lines 374-376)

Connects semantically related pools with lines:

```javascript
const sim = cosineSim(activeCentroids[i], activeCentroids[j]);
if (sim > 0.3) {
  links.push({ source: nodes[i].id, target: nodes[j].id, sim });
}
```

Only pools with **similarity > 0.3** get connected. This threshold filters out weak relationships.

### 3. Link Visualization (lines 402-403)

The similarity score affects how connections are drawn:

```javascript
.attr('stroke-opacity', d => 0.12 + d.sim * 0.25)     // Higher sim = darker line
.attr('stroke-width', d => Math.max(0.5, d.sim * 2))  // Higher sim = thicker line
```

**Visual encoding:**
- More similar pools → darker, thicker connecting lines
- Less similar pools → fainter, thinner lines

---

## Label Extraction

**Location:** `visualize-d3.html` lines 324-333

### What It Does

Generates meaningful 2-word labels for each pool by finding the most frequent important words in all chunks.

### The Code

```javascript
function extractLabel(text) {
  // 1. Extract words 4+ letters long
  const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];

  // 2. Count frequency, skipping stopwords
  const freq = {};
  for (const w of words) {
    if (STOPWORDS.has(w)) continue;
    freq[w] = (freq[w] || 0) + 1;
  }

  // 3. Get top 2 most frequent words
  const top = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])     // Sort by frequency descending
    .slice(0, 2)                      // Take top 2
    .map(([w]) => w.toUpperCase());   // Uppercase

  // 4. Join with space or fallback to 'POOL'
  return top.length ? top.join(' ') : 'POOL';
}
```

### Step-by-Step Process

1. **Combine all text** from chunks in the pool (line 360):
   ```javascript
   label: extractLabel(members.map(m => m.text).join(' '))
   ```

2. **Extract words** ≥ 4 letters:
   ```javascript
   /[a-z]{4,}/g
   ```
   This filters out articles, pronouns, and very short words.

3. **Skip stopwords** (lines 228-238):
   Common words are ignored:
   ```javascript
   'this', 'that', 'with', 'about', 'have', 'been', 'will', etc.
   ```

4. **Count word frequency**:
   ```javascript
   freq['data'] = 15
   freq['workers'] = 12
   freq['systems'] = 8
   ```

5. **Take top 2 words**:
   - Sort by frequency (highest first)
   - Take the 2 most common
   - Convert to uppercase

6. **Join with space**:
   - `['data', 'workers']` → `"DATA WORKERS"`
   - `['small', 'slow']` → `"SMALL SLOW"`

### Example

**Input:** Pool with chunks about:
- "data systems for workers"
- "workers use data daily"
- "managing data workers efficiently"

**Word frequencies:**
- `data`: 3
- `workers`: 3
- `systems`: 1
- `daily`: 1
- `managing`: 1
- `efficiently`: 1

**Output:** `"DATA WORKERS"`

---

## Stopwords List

Words that are filtered out (lines 228-238):

```javascript
const STOPWORDS = new Set([
  'this','that','these','those','with','from','have','has','had',
  'were','was','been','being','they','them','their','there','then',
  'than','which','what','when','where','while','about','into','over',
  'under','after','before','through','during','between','because',
  'also','some','such','only','very','more','most','other','each',
  'every','both','same','just','will','would','should','could',
  'shall','must','might','does','done','doing','your','ours','yours',
  'herself','himself','itself','ourselves','themselves','being','here',
  'above','below','again','further','once','page','pages','document',
  'section','including','http','https','www'
]);
```

These are common English words that don't add semantic meaning to topics.

---

## Why This Matters

### Cosine Similarity
- Enables semantic search without keyword matching
- Groups conceptually similar content even if words differ
- Works in high-dimensional space (hundreds of dimensions)

### Label Extraction
- Provides human-readable summaries of abstract clusters
- Shows what each pool is "about" at a glance
- Helps users navigate and understand the semantic organization

---

## Visual Workflow

```
PDF Documents
     ↓
Extract & Chunk Text
     ↓
Generate Embeddings (Ollama/OpenAI/Google)
     ↓
K-means Clustering (using cosine similarity)
     ↓
Create Pools with Labels (frequency extraction)
     ↓
Link Similar Pools (cosine similarity > 0.3)
     ↓
D3 Force Layout Visualization
```

Each step uses either cosine similarity (for semantic relationships) or label extraction (for human readability).
