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

/** How many passages each retrieval pulls back. */
const QUERY_N = 3;     // hits per planned query, for box 2
const MAX_LINKS = 4;   // per box

const URL_RE = /https?:\/\/[^\s)"'\]]+/g;

/**
 * What each pill asks for, and where in the ranking it reads.
 *
 * `band` is a [skip, take] slice of the passage's own neighbours, after the
 * passage itself is dropped. Zoom in reads from the top; zoom out steps past
 * the first two, which in this corpus are usually the adjacent chunks of the
 * same paragraph and so say nothing the passage doesn't.
 */
const MODES = {
  in: {
    band: [0, 5],
    titles: { source: 'In this corpus', related: 'Related threads' },

    planAsk: `- topic: the concept this passage is really about, in under eight words.
- corpusQueries: two or three short search queries for finding OTHER passages in
  the same corpus that give related examples, contrasting cases, or background.
  Make them different from each other, and don't just restate the passage.
- webQuestion: one question to ask the open web that would add what the corpus
  can't — a named project, an organisation, a real-world outcome, a date.`,

    corpusAsk: `- source: what this passage is claiming and what the surrounding corpus adds to
  it — the argument it sits inside, and any specific project, place or figure
  the nearby passages name. 45-70 words.
- related: the other threads in the corpus this connects to — concrete examples
  and adjacent topics, named. Say how they relate, don't just list them. 45-70
  words.`,

    webAsk: 'Name the specific projects, organisations, places and dates you find.',
  },

  out: {
    band: [2, 6],
    titles: { source: 'The bigger picture', related: 'Across the corpus' },

    planAsk: `- topic: the wider field, debate or category this passage is one instance of, in
  under eight words. Go up a level from what the passage literally says.
- corpusQueries: two or three short search queries for finding passages about
  that WIDER subject rather than this passage's specifics — the general
  argument, the pattern it's an example of, positions that disagree with it.
  Make them different from each other, and deliberately broader than the
  passage.
- webQuestion: one question to ask the open web about the wider context — the
  history of this idea, the movement or field it belongs to, who else works on
  it, how it's argued about.`,

    corpusAsk: `- source: the larger argument this passage is one move in. What is the debate,
  and where does this land in it? Name the position, not just the passage.
  45-70 words.
- related: where else the corpus deals with this same pattern — other examples
  of it, adjacent topics, and anything that cuts against it. Named, and with
  the connection stated. 45-70 words.`,

    webAsk: `Situate it: name the field, the movement, the people arguing about it, and when.
Prefer breadth over the single closest example.`,
  },
};

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

async function plan(text, mode) {
  const { json } = await generate(
    `You are helping someone read a passage from a research corpus about small,
community-scale and decentralised AI.

PASSAGE:
"""${text}"""

Decide what would be worth looking up to ${mode === 'out'
  ? 'situate it in its broader context'
  : 'understand it better'}:

${MODES[mode].planAsk}`,
    { schema: PLAN_SCHEMA },
  );

  return {
    topic: json.topic?.trim() || '',
    corpusQueries: (json.corpusQueries || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 3),
    webQuestion: json.webQuestion?.trim() || '',
  };
}

async function corpusBoxes(text, topic, near, related, mode) {
  const { titles, corpusAsk } = MODES[mode];

  const { json } = await generate(
    `Write two short notes for a reader ${mode === 'out'
      ? 'stepping back from'
      : 'looking closely at'} one passage from a corpus about small,
community-scale and decentralised AI. The topic is "${topic}".

THE PASSAGE:
"""${text}"""

OTHER PASSAGES FROM THE SAME CORPUS, NEAR THIS ONE:
${passageList(near) || '(none)'}

PASSAGES FOUND BY SEARCHING ${mode === 'out' ? 'WIDER' : 'RELATED'} ANGLES:
${passageList(related) || '(none)'}

${corpusAsk}

Only use what is in the passages above; do not add outside knowledge here.
Plain prose, no headings, no bullet points, no citation markers.`,
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

async function webBox(topic, question, mode) {
  const ask = (extra) => generate(
    `Search the web and answer, for a reader studying small, community-scale and
decentralised AI.

Topic: ${topic}
Question: ${question}
${extra}
45-70 words of plain prose. ${MODES[mode].webAsk} No headings, bullets or
citation markers.`,
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
    webBox(topic, webQuestion, mode).catch((e) => ({
      kind: 'web',
      title: 'On the web',
      summary: `The web search didn't come back (${e.message}).`,
      links: [],
      grounded: false,
    })),
  ]);

  return { mode, topic, queries: corpusQueries, webQuestion, boxes: [...corpus, web] };
}

/** Deepen: what this passage says, and what sits right beside it. */
export const zoomIn = (text, search) => run('in', text, search);

/** Situate: the argument this passage is one move in, and the field around it. */
export const zoomOut = (text, search) => run('out', text, search);

export const ZOOM_MODES = Object.keys(MODES);
