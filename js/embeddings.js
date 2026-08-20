/**
 * Embedding Functions
 *
 * Provides a unified interface for different embedding providers:
 * - Ollama (local)
 * - OpenAI
 * - Google Gemini
 */

import { Ollama } from 'ollama';
import { OpenAIEmbeddingFunction, GoogleGenerativeAiEmbeddingFunction } from 'chromadb';
import { config } from './config.js';

/**
 * Create an embedding function based on the configured provider
 */
export function createEmbeddingFunction() {
  const provider = config.EMBEDDING_PROVIDER.toLowerCase();

  switch (provider) {
    case 'openai':
      if (!config.openai.apiKey) {
        throw new Error(
          'OpenAI API key not configured. Set OPENAI_API_KEY environment variable or update config.js'
        );
      }
      return new OpenAIEmbeddingFunction({
        openai_api_key: config.openai.apiKey,
        openai_model: config.openai.model,
        openai_organization_id: config.openai.organization,
      });

    case 'google':
    case 'gemini':
      if (!config.google.apiKey) {
        throw new Error(
          'Google API key not configured. Set GOOGLE_API_KEY environment variable or update config.js'
        );
      }
      return new GoogleGenerativeAiEmbeddingFunction({
        googleApiKey: config.google.apiKey,
        model: config.google.model,
      });

    case 'ollama':
      // For Ollama, we'll use a custom wrapper since it's handled differently
      return null; // Will be handled separately

    default:
      throw new Error(
        `Unknown embedding provider: ${provider}. Choose 'ollama', 'openai', or 'google'.`
      );
  }
}

/**
 * Generate embeddings for text using the configured provider
 * This is used for Ollama which doesn't use ChromaDB's embedding functions
 */
export async function generateEmbedding(text) {
  const provider = config.EMBEDDING_PROVIDER.toLowerCase();

  if (provider === 'ollama') {
    const ollama = new Ollama({ host: config.ollama.host });
    const res = await ollama.embeddings({
      model: config.ollama.model,
      prompt: text,
    });
    return res.embedding;
  }

  throw new Error(
    'generateEmbedding should only be used with Ollama. For other providers, use ChromaDB embedding functions.'
  );
}

/**
 * Check if the current provider uses ChromaDB embedding functions
 */
export function usesChromaEmbeddingFunction() {
  const provider = config.EMBEDDING_PROVIDER.toLowerCase();
  return provider === 'openai' || provider === 'google' || provider === 'gemini';
}

/**
 * Get embedding info for logging
 */
export function getEmbeddingInfo() {
  const provider = config.EMBEDDING_PROVIDER.toLowerCase();

  switch (provider) {
    case 'openai':
      return `OpenAI (${config.openai.model})`;
    case 'google':
    case 'gemini':
      return `Google Gemini (${config.google.model})`;
    case 'ollama':
      return `Ollama (${config.ollama.model})`;
    default:
      return provider;
  }
}

/**
 * Format text with Google Gemini task type prefix
 * For gemini-embedding-2, format: "task: {task_type} | query: {content}"
 *
 * @param {string} text - The text to embed
 * @param {string} taskType - Task type: 'retrieval document', 'search query', 'semantic similarity', 'clustering', 'classification'
 * @returns {string} Formatted text with task prefix
 */
export function formatGoogleTaskText(text, taskType) {
  const provider = config.EMBEDDING_PROVIDER.toLowerCase();

  // Only format for Google Gemini embedding-2
  if ((provider === 'google' || provider === 'gemini') &&
      config.google.model === 'gemini-embedding-2') {
    return `task: ${taskType} | query: ${text}`;
  }

  // Return unmodified for other providers or models
  return text;
}
