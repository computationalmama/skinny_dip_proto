/**
 * Minimal CSV helpers
 *
 * Shared by provocations.js (writing the sources column) and rag_web.js
 * (serving the provocations to the canvas), so both read the file the same way.
 */

import fs from 'fs';

/** RFC 4180 parse. Handles quoted fields, doubled quotes, embedded newlines. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') continue;
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  return rows.filter(r => r.some(f => f.trim()));
}

export const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;

/** Read a CSV file, stripping the BOM the provocations export carries. */
export function readCSV(file) {
  return parseCSV(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/**
 * Split a `sources` cell back into its parts.
 *
 * provocations.js writes the cell as `file.md: "passage" | "passage"`. Splitting
 * on the full `" | "` sequence — quote, pipe, quote — rather than the bare pipe
 * keeps passages that contain a stray quote or pipe of their own intact.
 */
export function parseSources(sources) {
  if (!sources || !sources.trim()) return { file: '', passages: [] };

  const m = sources.match(/^(.*?):\s*"([\s\S]*)"\s*$/);
  if (!m) return { file: '', passages: [sources.trim()] };

  const [, file, body] = m;
  return {
    file: file.trim(),
    passages: body.split('" | "').map(p => p.trim()).filter(Boolean),
  };
}

const URL_RE = /https?:\/\/[^\s)"'\]]+/;

/**
 * Load provocations as `{ text, sources, file, passages }`.
 *
 * Prefers the sources-annotated export when it exists, so the canvas can carry
 * each card's supporting passages, and falls back to the bare list.
 */
export function readProvocations(withSources, bare) {
  const file = fs.existsSync(withSources) ? withSources : bare;
  const rows = readCSV(file);

  // The annotated export has a header row; the bare list doesn't.
  const start = rows[0]?.[0]?.toLowerCase() === 'provocation' ? 1 : 0;

  return rows.slice(start)
    .map(([text, sources]) => {
      const parsed = parseSources(sources);
      return {
        text: (text || '').trim(),
        sources: sources || '',
        file: parsed.file,
        // A handful of passages quote a link inline; surface it so the card can
        // offer it as a second, web source.
        passages: parsed.passages.map(p => ({ text: p, url: p.match(URL_RE)?.[0] || null })),
      };
    })
    .filter(p => p.text);
}
