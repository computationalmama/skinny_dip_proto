# my_rag — Local RAG Chat

Ask questions about your own PDF documents. Fully offline — no API keys, no cloud, no data leaving your machine.

Available in **Python** and **JavaScript**. Both versions share the same `docs/` folder.

---

## Project Structure

```
my_rag/
│
├── docs/              ← drop your PDFs here
│
├── python/            ← Python version (Flask + ChromaDB)
│   ├── README.md
│   ├── requirements.txt
│   ├── rag.py         ← CLI
│   └── rag_web.py     ← web UI  →  http://localhost:6600
│
└── js/                ← JavaScript version (Express + JSON store)
    ├── README.md
    ├── package.json
    ├── rag.js         ← CLI
    └── rag_web.js     ← web UI  →  http://localhost:6601
```

---

## Stack

| | Python | JavaScript |
|---|---|---|
| Language | Python 3.9+ | Node.js 18+ |
| Web server | Flask | Express |
| Embeddings | Ollama (`nomic-embed-text`) | Ollama (`nomic-embed-text`) |
| LLM | Ollama (`qwen2.5:7b`) | Ollama (`qwen2.5:7b`) |
| Vector store | ChromaDB (persistent) | JSON file + cosine similarity |
| PDF parsing | LangChain + PyPDF | pdf-parse |
| Web port | 6600 | 6601 |

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

- **Python** → see [`python/README.md`](python/README.md)
- **JavaScript** → see [`js/README.md`](js/README.md)

---

## Commands at a glance

| Action | Python | JavaScript |
|---|---|---|
| Install deps | `pip install -r requirements.txt` | `npm install` |
| Build database | `python rag_web.py build` | `node rag_web.js build` |
| Start web UI | `python rag_web.py serve` | `node rag_web.js serve` |
| Interactive CLI | `python rag.py` | `node rag.js` |
| Ask one question | `python rag.py ask "..."` | `node rag.js ask "..."` |
| Check DB stats | `python rag.py stats` | `node rag.js stats` |

---

## Notes

- The Python and JS versions use **separate databases** — you need to run `build` once for each version you want to use
- Both databases are gitignored and auto-generated
- You can run both web servers at the same time (different ports) to compare them side by side
