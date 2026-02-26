# Python Version

## Requirements

- Python 3.9+
- [Ollama](https://ollama.com/download) installed and running

## Setup

```bash
# 1. Pull Ollama models
ollama pull nomic-embed-text
ollama pull qwen2.5:7b

# 2. Install Python dependencies
pip install -r requirements.txt
```

## Usage

All commands are run from inside the `python/` folder.

### Build the database

Drop PDFs into `../docs/` first, then:

```bash
python rag_web.py build   # for web version
python rag.py build       # for CLI version
```

### Web interface

```bash
python rag_web.py serve
```

Open `http://localhost:6600` in your browser.

### CLI — interactive mode

```bash
python rag.py
```

### CLI — single question

```bash
python rag.py ask "what is this document about?"
```

### CLI — check database stats

```bash
python rag.py stats
```

## Customization

### Change the model

In `rag.py` or `rag_web.py`, inside `SimpleRAG.__init__()`:

```python
self.llm = Ollama(model="llama3.2:1b")   # faster, less accurate
self.llm = Ollama(model="llama3.1:8b")   # slower, more accurate
```

### Change chunk size

```python
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,    # increase for more context per chunk
    chunk_overlap=50
)
```

### Change number of retrieved chunks

```python
results = collection.query(
    query_embeddings=[q_embedding],
    n_results=3   # increase to pull more context
)
```

### Change the port

```python
app.run(host='0.0.0.0', port=6600, debug=False)
```

## Troubleshooting

**"No database found"**
```bash
python rag_web.py build
```

**"Address already in use"**
```bash
lsof -i :6600        # Mac/Linux
netstat -ano | findstr :6600   # Windows
```

**Slow responses**
- Switch to a smaller model
- Reduce `n_results` in the query
- Check Ollama is using GPU: `ollama ps`
