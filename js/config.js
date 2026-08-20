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
    model: 'gemini-embedding-1', // newer model, try this first
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
