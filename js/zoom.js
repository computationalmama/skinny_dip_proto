/**
 * "Zoom in" — the agentic move behind that pill.
 *
 * Three steps, in this order, because each one feeds the next:
 *
 *   1. plan     Gemini reads the passage and decides what to look up: the topic
 *               it's really about, two or three retrieval queries for the
 *               corpus, and one question worth asking the open web.
 *   2. corpus   Those queries are embedded and run against the vector DB, and
 *               Gemini writes up what came back — one box on the passage itself,
 *               one on the related threads it turned up elsewhere.
 *   3. web      A grounded call answers the web question, and its citations
 *               become the links on the third box.
 *
 * The retrieval queries are the agentic part: nothing here hardcodes what to go
 * looking for. Step 1 chooses, step 2 acts on the choice, step 3 reaches past
 * the corpus entirely.
 *
 * Server-side only — it needs the embedding model and the API key. `rag_web.js`
 * runs it live on /zoom; `export-static.js` runs it ahead of time and caches the
 * result so the hosted canvas can read it without either. Both call `zoomIn`
 * with their own `search`, so the two paths share this file exactly.
 */

import { generate, resolveLinks } from './gemini.js';

/** How many passages each retrieval pulls back. */
const NEAR_N = 5;      // neighbours of the passage itself, for box 1
const QUERY_N = 3;     // hits per planned query, for box 2
const MAX_LINKS = 4;   // per box

const URL_RE = /https?:\/\/[^\s)"'\]]+/g;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    corpusQueries: { type: 'array', items: { type: 'string' } },
    webQuestion: { type: 'string' },
  },
  required: ['topic', 'corpusQueries', 'webQuestion'],
};

const CORPUS_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    related: { type: 'string' },
  },
  required: ['source', 'related'],
};

const passageList = (passages) =>
  passages.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');

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

async function plan(text) {
  const { json } = await generate(
    `You are helping someone read a passage from a research corpus about small,
community-scale and decentralised AI.

PASSAGE:
"""${text}"""

Decide what would be worth looking up to understand it better:

- topic: the concept this passage is really about, in under eight words.
- corpusQueries: two or three short search queries for finding OTHER passages in
  the same corpus that give related examples, contrasting cases, or background.
  Make them different from each other, and don't just restate the passage.
- webQuestion: one question to ask the open web that would add what the corpus
  can't — a named project, an organisation, a real-world outcome, a date.`,
    { schema: PLAN_SCHEMA },
  );

  return {
    topic: json.topic?.trim() || '',
    corpusQueries: (json.corpusQueries || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3),
    webQuestion: json.webQuestion?.trim() || '',
  };
}

async function corpusBoxes(text, topic, near, related) {
  const { json } = await generate(
    `Write two short notes for a reader looking closely at one passage from a
corpus about small, community-scale and decentralised AI. The topic is "${topic}".

THE PASSAGE:
"""${text}"""

PASSAGES NEAREST TO IT IN THE CORPUS:
${passageList(near) || '(none)'}

PASSAGES FOUND BY SEARCHING RELATED ANGLES:
${passageList(related) || '(none)'}

- source: what this passage is claiming and what the surrounding corpus adds to
  it — the argument it sits inside, and any specific project, place or figure
  the nearby passages name. 45-70 words.
- related: the other threads in the corpus this connects to — concrete examples
  and adjacent topics, named. Say how they relate, don't just list them. 45-70
  words.

Only use what is in the passages above; do not add outside knowledge here.
Plain prose, no headings, no bullet points, no citation markers.`,
    { schema: CORPUS_SCHEMA },
  );

  return [
    {
      kind: 'corpus',
      title: 'In this corpus',
      summary: json.source?.trim() || '',
      links: inlineLinks(near),
      grounded: true,
    },
    {
      kind: 'corpus',
      title: 'Related threads',
      summary: json.related?.trim() || '',
      links: inlineLinks(related),
      grounded: true,
    },
  ];
}

/**
 * The web box. Deliberately schema-free, and retried once.
 *
 * Two things had to be worked around here.
 *
 * Setting a responseSchema on a grounded call makes the API drop
 * groundingMetadata entirely — the model still searches, and the answer is
 * still grounded, but the citations never come back. Since the links are half
 * the point of this box, it takes the prose as plain text instead.
 *
 * And `google_search` is a tool the model chooses to call, not retrieval that
 * happens to it. On topics it believes it already knows it sometimes answers
 * from memory and returns no citations at all — measured at roughly one topic
 * in five, and it isn't fixed by instructing it to search harder (a prompt
 * demanding "do not answer from memory" grounded *less* often than a plain
 * one). What does work is asking it to cite, so that's the retry.
 *
 * If both attempts come back bare, the box is renamed. The prose is kept —
 * it's still a lead worth following — but an ungrounded answer states dates and
 * project names it got from memory, and one of those was wrong in testing. Left
 * under an "On the web" heading with no links, that reads as a web finding
 * nobody bothered to cite. So it says what it actually is.
 */
async function webBox(topic, question) {
  const ask = (extra) => generate(
    `Search the web and answer, for a reader studying small, community-scale and
decentralised AI.

Topic: ${topic}
Question: ${question}
${extra}
45-70 words of plain prose. Name the specific projects, organisations, places and
dates you find. No headings, bullets or citation markers.`,
    { search: true },
  );

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
 * Zoom in on `text`.
 *
 * `search(query, n)` retrieves passages as `{ text, file }[]` — it's injected so
 * the live route can use Chroma and the export can use its own exact cosine over
 * vectors it has already loaded.
 *
 * Returns three boxes: two from the corpus, one from the web. The web step is
 * allowed to fail on its own — a grounded call is the slowest and least reliable
 * part, and two corpus boxes are still worth showing without it.
 */
export async function zoomIn(text, search) {
  const { topic, corpusQueries, webQuestion } = await plan(text);

  const [near, ...perQuery] = await Promise.all([
    search(text, NEAR_N + 1),
    ...corpusQueries.map((q) => search(q, QUERY_N)),
  ]);

  // The passage retrieves itself; drop it, and anything already shown in box 1.
  const self = text.trim().toLowerCase();
  const nearest = near.filter((p) => p.text.trim().toLowerCase() !== self).slice(0, NEAR_N);

  const shown = new Set([self, ...nearest.map((p) => p.text.trim().toLowerCase())]);
  const related = [];
  for (const hit of perQuery.flat()) {
    const key = hit.text.trim().toLowerCase();
    if (shown.has(key)) continue;
    shown.add(key);
    related.push(hit);
  }

  const [corpus, web] = await Promise.all([
    corpusBoxes(text, topic, nearest, related),
    webBox(topic, webQuestion).catch((e) => ({
      kind: 'web',
      title: 'On the web',
      summary: `The web search didn't come back (${e.message}).`,
      links: [],
      grounded: false,
    })),
  ]);

  return { topic, queries: corpusQueries, webQuestion, boxes: [...corpus, web] };
}
