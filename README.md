# skinny dip proto
---

## Project Structure

```
skinny_dip_proto/
│
├── docs/              ← drop your PDFs here
│
└── js/                ← JavaScript version (Express + ChromaDB)
    ├── README.md
    ├── package.json
    ├── rag.js         ← CLI
    └── rag_web.js     ← web UI  →  http://localhost:6601
```

---

## Stack

|  | JavaScript |
|---|---|
| Language |  Node.js 18+ |
| Web server |  Express |
| Embeddings |  Ollama (`nomic-embed-text`) |
| LLM |  Ollama (`qwen2.5:7b`) |
| Vector store |  ChromaDB |
| PDF parsing |  pdf-parse |
| Web port |  6601 |

---

## Quick Start

### 1. Install Ollama and pull models

Download from [ollama.com/download](https://ollama.com/download), then:

```bash
ollama pull nomic-embed-text
ollama pull qwen2.5:7b
```

### 2. Add your PDFs

Copy PDF files into the `docs/` folder.

### 3. Pick a version and follow its README

- **JavaScript** → see [`js/README.md`](js/README.md)

---

## Notes
You can check out more info about the embedding viz in the doc: [VISUALIZE](js/VISUALIZE.md)
