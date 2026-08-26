/**
 * Embedding Configuration
 *
 * Choose your embedding provider by setting EMBEDDING_PROVIDER.
 * Options: 'ollama', 'openai', 'google'
 */

export const config = {
  // Embedding provider: 'ollama', 'openai', or 'google'
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'google',

  // Ollama settings
  ollama: {
    model: 'nomic-embed-text',
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
  },

  // OpenAI settings
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'text-embedding-3-small', // or 'text-embedding-3-large', 'text-embedding-ada-002'
    organization: process.env.OPENAI_ORGANIZATION || undefined,
  },

  // Google Gemini settings
  google: {
    apiKey: process.env.GOOGLE_API_KEY || '',
    // Valid embedding models: 'gemini-embedding-001' (GA) or 'gemini-embedding-2'.
    // Both return 3072-dim vectors. Note: switching models invalidates an existing
    // collection — the vectors aren't comparable, so re-run build after changing this.
    model: process.env.GOOGLE_EMBED_MODEL || 'gemini-embedding-001',

    // Task types tell Gemini what the embedding is FOR, and it optimizes accordingly.
    // These are real API enum values passed as the `taskType` request field - the API
    // rejects anything outside its enum.
    //
    // Retrieval is asymmetric on purpose: documents are indexed as RETRIEVAL_DOCUMENT
    // and questions are embedded as RETRIEVAL_QUERY, so the two are optimized to match
    // each other rather than each being compared to its own kind.
    taskType: {
      indexing: 'RETRIEVAL_DOCUMENT',   // build: embedding the chunks we store
      querying: 'RETRIEVAL_QUERY',      // ask: embedding the user's question
      visualization: 'SEMANTIC_SIMILARITY', // clustering: content-to-content matching
    },
  },

  // Gemini generation, used by the zoom pipeline (see gemini.js, zoom.js).
  // Kept separate from `google` above, which is embeddings only.
  gemini: {
    // 2.5-flash is closed to new keys — the API itself points at 3.6-flash.
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  },

  // LLM settings (for answer generation)
  llm: {
    model: process.env.LLM_MODEL || 'qwen2.5:7b',
  },

  // RAG settings
  rag: {
    chunkSize: 500,
    overlap: 50,
    nResults: 3,
  },
};
