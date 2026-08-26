/**
 * Document Parsers
 *
 * Handles parsing different file types into text:
 * - PDF files (.pdf)
 * - Markdown files (.md)
 * - Plain text files (.txt)
 * - JSON Lines files (.jsonl)
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse a PDF file into text
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} Extracted text
 */
export async function parsePDF(filePath) {
  const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
  const data = await pdfParse(fs.readFileSync(filePath));
  return data.text;
}

/**
 * Parse a plain text file
 *
 * No transformation needed - the file is already text. Markdown uses this too,
 * since the heading structure is preserved for the chunker to split on.
 *
 * @param {string} filePath - Path to .txt file
 * @returns {Promise<string>} File contents
 */
export async function parseText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Parse a Markdown file into text
 * @param {string} filePath - Path to .md file
 * @returns {Promise<string>} File contents
 */
export async function parseMarkdown(filePath) {
  return parseText(filePath);
}

/**
 * Parse a JSONL file into text
 *
 * JSONL files contain one JSON object per line. This parser extracts text from
 * specified fields in each object.
 *
 * Default fields to extract: 'text', 'content', 'body', 'message'
 *
 * You can customize which fields to extract by passing a config object:
 * parseJSONL(filePath, { fields: ['custom_field', 'another_field'] })
 *
 * @param {string} filePath - Path to .jsonl file
 * @param {Object} options - Parsing options
 * @param {string[]} options.fields - Fields to extract text from (default: ['text', 'content', 'body', 'message'])
 * @param {string} options.separator - How to join multiple fields (default: '\n\n')
 * @returns {Promise<string>} Concatenated text from all lines
 */
export async function parseJSONL(filePath, options = {}) {
  const {
    fields = ['text', 'content', 'body', 'message', 'title', 'description'],
    separator = '\n\n'
  } = options;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const extractedTexts = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const texts = [];

      // Extract text from specified fields
      for (const field of fields) {
        if (obj[field]) {
          // Handle nested fields (e.g., 'data.text')
          const value = field.split('.').reduce((o, key) => o?.[key], obj);
          if (typeof value === 'string' && value.trim()) {
            texts.push(value.trim());
          } else if (typeof value === 'object') {
            // If the field is an object, stringify it
            texts.push(JSON.stringify(value));
          }
        }
      }

      if (texts.length > 0) {
        extractedTexts.push(texts.join(' '));
      }
    } catch (e) {
      console.warn(`Skipping invalid JSON line in ${path.basename(filePath)}: ${line.slice(0, 50)}...`);
    }
  }

  return extractedTexts.join(separator);
}

/**
 * Find all supported document files in a directory (recursive)
 * @param {string} dir - Directory to search
 * @param {string[]} extensions - File extensions to include (default: ['.pdf', '.md', '.txt', '.jsonl'])
 * @returns {Array<{path: string, type: string}>} Array of file info objects
 */
export function findDocuments(dir, extensions = ['.pdf', '.md', '.txt', '.jsonl']) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findDocuments(fullPath, extensions));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push({
          path: fullPath,
          type: ext.slice(1), // Remove the dot
          name: entry.name
        });
      }
    }
  }

  return results;
}

/**
 * Parse any supported document type
 * @param {string} filePath - Path to document
 * @param {Object} options - Parser options (for JSONL)
 * @returns {Promise<string>} Extracted text
 */
export async function parseDocument(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf':
      return await parsePDF(filePath);
    case '.md':
      return await parseMarkdown(filePath);
    case '.txt':
      return await parseText(filePath);
    case '.jsonl':
      return await parseJSONL(filePath, options);
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
}
