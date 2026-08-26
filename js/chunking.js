/**
 * Advanced Text Chunking Strategies
 *
 * Provides multiple chunking methods optimized for different document types:
 * - Character-based (simple, fast)
 * - Sentence-based (respects sentence boundaries)
 * - Paragraph-based (respects paragraph structure)
 * - Recursive (tries paragraphs → sentences → characters)
 * - Markdown-aware (respects heading structure)
 */

import { config } from './config.js';

/**
 * Simple character-based chunking (original method)
 * Fast but may split mid-sentence
 */
export function chunkByCharacter(text, chunkSize = 500, overlap = 50) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}

/**
 * Split text into sentences using common sentence endings
 */
function splitIntoSentences(text) {
  // Match sentence endings: . ! ? followed by space or end of string
  // Handles common abbreviations (Dr., Mr., etc.)
  const sentenceRegex = /(?<![A-Z])(?<!\d)([.!?]+)\s+(?=[A-Z])|([.!?]+)$/g;

  const sentences = [];
  let lastIndex = 0;
  let match;

  // Split on sentence boundaries
  const parts = text.split(/([.!?]+\s+|[.!?]+$)/);
  let currentSentence = '';

  for (let i = 0; i < parts.length; i++) {
    currentSentence += parts[i];

    // If this part is a sentence ending, finalize the sentence
    if (/[.!?]+\s*$/.test(parts[i]) && currentSentence.trim()) {
      sentences.push(currentSentence.trim());
      currentSentence = '';
    }
  }

  // Add any remaining text
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }

  return sentences.filter(s => s.length > 0);
}

/**
 * Sentence-based chunking
 * Respects sentence boundaries, combines sentences until reaching target size
 */
export function chunkBySentence(text, chunkSize = 500, overlap = 1) {
  const sentences = splitIntoSentences(text);
  const chunks = [];

  let currentChunk = '';
  let overlapSentences = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;

    // If adding this sentence exceeds chunk size and we have content, finalize chunk
    if (potentialChunk.length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());

      // Start next chunk with overlap sentences
      currentChunk = overlapSentences.join(' ') + (overlapSentences.length ? ' ' : '') + sentence;
      overlapSentences = [sentence];
    } else {
      currentChunk = potentialChunk;

      // Keep track of last N sentences for overlap
      overlapSentences.push(sentence);
      if (overlapSentences.length > overlap) {
        overlapSentences.shift();
      }
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Split text into paragraphs
 */
function splitIntoParagraphs(text) {
  // Split on double newlines or multiple newlines
  return text
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Paragraph-based chunking
 * Keeps paragraphs intact, combines until reaching target size
 */
export function chunkByParagraph(text, chunkSize = 500, overlap = 1) {
  const paragraphs = splitIntoParagraphs(text);
  const chunks = [];

  let currentChunk = '';
  let overlapParagraphs = [];

  for (const paragraph of paragraphs) {
    const potentialChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;

    // If adding this paragraph exceeds size and we have content, finalize
    if (potentialChunk.length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());

      // Start next chunk with overlap
      currentChunk = overlapParagraphs.join('\n\n') +
                     (overlapParagraphs.length ? '\n\n' : '') + paragraph;
      overlapParagraphs = [paragraph];
    } else {
      currentChunk = potentialChunk;

      // Track paragraphs for overlap
      overlapParagraphs.push(paragraph);
      if (overlapParagraphs.length > overlap) {
        overlapParagraphs.shift();
      }
    }
  }

  // Add final chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Recursive chunking - tries progressively finer splits
 * Order: paragraphs → sentences → characters
 */
export function chunkRecursive(text, chunkSize = 500, overlap = 50) {
  const chunks = [];

  // First try splitting by paragraphs
  const paragraphs = splitIntoParagraphs(text);

  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      // Paragraph fits, use it as-is
      chunks.push(paragraph);
    } else {
      // Paragraph too large, try splitting by sentences
      const sentences = splitIntoSentences(paragraph);

      let currentChunk = '';
      for (const sentence of sentences) {
        if (sentence.length > chunkSize) {
          // Sentence itself is too large, split by characters
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }

          const charChunks = chunkByCharacter(sentence, chunkSize, overlap);
          chunks.push(...charChunks);
        } else {
          const potentialChunk = currentChunk + (currentChunk ? ' ' : '') + sentence;

          if (potentialChunk.length > chunkSize && currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
          } else {
            currentChunk = potentialChunk;
          }
        }
      }

      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
    }
  }

  return chunks;
}

/**
 * Extract markdown sections based on headers
 */
function extractMarkdownSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let currentSection = { level: 0, title: '', content: '' };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headerMatch) {
      // Save previous section if it has content
      if (currentSection.content.trim()) {
        sections.push({ ...currentSection });
      }

      // Start new section
      const level = headerMatch[1].length;
      const title = headerMatch[2].trim();
      currentSection = {
        level,
        title,
        content: line + '\n' // Include the header in content
      };
    } else {
      currentSection.content += line + '\n';
    }
  }

  // Add final section
  if (currentSection.content.trim()) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Markdown-aware chunking
 * Respects heading structure and keeps sections together when possible
 */
export function chunkMarkdown(text, chunkSize = 500, overlap = 50) {
  const sections = extractMarkdownSections(text);
  const chunks = [];

  for (const section of sections) {
    const sectionText = section.content.trim();

    if (sectionText.length <= chunkSize) {
      // Section fits, use it as-is
      chunks.push(sectionText);
    } else {
      // Section too large, use recursive chunking but preserve header
      const lines = sectionText.split('\n');
      const header = lines[0].match(/^#{1,6}\s+/) ? lines[0] : '';
      const body = header ? lines.slice(1).join('\n') : sectionText;

      // Chunk the body
      const bodyChunks = chunkRecursive(body, chunkSize - header.length - 2, overlap);

      // Add header to each chunk from this section
      for (const chunk of bodyChunks) {
        const chunkWithHeader = header ? `${header}\n\n${chunk}` : chunk;
        chunks.push(chunkWithHeader.trim());
      }
    }
  }

  return chunks.length > 0 ? chunks : [text]; // Fallback if no chunks created
}

/**
 * Smart chunking - automatically chooses best strategy based on content
 */
export function chunkSmart(text, fileType = 'text', chunkSize = 500, overlap = 50) {
  // For markdown files, use markdown-aware chunking
  if (fileType === 'md' || fileType === 'markdown') {
    return chunkMarkdown(text, chunkSize, overlap);
  }

  // For structured text with clear paragraphs, use recursive
  const paragraphCount = splitIntoParagraphs(text).length;
  const avgParagraphLength = text.length / Math.max(paragraphCount, 1);

  if (paragraphCount > 2 && avgParagraphLength < chunkSize * 2) {
    return chunkRecursive(text, chunkSize, overlap);
  }

  // For long-form text without clear structure, use sentence-based
  return chunkBySentence(text, chunkSize, Math.max(1, Math.floor(overlap / 100)));
}

/**
 * Main chunking function - uses strategy from config
 *
 * @param {string} text - Text to chunk
 * @param {string} fileType - File type hint ('pdf', 'md', 'txt', 'jsonl', etc.)
 * @returns {string[]} Array of text chunks
 */
export function chunkText(text, fileType = 'text') {
  const strategy = config.rag.chunkingStrategy || 'smart';
  const chunkSize = config.rag.chunkSize || 500;
  const overlap = config.rag.overlap || 50;

  switch (strategy.toLowerCase()) {
    case 'character':
      return chunkByCharacter(text, chunkSize, overlap);

    case 'sentence':
      return chunkBySentence(text, chunkSize, Math.max(1, Math.floor(overlap / 100)));

    case 'paragraph':
      return chunkByParagraph(text, chunkSize, Math.max(1, Math.floor(overlap / 100)));

    case 'recursive':
      return chunkRecursive(text, chunkSize, overlap);

    case 'markdown':
      return chunkMarkdown(text, chunkSize, overlap);

    case 'smart':
    default:
      return chunkSmart(text, fileType, chunkSize, overlap);
  }
}

/**
 * Get information about chunking configuration
 */
export function getChunkingInfo() {
  const strategy = config.rag.chunkingStrategy || 'smart';
  const chunkSize = config.rag.chunkSize || 500;

  return `${strategy} (${chunkSize} chars)`;
}
