# Supported File Formats

The RAG system now supports multiple document formats beyond PDFs.

---

## Supported Formats

### 1. PDF Files (.pdf)

**How it works:** Uses `pdf-parse` library to extract text from PDF documents.

**Usage:**
```bash
# Just drop PDF files in docs/ folder
cp my-document.pdf docs/
npm run build
```

**Features:**
- Extracts all text content
- Handles multi-page documents
- Preserves text order

**Limitations:**
- Scanned PDFs (images) won't work without OCR
- Complex layouts may have extraction issues
- Tables and formatting are lost

---

### 2. Markdown Files (.md)

**How it works:** Reads the entire file as plain text (UTF-8).

**Usage:**
```bash
# Drop markdown files in docs/ folder
cp notes.md docs/
npm run build
```

**Example markdown file:**
```markdown
# My Research Notes

## Topic 1: Small AI

Small AI focuses on efficient, local models...

## Topic 2: Embedding Models

Embeddings transform text into vectors...
```

**Features:**
- Simple and fast
- Preserves all text including headers
- Works with any .md file

**Best for:**
- Documentation
- Research notes
- README files
- Any text-heavy content

---

### 3. Plain Text Files (.txt)

**How it works:** Reads the entire file as plain text (UTF-8) — the same read as markdown, minus the heading-aware chunking.

**Usage:**
```bash
# Drop .txt files in docs/ folder
cp transcript.txt docs/
npm run build
```

**Features:**
- No parsing step at all, so nothing can be lost in extraction
- Chunked by paragraph/sentence structure rather than by headings

**Best for:**
- Transcripts and interview notes
- Log or export dumps
- Anything already flattened to prose

**Note:** Because `.txt` has no heading structure, chunks are split with the
`recursive` or `sentence` strategy (see `CHUNKING_STRATEGIES.md`). If your text
does have headings, save it as `.md` to get heading-aligned chunks instead.

---

### 4. JSON Lines (.jsonl)

**How it works:** Parses each line as a JSON object and extracts text from specific fields.

**Default fields extracted:**
- `text`
- `content`
- `body`
- `message`
- `title`
- `description`

**Usage:**
```bash
# Drop .jsonl files in docs/ folder
cp data.jsonl docs/
npm run build
```

**Example .jsonl file:**
```jsonl
{"text": "First document about AI", "author": "Alice", "date": "2024-01-01"}
{"text": "Second document about ML", "author": "Bob", "date": "2024-01-02"}
{"content": "Third document uses content field", "type": "article"}
```

Each line is a separate JSON object (not a JSON array!).

**Features:**
- Flexible field extraction
- Handles nested fields
- Skips invalid JSON lines with warnings
- Concatenates multiple fields per object

**Best for:**
- Chat logs/conversations
- Structured datasets
- Export from databases
- API responses

---

## JSONL Field Configuration

### Default Behavior

The parser automatically looks for these fields (in order):
1. `text`
2. `content`
3. `body`
4. `message`
5. `title`
6. `description`

If multiple fields exist in one object, they're all concatenated.

### Custom Fields

You can customize which fields to extract by modifying `parsers.js`:

```javascript
// In parsers.js
export async function parseJSONL(filePath, options = {}) {
  const {
    fields = ['custom_field', 'another_field'],  // Your fields here
    separator = '\n\n'
  } = options;
  // ... rest of function
}
```

Then call it with options:

```javascript
// In rag.js build() function
const text = await parseDocument(doc.path, {
  fields: ['question', 'answer'],  // For Q&A datasets
  separator: ' | '
});
```

### Nested Fields

The parser supports nested field access:

```jsonl
{"data": {"text": "Nested content here"}, "id": 123}
```

Configure with dot notation:

```javascript
fields: ['data.text', 'metadata.description']
```

---

## Example JSONL Formats

### Chat/Conversation Format

```jsonl
{"role": "user", "content": "What is machine learning?", "timestamp": "2024-01-01T10:00:00Z"}
{"role": "assistant", "content": "Machine learning is a subset of AI...", "timestamp": "2024-01-01T10:00:15Z"}
{"role": "user", "content": "Can you give examples?", "timestamp": "2024-01-01T10:01:00Z"}
```

**Config:** `fields: ['content']`

### Article/Blog Format

```jsonl
{"title": "Introduction to AI", "body": "Artificial intelligence has revolutionized...", "tags": ["ai", "tech"]}
{"title": "Deep Learning Basics", "body": "Neural networks form the foundation...", "tags": ["ml", "neural-nets"]}
```

**Config:** `fields: ['title', 'body']`

### Knowledge Base Format

```jsonl
{"question": "How do embeddings work?", "answer": "Embeddings convert text into vectors...", "category": "ml"}
{"question": "What is RAG?", "answer": "Retrieval Augmented Generation combines...", "category": "llm"}
```

**Config:** `fields: ['question', 'answer']`

---

## File Discovery

The system recursively searches the `docs/` folder for all supported file types.

**Directory structure example:**
```
docs/
├── research/
│   ├── paper1.pdf
│   └── notes.md
├── conversations/
│   └── chat-logs.jsonl
└── overview.md
```

All files will be found and processed automatically.

---

## Build Output

When you run `npm run build`, you'll see which files were processed:

```bash
Found 8 document(s):
  - 5 PDF file(s)
  - 2 MD file(s)
  - 1 JSONL file(s)
Using embeddings: Ollama (nomic-embed-text)
Parsing...
  ✓ research-paper.pdf (pdf)
  ✓ notes.md (md)
  ✓ conversations.jsonl (jsonl)
  ✓ overview.md (md)
Split into 342 chunks. Embedding...
  10 / 342
  ...
Done. 342 chunks stored.
```

---

## Error Handling

### Skipped Files

Files with no text content are skipped:

```
  Skipping empty.md - no text content
```

### Failed Files

Files that fail to parse show an error:

```
  ✗ corrupted.pdf - Unexpected end of file
```

The build continues with other files.

### Invalid JSON Lines

For JSONL files, invalid lines are skipped with a warning:

```
Skipping invalid JSON line in data.jsonl: {"incomplete": true
```

---

## Performance Considerations

### File Size Recommendations

| Format | Recommended Max Size | Notes |
|--------|---------------------|-------|
| PDF | < 50 MB | Large PDFs are slow to parse |
| Markdown | < 10 MB | Very fast, size less important |
| JSONL | < 100 MB | Fast line-by-line processing |

### Large Datasets

For very large JSONL files, consider:
1. Splitting into multiple smaller files
2. Pre-filtering to relevant entries only
3. Using the batch processing in the parser

---

## Adding New File Types

To add support for a new file type:

1. **Add parser function** to `parsers.js`:

```javascript
export async function parseYAML(filePath) {
  // Your parsing logic
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = YAML.parse(content);
  return data.content; // Return text string
}
```

2. **Update parseDocument()** in `parsers.js`:

```javascript
export async function parseDocument(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await parsePDF(filePath);
    case '.md':
      return await parseMarkdown(filePath);
    case '.jsonl':
      return await parseJSONL(filePath, options);
    case '.yaml':  // Add your new format
    case '.yml':
      return await parseYAML(filePath);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}
```

3. **Update file discovery** (optional):

```javascript
const documents = findDocuments(DOCS_PATH, ['.pdf', '.md', '.txt', '.jsonl', '.yaml']);
```

4. **Install dependencies** if needed:

```bash
npm install js-yaml
```

---

## Troubleshooting

### "No documents found"

**Problem:** Build shows no files found.

**Solutions:**
- Check files are in `docs/` folder
- Verify file extensions (.pdf, .md, .txt, .jsonl)
- Check file permissions

### "Skipping X - no text content"

**Problem:** File found but no text extracted.

**Solutions:**
- **PDF:** May be scanned (images only)
- **Markdown:** File might be empty
- **JSONL:** Check field names match defaults

### "Unexpected end of file"

**Problem:** PDF parsing error.

**Solutions:**
- File may be corrupted
- Try re-downloading or re-saving the PDF
- Use a PDF repair tool

### JSONL extraction issues

**Problem:** Not extracting the right fields.

**Solutions:**
1. Check your JSON structure:
   ```bash
   head -1 docs/your-file.jsonl | jq
   ```

2. Update field configuration in `parsers.js`

3. Ensure one JSON object per line (not a JSON array)

---

## Examples

### Convert CSV to JSONL

```python
import csv
import json

with open('data.csv', 'r') as f:
    reader = csv.DictReader(f)
    with open('data.jsonl', 'w') as out:
        for row in reader:
            json.dump(row, out)
            out.write('\n')
```

### Export Notion to Markdown

1. In Notion, go to "..." → "Export"
2. Choose "Markdown & CSV"
3. Unzip and copy .md files to `docs/`

### Prepare Chat Logs

```javascript
// Convert array of messages to JSONL
const messages = [
  {user: "Alice", text: "Hello"},
  {user: "Bob", text: "Hi there"}
];

messages.forEach(msg => {
  console.log(JSON.stringify(msg));
});
```

Redirect output to `.jsonl` file:
```bash
node export-chat.js > docs/chat.jsonl
```

---

## Best Practices

1. **Use descriptive filenames** - Sources are shown in search results
2. **Organize by topic** - Use subdirectories in `docs/`
3. **Clean your data** - Remove irrelevant content before indexing
4. **Test with small files first** - Verify format works before bulk import
5. **Check chunk counts** - More chunks = better granularity but slower search
6. **Rebuild after changes** - Run `npm run build` whenever you add/update files

---

## Next Steps

- Drop documents in `docs/` folder
- Run `npm run build` to index them
- Query via CLI (`node rag.js`) or web UI (`npm run serve`)
- View semantic clusters in visualizations (`/visualize-d3.html`)
