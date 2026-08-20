# Embedding Provider Guide

This RAG system now supports three embedding providers: Ollama (local), OpenAI, and Google Gemini.

## Quick Start

### 1. Ollama (Default - Free, Local)

Already configured! Just make sure Ollama is running:

```bash
ollama pull nomic-embed-text
npm run build
npm run serve
```

### 2. OpenAI Embeddings

```bash
# Set API key
export OPENAI_API_KEY="sk-..."
export EMBEDDING_PROVIDER="openai"

# Build and serve
npm run build
npm run serve
```

**Models available:**
- `text-embedding-3-small` (default, faster, cheaper)
- `text-embedding-3-large` (higher quality)
- `text-embedding-ada-002` (legacy)

### 3. Google Gemini Embeddings

```bash
# Set API key
export GOOGLE_API_KEY="..."
export EMBEDDING_PROVIDER="google"

# Build and serve
npm run build
npm run serve
```

**Models available:**
- `embedding-001` (default)
- `text-embedding-004` (newer)

## Configuration

### Via Environment Variables (Recommended)

Create a `.env` file or export variables:

```bash
EMBEDDING_PROVIDER=ollama  # or 'openai' or 'google'
OPENAI_API_KEY=sk-...      # if using OpenAI
GOOGLE_API_KEY=...         # if using Google
```

### Via config.js

Edit `js/config.js` directly:

```javascript
export const config = {
  EMBEDDING_PROVIDER: 'openai', // Change this

  openai: {
    apiKey: 'sk-...',
    model: 'text-embedding-3-small',
  },

  google: {
    apiKey: '...',
    model: 'embedding-001',
  },

  ollama: {
    model: 'nomic-embed-text',
    host: 'http://localhost:11434',
  },
};
```

## How It Works

### Architecture

1. **Ollama** - Generates embeddings manually and passes them to ChromaDB
2. **OpenAI/Google** - Uses ChromaDB's built-in embedding functions (more efficient)

### Build Process

When you run `npm run build`:
1. PDFs are parsed from `docs/` folder
2. Text is chunked into pieces
3. Each chunk is embedded using your chosen provider
4. Embeddings are stored in ChromaDB

### Query Process

When you ask a question:
1. Question is embedded using the same provider
2. ChromaDB finds most similar chunks
3. Context is sent to Ollama LLM for answer generation

## Important Notes

- **Switching providers requires rebuilding** - Embeddings from different providers are not compatible
- **API costs** - OpenAI and Google charge per token embedded
- **Speed** - OpenAI/Google are faster for large datasets (batch processing)
- **Privacy** - Ollama keeps everything local

## Troubleshooting

### OpenAI "Unauthorized" error
Check your API key is valid and has credits

### Google API error
Ensure you've enabled the Generative Language API in Google Cloud Console

### Ollama connection refused
Make sure Ollama is running: `ollama serve`

## File Structure

```
js/
├── config.js          ← Main configuration
├── embeddings.js      ← Provider abstraction layer
├── rag.js            ← CLI interface
├── rag_web.js        ← Web interface
└── .env.example      ← Environment template
```
