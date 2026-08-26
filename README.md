# skinny dip proto
---
## Project Structure

```
skinny_dip_proto/
│
├── docs/              ← drop your documents here (.pdf, .md, .jsonl)
│
├── js/                ← JavaScript version (Express + ChromaDB)
│   ├── README.md
│   ├── package.json
│   ├── rag.js         ← CLI
│   ├── rag_web.js     ← web UI  →  http://localhost:6601
│   └── export-static.js ← seeds canvas as a static site  →  dist/
│
└── worker/            ← Cloudflare Worker holding the Gemini key, so the
                          hosted canvas can answer typed questions live
```

The seeds canvas also runs with no server at all — `npm run export:static`
precomputes what it used to ask ChromaDB for, and `npm run deploy` puts it on
GitHub Pages. See [Hosting on GitHub Pages](js/README.md#hosting-on-github-pages).

---

## Stack

|  | JavaScript |
|---|---|
| Language |  Node.js 18+ |
| Web server |  Express |
| Embeddings |  Ollama (default), OpenAI, or Google Gemini |
| LLM |  Ollama (`qwen2.5:7b`) |
| Vector store |  ChromaDB |
| PDF parsing |  pdf-parse |
| Web port |  6601 |

---

## Quick Start
### 0. Clone the repo
 
`git clone https://github.com/computationalmama/skinny_dip_proto.git`

### 1. Install Ollama and pull models

Download from [ollama.com/download](https://ollama.com/download), then:

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5:7b
```

### 2. Add your documents

Copy your documents into the `docs/` folder. Supported formats:
- **PDF** (.pdf) - Extracted using pdf-parse
- **Markdown** (.md) - Plain text extraction
- **JSON Lines** (.jsonl) - Extracts from text/content/body/message fields

### 3. Install README link

- **JavaScript** → see [`js/README.md`](js/README.md)

---

## Embedding Provider Configuration

The project supports three embedding providers:
- **Ollama** (default, local)
- **OpenAI**
- **Google Gemini**

### Option 1: Ollama (Default)

No additional configuration needed. Make sure Ollama is running with the embedding model:

```bash
ollama pull nomic-embed-text
```

### Option 2: OpenAI

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Set your API key as an environment variable:

```bash
export OPENAI_API_KEY="your-api-key-here"
export EMBEDDING_PROVIDER="openai"
```

Or edit `js/config.js`:

```javascript
export const config = {
  EMBEDDING_PROVIDER: 'openai',
  openai: {
    apiKey: 'your-api-key-here',
    model: 'text-embedding-3-small', // or 'text-embedding-3-large'
  },
  // ...
};
```

### Option 3: Google Gemini

1. Get an API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Set your API key as an environment variable:

```bash
export GOOGLE_API_KEY="your-api-key-here"
export EMBEDDING_PROVIDER="google"
```

Or edit `js/config.js`:

```javascript
export const config = {
  EMBEDDING_PROVIDER: 'google',
  google: {
    apiKey: 'your-api-key-here',
    model: 'embedding-001', // or 'text-embedding-004'
  },
  // ...
};
```

After changing the embedding provider, rebuild your database:

```bash
cd js
npm run build
```

---

## Notes
You can check out more info about the embedding viz in the doc: [VISUALIZE](js/VISUALIZE.md)
