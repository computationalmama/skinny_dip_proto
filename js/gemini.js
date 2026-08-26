/**
 * Gemini text generation over REST.
 *
 * Not the @google/generative-ai SDK: it's pinned at 0.1.3 here, which predates
 * search grounding entirely. Embeddings still go through it (see embeddings.js)
 * — this is only for generation, and REST keeps it to zero new dependencies.
 *
 * Grounding and structured output can be used together, which is what the zoom
 * pipeline does: the schema shapes the prose, and groundingMetadata carries the
 * citations alongside it.
 */

import { config } from './config.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Grounding citations arrive as Vertex redirects that expire in about a month. */
const REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

/**
 * One generateContent call.
 *
 * `schema` sets JSON mode and is returned parsed as `json`. `search` turns on
 * Google Search grounding, and its citations come back as `links`.
 */
export async function generate(prompt, { schema, search = false, temperature = 0.3 } = {}) {
  const key = config.google.apiKey;
  if (!key) throw new Error('GOOGLE_API_KEY is not set.');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };
  if (search) body.tools = [{ google_search: {} }];
  if (schema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = schema;
  }

  const res = await fetch(`${ENDPOINT}/${config.gemini.model}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Gemini ${data.error.code}: ${data.error.message}`);

  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates.');

  // Reasoning models interleave thought parts, which carry no `text`.
  const text = (candidate.content?.parts || [])
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();

  let json = null;
  if (schema) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 120)}`);
    }
  }

  return { text, json, links: citations(candidate.groundingMetadata) };
}

/** groundingChunks -> `{ title, url }[]`, deduped, source order kept. */
function citations(meta) {
  const seen = new Set();
  const out = [];

  for (const chunk of meta?.groundingChunks || []) {
    const url = chunk.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: chunk.web.title || '', url });
  }
  return out;
}

/**
 * Swap Vertex redirect URLs for the pages they point at.
 *
 * The redirects stop resolving after roughly a month, which is fatal for links
 * written into a static export — so they're followed once, here, and the real
 * destination is what gets stored. A redirect that won't resolve keeps its
 * original URL: a link that works for a few weeks beats no link.
 */
export async function resolveLinks(links, { timeout = 15000 } = {}) {
  return Promise.all(links.map(async (link) => {
    if (!link.url.includes(REDIRECT_HOST)) return link;

    try {
      const res = await fetch(link.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      });
      const target = res.headers.get('location');
      if (!target) return link;

      // The domain is a better label than Gemini's, which is already the host.
      return { title: link.title || new URL(target).hostname, url: target };
    } catch {
      return link;
    }
  }));
}
