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
import { caller, dedupe, inlineLinks, nearest, truncate } from './retrieve.js';

const TOP_K = 5;
const MAX_LINKS = 4;

/**
 * Answer `question`, asked while looking at `passage`.
 *
 * `proxy` is the Worker's base URL; `index` carries the chunk texts and the
 * packed vectors. Returns the same box shape the zoom pills produce, so the
 * canvas renders them identically.
 */
export async function askQuestion({ passage, question, proxy, index }) {
  const api = caller(proxy);

  // Retrieve: embed the question through the proxy, then score locally.
  const [vector] = await api.embed([question]);
  const hits = nearest(truncate(vector, index.dims), index, TOP_K);

  // Both calls at once — the web one is the slow half and shouldn't be waited on.
  const [corpus, web] = await Promise.all([
    api.generate(corpusPrompt({ passage, question, hits })),
    api.generate(webPrompt({ passage, question }), { search: true })
      .catch((e) => ({ text: `The web search didn't come back (${e.message}).`, links: [] })),
  ]);

  const webLinks = dedupe(web.links || []).slice(0, MAX_LINKS);

  return [
    {
      kind: 'corpus',
      title: 'From the corpus',
      summary: corpus.text,
      links: inlineLinks(hits, MAX_LINKS),
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
