/**
 * The ask box — the one move that has to run live.
 *
 * Everything else the canvas does is precomputed, because the set of questions
 * is finite: there are 283 passages, so all 283 answers fit in an export. A
 * typed question isn't finite, so this one goes out over the network at click
 * time.
 *
 * It runs in the browser, which shapes the whole design:
 *
 *   - The API key can't be here, so Gemini is reached through the Worker in
 *     ../../worker/. See its header for why.
 *   - Retrieval can't be here either — ChromaDB isn't on a static host — so the
 *     chunk vectors ship with the page and the cosine happens in JS. At 283
 *     vectors that's nothing; the loop below is faster than the network call
 *     that precedes it.
 *
 * Two boxes come back, matching the zoom pills: one answered from the corpus,
 * one from the web.
 */

import { corpusPrompt, webPrompt } from '../ask-prompts.js';

const TOP_K = 5;
const MAX_LINKS = 4;
const URL_RE = /https?:\/\/[^\s)"'\]]+/g;

/**
 * Truncate to the shipped dimensionality and renormalise.
 *
 * Must match `truncate` in js/vectors.js exactly — the stored vectors were cut
 * the same way, and comparing a full-length query against truncated documents
 * gives cosines that mean nothing.
 */
function truncate(vector, dims) {
  const out = new Float32Array(dims);
  let sum = 0;
  for (let i = 0; i < dims; i++) {
    out[i] = vector[i];
    sum += vector[i] * vector[i];
  }
  const len = Math.sqrt(sum);
  if (len) for (let i = 0; i < dims; i++) out[i] /= len;
  return out;
}

/** Cosine against every chunk. Stored rows are already unit length. */
function nearest(query, vectors, dims, count, k) {
  const scored = [];
  for (let i = 0; i < count; i++) {
    let dot = 0;
    const base = i * dims;
    for (let d = 0; d < dims; d++) dot += query[d] * vectors[base + d];
    scored.push([i, dot]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, k);
}

function inlineLinks(passages) {
  const seen = new Set();
  const out = [];
  for (const p of passages) {
    for (const raw of p.text.match(URL_RE) || []) {
      const url = raw.replace(/[.,;)]+$/, '');
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        out.push({ title: new URL(url).hostname.replace(/^www\./, ''), url });
      } catch { /* the regex is looser than URL() */ }
    }
  }
  return out.slice(0, MAX_LINKS);
}

const dedupe = (links) => {
  const seen = new Set();
  return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
};

/**
 * Answer `question`, asked while looking at `passage`.
 *
 * `proxy` is the Worker's base URL; `index` carries the chunk texts and the
 * packed vectors. Returns the same box shape the zoom pills produce, so the
 * canvas renders them identically.
 */
export async function askQuestion({ passage, question, proxy, index }) {
  if (!proxy) {
    throw new Error('Live questions need the Gemini proxy, which this build has no URL for.');
  }

  const post = async (op, body) => {
    const res = await fetch(`${proxy.replace(/\/+$/, '')}/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `Proxy HTTP ${res.status}`);
    return data;
  };

  // Retrieve: embed the question through the proxy, then score locally.
  const { embeddings } = await post('embed', { texts: [question] });
  const { vectors, dims, chunks } = index;
  const hits = nearest(truncate(embeddings[0], dims), vectors, dims, chunks.length, TOP_K)
    .map(([i, score]) => ({ ...chunks[i], score }));

  // Both calls at once — the web one is the slow half and shouldn't be waited on.
  const [corpus, web] = await Promise.all([
    post('generate', { prompt: corpusPrompt({ passage, question, hits }) }),
    post('generate', { prompt: webPrompt({ passage, question }), search: true })
      .catch((e) => ({ text: `The web search didn't come back (${e.message}).`, links: [] })),
  ]);

  const webLinks = dedupe(web.links || []).slice(0, MAX_LINKS);

  return [
    {
      kind: 'corpus',
      title: 'From the corpus',
      summary: corpus.text,
      links: inlineLinks(hits),
      grounded: true,
    },
    {
      kind: 'web',
      // Same honesty rule as the zoom pills: grounding is a tool the model
      // elects to call, and an uncited answer shouldn't wear a web heading.
      title: webLinks.length ? 'On the web' : 'Unverified — model recall',
      summary: web.text,
      links: webLinks,
      grounded: webLinks.length > 0,
    },
  ];
}
