/**
 * Zoom in and Zoom out, run live in the browser.
 *
 * The same three steps as the Node pipeline in ../zoom.js — plan, corpus, web —
 * against the Cloudflare Worker instead of a local key, and against the shipped
 * vectors instead of ChromaDB. Prompts, schemas and the mode table all come from
 * ../zoom-prompts.js, so the two paths can't drift.
 *
 * There is a precomputed copy of all of this in data/zoom.json, and for a while
 * that was what the deployed canvas read. Live costs a 30-50s wait and three
 * Gemini calls per click where the lookup was instant and free — the trade is
 * that the web box reflects the web now rather than at export time, and the
 * corpus half re-runs against whatever is in the collection.
 */

import {
  CORPUS_SCHEMA,
  MODES,
  PLAN_SCHEMA,
  corpusBoxesPrompt,
  parseJSON,
  planPrompt,
  webBoxPrompt,
} from '../zoom-prompts.js';
import { caller, dedupe, inlineLinks, retrieve } from './retrieve.js';

const QUERY_N = 3;     // hits per planned query, for box 2
const MAX_LINKS = 4;   // per box

async function plan(api, text, mode) {
  const { text: raw } = await api.generate(planPrompt(text, mode), { schema: PLAN_SCHEMA });
  const json = parseJSON(raw, 'plan');

  return {
    topic: String(json.topic || '').trim(),
    corpusQueries: (json.corpusQueries || [])
      .map((q) => String(q).trim())
      .filter(Boolean)
      .slice(0, 3),
    webQuestion: String(json.webQuestion || '').trim(),
  };
}

async function corpusBoxes(api, { text, topic, near, related, mode }) {
  const { text: raw } = await api.generate(
    corpusBoxesPrompt({ text, topic, near, related, mode }),
    { schema: CORPUS_SCHEMA },
  );
  const json = parseJSON(raw, 'corpus');
  const { titles } = MODES[mode];

  return [
    {
      kind: 'corpus',
      title: titles.source,
      summary: String(json.source || '').trim(),
      links: inlineLinks(near, MAX_LINKS),
      grounded: true,
    },
    {
      kind: 'corpus',
      title: titles.related,
      summary: String(json.related || '').trim(),
      links: inlineLinks(related, MAX_LINKS),
      grounded: true,
    },
  ];
}

/**
 * The web box. Never given a schema, and retried once if it cites nothing.
 *
 * Same two API behaviours the Node path works around, for the same reasons — a
 * schema on a grounded call drops the citations, and grounding is a tool the
 * model elects to call rather than retrieval that happens to it. See the long
 * note above webBox in ../zoom.js.
 *
 * The Worker resolves Gemini's citation redirects before they get here; a
 * browser can't, because CORS hides the Location header.
 */
async function webBox(api, topic, question, mode) {
  const ask = (extra) => api.generate(webBoxPrompt({ topic, question, mode, extra }), { search: true });

  let { text, links } = await ask('');
  if (!links?.length) {
    ({ text, links } = await ask('\nCite the web pages you used.\n'));
  }

  const resolved = dedupe(links || []).slice(0, MAX_LINKS);
  const grounded = resolved.length > 0;

  return {
    kind: 'web',
    title: grounded ? 'On the web' : 'Unverified — model recall',
    summary: text,
    links: resolved,
    grounded,
  };
}

/**
 * Run one of the two moves over `text`, live.
 *
 * Returns the same three boxes the precomputed export holds, so the canvas
 * renders them identically either way.
 */
export async function zoomLive({ text, mode, proxy, index }) {
  const api = caller(proxy);
  const [skip, take] = MODES[mode].band;

  const { topic, corpusQueries, webQuestion } = await plan(api, text, mode);

  // The web half only needs the plan, not the retrieval, so it starts here
  // rather than being bundled into a Promise.all after the search — otherwise
  // the slowest call in the pipeline sits idle waiting for an embed it never
  // uses.
  const webPromise = webBox(api, topic, webQuestion, mode).catch((e) => ({
    kind: 'web',
    title: 'On the web',
    summary: `The web search didn't come back (${e.message}).`,
    links: [],
    grounded: false,
  }));

  // One embed call for the passage and every planned query together — the Worker
  // caps a batch at four, and this is at most 1 + 3.
  const [neighbours, ...perQuery] = await retrieve(
    api,
    [text, ...corpusQueries],
    index,
    Math.max(skip + take + 1, QUERY_N),
  );

  const self = text.trim().toLowerCase();
  const near = neighbours
    .filter((p) => p.text.trim().toLowerCase() !== self)
    .slice(skip, skip + take);

  const shown = new Set([self, ...near.map((p) => p.text.trim().toLowerCase())]);
  const related = [];
  for (const hit of perQuery.flatMap((hits) => hits.slice(0, QUERY_N))) {
    const key = hit.text.trim().toLowerCase();
    if (shown.has(key)) continue;
    shown.add(key);
    related.push(hit);
  }

  const [corpus, web] = await Promise.all([
    corpusBoxes(api, { text, topic, near, related, mode }),
    webPromise,
  ]);

  return [...corpus, web];
}
