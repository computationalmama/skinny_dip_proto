/**
 * Gemini proxy for the hosted seeds canvas.
 *
 * The canvas is static files on GitHub Pages, so anything it computes live needs
 * an API key — and a key in the bundle is a key published to the world. This
 * Worker holds it instead: the page asks the Worker, the Worker asks Gemini, and
 * the key never leaves Cloudflare.
 *
 * Only what can't be precomputed goes through here. Zoom in and Zoom out are
 * answered from files (there are only 283 passages, so every answer fits in an
 * export). The ask box can't be — nobody knows the question in advance — so it
 * embeds and generates through this.
 *
 * Deploy:
 *   cd worker
 *   npx wrangler secret put GOOGLE_API_KEY     # paste your key, once
 *   npx wrangler deploy
 *
 * Then put the resulting URL in PROXY_URL and re-export (see js/README.md).
 *
 * On abuse: anyone who can load the page can spend your quota. ALLOWED_ORIGINS
 * and the limiter below are speed bumps, not a security boundary — an Origin
 * header is trivially forged and the limiter is per-isolate, so it resets and
 * doesn't see other isolates. For a link shared inside a team that is fine. If
 * the URL ever goes wide, add a Cloudflare rate-limiting rule in the dashboard,
 * which is enforced at the edge and actually binding.
 */

const ALLOWED_ORIGINS = [
  'https://computationalmama.github.io',
  'http://localhost:6601',
  'http://localhost:8899',
];

// Only these two operations, and only these models — not an open Gemini proxy.
const EMBED_MODEL = 'gemini-embedding-001';
const GEN_MODEL = 'gemini-3.6-flash';

const MAX_BODY = 16 * 1024;      // a question plus a few passages
const MAX_EMBED_TEXTS = 4;
const MAX_PROMPT_CHARS = 12000;

// Best-effort, per-isolate. See the note above.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Keep the map from growing without bound across a long-lived isolate.
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);

  return recent.length > MAX_PER_WINDOW;
}

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });

/**
 * Swap Gemini's citation redirects for the pages they point at.
 *
 * Grounding cites `vertexaisearch.cloud.google.com/...` redirects, which are
 * opaque and expire after about a month. The page can't unwrap them itself —
 * CORS hides the Location header from a browser, and `redirect: 'manual'` there
 * gives an opaque response — but a Worker has no such restriction. Doing it here
 * means the live links match the ones the static export writes: real, readable
 * destinations that keep working.
 *
 * A redirect that won't resolve keeps its original URL. A link good for a few
 * weeks beats no link.
 */
async function resolveLinks(links) {
  return Promise.all(links.map(async (link) => {
    if (!link.url.includes('vertexaisearch.cloud.google.com')) return link;
    try {
      const res = await fetch(link.url, { redirect: 'manual' });
      const target = res.headers.get('location');
      if (!target) return link;
      return { title: link.title || new URL(target).hostname.replace(/^www\./, ''), url: target };
    } catch {
      return link;
    }
  }));
}

async function callGemini(path, key, body) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${path}?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );
  return res.json();
}

/** Embed questions as queries — the same task type the corpus was indexed against. */
async function embed(texts, key) {
  const data = await callGemini(`${EMBED_MODEL}:batchEmbedContents`, key, {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_QUERY',
    })),
  });

  if (data.error) throw new Error(`Gemini ${data.error.code}: ${data.error.message}`);
  return data.embeddings.map((e) => e.values);
}

/**
 * Generate, optionally grounded in Google Search.
 *
 * No responseSchema is accepted here on purpose: setting one on a grounded call
 * makes the API drop groundingMetadata, so the answer arrives with no citations.
 * The page wants the links, so everything comes back as prose.
 */
async function generate(prompt, search, key) {
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 },
  };
  if (search) body.tools = [{ google_search: {} }];

  const data = await callGemini(`${GEN_MODEL}:generateContent`, key, body);
  if (data.error) throw new Error(`Gemini ${data.error.code}: ${data.error.message}`);

  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates.');

  // Reasoning models interleave thought parts, which carry no text.
  const text = (candidate.content?.parts || [])
    .filter((p) => typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();

  const seen = new Set();
  const links = [];
  for (const chunk of candidate.groundingMetadata?.groundingChunks || []) {
    const url = chunk.web?.uri;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ title: chunk.web.title || '', url });
  }

  return { text, links: await resolveLinks(links) };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return json({ error: 'Origin not allowed' }, 403, origin);
    }
    if (!env.GOOGLE_API_KEY) {
      return json({ error: 'Worker has no GOOGLE_API_KEY set' }, 500, origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return json({ error: 'Too many requests — wait a minute.' }, 429, origin);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Request too large' }, 413, origin);

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: 'Body must be JSON' }, 400, origin);
    }

    const op = new URL(request.url).pathname.replace(/\/+$/, '').split('/').pop();

    try {
      if (op === 'embed') {
        const texts = (payload.texts || []).filter((t) => typeof t === 'string' && t.trim());
        if (!texts.length) return json({ error: 'texts is required' }, 400, origin);
        if (texts.length > MAX_EMBED_TEXTS) return json({ error: `At most ${MAX_EMBED_TEXTS} texts` }, 400, origin);
        return json({ embeddings: await embed(texts, env.GOOGLE_API_KEY) }, 200, origin);
      }

      if (op === 'generate') {
        const prompt = String(payload.prompt || '');
        if (!prompt.trim()) return json({ error: 'prompt is required' }, 400, origin);
        if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'prompt too long' }, 400, origin);
        return json(await generate(prompt, payload.search === true, env.GOOGLE_API_KEY), 200, origin);
      }

      return json({ error: 'Unknown operation — use /embed or /generate' }, 404, origin);
    } catch (e) {
      return json({ error: e.message }, 502, origin);
    }
  },
};
