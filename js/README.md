# JavaScript Version

## Requirements

- Node.js 18+
- Python + ChromaDB (for the vector database server)
- [Ollama](https://ollama.com/download) installed and running

## Setup

```bash
# 1. Pull Ollama models
ollama pull nomic-embed-text
ollama pull qwen2.5:7b

# 2. Install ChromaDB (Python package — provides the database server)
pip install chromadb

# 3. Install Node dependencies
cd js
npm install
```

## Starting ChromaDB

The JS version connects to ChromaDB running as a local HTTP server.
You need to start it in a separate terminal before running any commands:

```bash
# Run this from the project root (my_rag/)
chroma run --path ./rag_database
```

Leave this terminal running. ChromaDB listens on `http://localhost:8000`.

> **Why?** The Python version embeds ChromaDB directly in-process.
> The JavaScript client doesn't support embedded mode — it connects over HTTP instead.

## Usage

Open a second terminal in the `js/` folder.

### Build the database

Drop PDFs into `../docs/` first, then:

```bash
node rag_web.js build   # for web version
node rag.js build       # for CLI version
```

### Web interface

```bash
node rag_web.js serve
```

Open `http://localhost:6601` in your browser.

### CLI — interactive mode

```bash
node rag.js
```

### CLI — single question

```bash
node rag.js ask "what is this document about?"
```

### CLI — check database stats

```bash
node rag.js stats
```

## Running order (summary)

```
Terminal 1: chroma run --path ./rag_database   ← keep running
Terminal 2: node rag_web.js build              ← run once
Terminal 2: node rag_web.js serve              ← start the app
```

## Customization

### Change the model

In `rag.js` or `rag_web.js`, at the top of the file:

```js
const LLM_MODEL = 'llama3.2:1b';   // faster, less accurate
const LLM_MODEL = 'llama3.1:8b';   // slower, more accurate
```

### Change chunk size

```js
const CHUNK_SIZE    = 500;
const CHUNK_OVERLAP = 50;
```

### Change number of retrieved chunks

```js
const results = await collection.query({
  queryEmbeddings: [res.embedding],
  nResults: 3,   // increase to pull more context
});
```

### Change the port

```js
const PORT = 6601;
```

## Troubleshooting

**"Connection refused" or ChromaDB errors**

ChromaDB server isn't running. Start it first:
```bash
chroma run --path ./rag_database
```

**"No database found"**
```bash
node rag_web.js build
```

**Port already in use**
```bash
lsof -i :6601        # Mac/Linux
netstat -ano | findstr :6601   # Windows
```

**Slow responses**
- Switch to a smaller model
- Reduce `nResults` in the query
- Check Ollama is using GPU: `ollama ps`
