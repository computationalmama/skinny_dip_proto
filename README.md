# my_rag — Local RAG Chat

A fully offline Retrieval-Augmented Generation (RAG) system. Drop in PDFs, ask questions, get answers with source citations. Runs entirely on your machine using Ollama + ChromaDB.

---

## Stack

| Component | Tool |
|-----------|------|
| Embeddings | `nomic-embed-text` via Ollama |
| LLM | `qwen2.5:7b` via Ollama |
| Vector DB | ChromaDB (local persistent) |
| Web UI | Flask |
| PDF loading | LangChain + PyPDF |

---

## Requirements

- [Ollama](https://ollama.ai) installed and running
- Python 3.9+

```bash
# Pull required models
ollama pull nomic-embed-text
ollama pull qwen2.5:7b

# Install Python dependencies
pip install flask chromadb langchain langchain-community pypdf
```

---

## Quick Start

### 1. Add your PDFs

Drop PDF files into the `docs/` folder.

### 2. Build the database

```bash
python rag_web.py build
```

### 3. Start the web interface

```bash
python rag_web.py serve
```

### 4. Open in browser

```
http://localhost:6600
```

---

## Commands

```bash
python rag_web.py build   # Index PDFs into ChromaDB
python rag_web.py serve   # Start web server on port 6600
```

---

## File Structure

```
my_rag/
├── rag_web.py        # Main app (Flask + RAG logic)
├── rag.py            # CLI-only version
├── docs/             # Put your PDFs here
└── rag_database/     # Auto-generated ChromaDB vector store
```

The web and CLI versions share the same `rag_database/`.

---

## UI

Brutalist design — monospace font, hard black borders, pale yellow accent (`#F5F5A0`), no gradients or rounded corners.

---

## Customization

### Change the model

In `rag_web.py`, inside `SimpleRAG.__init__()`:

```python
self.llm = Ollama(model="llama3.2:1b")   # faster
self.llm = Ollama(model="llama3.1:8b")   # better quality
```

### Change the port

```python
app.run(host='0.0.0.0', port=6600, debug=False)
```

### Change chunk size

```python
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,   # characters per chunk
    chunk_overlap=50
)
```

### Change number of retrieved chunks

```python
results = collection.query(
    query_embeddings=[q_embedding],
    n_results=3   # increase for more context
)
```

---

## Access from Other Devices

```bash
# Find your local IP (Mac)
ifconfig | grep "inet "

# Then on any device on the same network:
http://YOUR_IP:6600
```

---

## Troubleshooting

**"No database found"**
```bash
python rag_web.py build
```

**"Address already in use"**
```bash
lsof -i :6600   # find what's using the port
```

**Slow responses**
- Switch to a smaller model (`llama3.2:1b`)
- Reduce `n_results` in the query
- Ensure Ollama is using GPU: `ollama ps`

**No PDFs found**
- Make sure files are in `docs/` with a `.pdf` extension
- Subdirectories are supported (`docs/**/*.pdf`)

---
