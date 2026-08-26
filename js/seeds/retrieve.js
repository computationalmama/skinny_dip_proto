/**
 * The browser's half of running an agentic move live.
 *
 * On a static host there is no server, so two things the Node pipeline takes for
 * granted have to be rebuilt here:
 *
 *   - Gemini is reached through the Cloudflare Worker (see ../../worker/), which
 *     holds the key. `caller` wraps that.
 *   - Retrieval is done locally against the shipped vectors, because ChromaDB
 *     isn't on the host. At 283 vectors the cosine loop is faster than the
 *     network call that precedes it.
 *
 * Shared by ask.js and zoom-live.js so there's one implementation of each.
 */

const URL_RE = /https?:\/\/[^\s)"'\]]+/g;

/**
 * Truncate to the shipped dimensionality and renormalise.
 *
 * Must match `truncate` in js/vectors.js exactly. The stored vectors were cut
 * the same way, and comparing a full-length query against truncated documents
 * produces cosines that mean nothing.
 */
export function truncate(vector, dims) {
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

/** Cosine against every chunk. The stored rows are already unit length. */
export function nearest(query, { vectors, dims, chunks }, k) {
  const scored = [];
  for (let i = 0; i < chunks.length; i++) {
    let dot = 0;
    const base = i * dims;
    for (let d = 0; d < dims; d++) dot += query[d] * vectors[base + d];
    scored.push([i, dot]);
  }

  return scored
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([i, score]) => ({ ...chunks[i], score }));
}

/**
 * Bind the Worker's two operations to a base URL.
 *
 * `generate` accepts a schema, which the Worker applies only when it isn't
 * grounding — and older deployments ignore the field entirely, which is why
 * every prompt that wants JSON also asks for it in words.
 */
export function caller(proxy) {
  if (!proxy) {
    throw new Error('This build has no Gemini proxy URL, so live moves are unavailable.');
  }

  const base = proxy.replace(/\/+$/, '');

  const post = async (op, body) => {
    const res = await fetch(`${base}/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `Proxy HTTP ${res.status}`);
    return data;
  };

  return {
    embed: async (texts) => (await post('embed', { texts })).embeddings,
    generate: (prompt, { schema, search } = {}) => post('generate', { prompt, schema, search }),
  };
}

/** Retrieve for one or more queries at once, keeping each query's hits separate. */
export async function retrieve(api, queries, index, perQuery) {
  const raw = await api.embed(queries);
  return raw.map((v) => nearest(truncate(v, index.dims), index, perQuery));
}

/** Links a passage quotes inline — the only outward link a corpus box can have. */
export function inlineLinks(passages, max = 4) {
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
  return out.slice(0, max);
}

export const dedupe = (links) => {
  const seen = new Set();
  return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
};
