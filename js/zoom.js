/**
 * "Zoom in" and "Zoom out" — the two agentic pills.
 *
 * Three steps, in this order, because each one feeds the next:
 *
 *   1. plan     Gemini reads the passage and decides what to look up: the topic
 *               it's really about, two or three retrieval queries for the
 *               corpus, and one question worth asking the open web.
 *   2. corpus   Those queries are embedded and run against the vector DB, and
 *               Gemini writes up what came back, as two boxes.
 *   3. web      A grounded call answers the web question, and its citations
 *               become the links on the third box.
 *
 * The retrieval queries are the agentic part: nothing here hardcodes what to go
 * looking for. Step 1 chooses, step 2 acts on the choice, step 3 reaches past
 * the corpus entirely.
 *
 * The two pills run the same three steps and differ in MODES below — in what
 * they ask for, and in which slice of the ranking they read. Zoom IN deepens:
 * it takes the passage's nearest neighbours, which are the same section and the
 * same argument. Zoom OUT situates, so those nearest neighbours are exactly
 * what it must skip — a near-duplicate adds no framing — and it reads a band
 * further out instead, where the corpus is talking about the same thing in a
 * different place.
 *
 * Server-side only — it needs the embedding model and the API key. `rag_web.js`
 * runs it live on /zoom; `export-static.js` runs it ahead of time and caches the
 * result so the hosted canvas can read it without either. Both call `zoomIn`
 * with their own `search`, so the two paths share this file exactly.
 */

import { generate, resolveLinks } from './gemini.js';
import {
  CORPUS_SCHEMA,
  MODES,
  PLAN_SCHEMA,
  corpusBoxesPrompt,
  planPrompt,
  webBoxPrompt,
} from './zoom-prompts.js';

/** How many passages each retrieval pulls back. */
const QUERY_N = 3;     // hits per planned query, for box 2
const MAX_LINKS = 4;   // per box

const URL_RE = /https?:\/\/[^\s)"'\]]+/g;

/** Links a passage quotes inline — the only outward link a corpus box can have. */
function inlineLinks(passages) {
  const seen = new Set();
  const out = [];

  for (const p of passages) {
    for (const url of p.text.match(URL_RE) || []) {
      const clean = url.replace(/[.,;)]+$/, '');
      if (seen.has(clean)) continue;
      seen.add(clean);

      // The regex is loose enough to match something URL() rejects, and a throw
      // here would lose the whole zoom for this passage over a stray link.
      try {
        out.push({ title: new URL(clean).hostname.replace(/^www\./, ''), url: clean });
      } catch { /* not a usable link */ }
    }
  }
  return out.slice(0, MAX_LINKS);
}

// ── Steps ─────────────────────────────────────────────────────────────────────

async function plan(text, mode) {
  const { json } = await generate(planPrompt(text, mode), { schema: PLAN_SCHEMA });

  return {
    topic: json.topic?.trim() || '',
    corpusQueries: (json.corpusQueries || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3),
    webQuestion: json.webQuestion?.trim() || '',
  };
}

async function corpusBoxes(text, topic, near, related, mode) {
  const { titles } = MODES[mode];
  const { json } = await generate(
    corpusBoxesPrompt({ text, topic, near, related, mode }),
    { schema: CORPUS_SCHEMA },
  );

  return [
    {
      kind: 'corpus',
      title: titles.source,
      summary: json.source?.trim() || '',
      links: inlineLinks(near),
      grounded: true,
    },
    {
      kind: 'corpus',
      title: titles.related,
      summary: json.related?.trim() || '',
      links: inlineLinks(related),
      grounded: true,
    },
  ];
}

/**
 * The web box. Schema-free, and retried once.
 *
 * Two things had to be worked around, and both still apply wherever this runs.
 *
 * A responseSchema on a grounded call makes the API drop groundingMetadata
 * entirely — the model still searches and the answer is still grounded, but the
 * citations never come back. The links are half the point of this box, so it
 * takes prose. (See webBoxPrompt in zoom-prompts.js, which is never given one.)
 *
 * And `google_search` is a tool the model chooses to call, not retrieval that
 * happens to it. On topics it believes it knows it sometimes answers from memory
 * and cites nothing — measured at roughly one topic in five, and it isn't fixed
 * by instructing it to search harder: a prompt demanding "do not answer from
 * memory" grounded *less* often than a plain one. Asking it to cite is what
 * works, so that's the retry.
 *
 * If both attempts come back bare, the box is renamed. The prose is kept — it's
 * still a lead worth following — but an ungrounded answer states dates and
 * project names from memory, and one of those was wrong in testing. Under an
 * "On the web" heading with no links, that reads as a web finding nobody
 * bothered to cite. So it says what it actually is.
 */
async function webBox(topic, question, mode) {
  const ask = (extra) => generate(webBoxPrompt({ topic, question, mode, extra }), { search: true });

  let { text, links } = await ask('');
  if (!links.length) {
    ({ text, links } = await ask('\nCite the web pages you used.\n'));
  }

  const resolved = dedupe(await resolveLinks(links)).slice(0, MAX_LINKS);
  const grounded = resolved.length > 0;

  return {
    kind: 'web',
    title: grounded ? 'On the web' : 'Unverified — model recall',
    summary: text,
    links: resolved,
    grounded,
  };
}

/** Several redirects can land on the same page, so this runs after resolving. */
function dedupe(links) {
  const seen = new Set();
  return links.filter((l) => !seen.has(l.url) && seen.add(l.url));
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Run one of the two moves over `text`.
 *
 * `search(query, n)` retrieves passages as `{ text, file }[]` — it's injected so
 * the live route can use Chroma and the export can use its own exact cosine over
 * vectors it has already loaded.
 *
 * Returns three boxes: two from the corpus, one from the web. The web step is
 * allowed to fail on its own — a grounded call is the slowest and least reliable
 * part, and two corpus boxes are still worth showing without it.
 */
async function run(mode, text, search) {
  const [skip, take] = MODES[mode].band;
  const { topic, corpusQueries, webQuestion } = await plan(text, mode);

  // The web half only needs the plan, not the retrieval, so it starts here
  // rather than being bundled into a Promise.all after the search — otherwise
  // the slowest call in the pipeline sits idle waiting for an embed it never
  // uses.
  const webPromise = webBox(topic, webQuestion, mode).catch((e) => ({
    kind: 'web',
    title: 'On the web',
    summary: `The web search didn't come back (${e.message}).`,
    links: [],
    grounded: false,
  }));

  const [neighbours, ...perQuery] = await Promise.all([
    // Over-fetch by the band's offset plus one, since the passage retrieves
    // itself and gets dropped below.
    search(text, skip + take + 1),
    ...corpusQueries.map((q) => search(q, QUERY_N)),
  ]);

  const self = text.trim().toLowerCase();
  const near = neighbours
    .filter((p) => p.text.trim().toLowerCase() !== self)
    .slice(skip, skip + take);

  // Anything already shown in the first box shouldn't fill the second as well.
  const shown = new Set([self, ...near.map((p) => p.text.trim().toLowerCase())]);
  const related = [];
  for (const hit of perQuery.flat()) {
    const key = hit.text.trim().toLowerCase();
    if (shown.has(key)) continue;
    shown.add(key);
    related.push(hit);
  }

  const [corpus, web] = await Promise.all([
    corpusBoxes(text, topic, near, related, mode),
    webPromise,
  ]);

  return { mode, topic, queries: corpusQueries, webQuestion, boxes: [...corpus, web] };
}

/** Deepen: what this passage says, and what sits right beside it. */
export const zoomIn = (text, search) => run('in', text, search);

/** Situate: the argument this passage is one move in, and the field around it. */
export const zoomOut = (text, search) => run('out', text, search);

export const ZOOM_MODES = Object.keys(MODES);
