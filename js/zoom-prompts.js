/**
 * The zoom pills' prompts, schemas and mode table — shared by both ends.
 *
 * Zoom runs in two places now. Locally it runs in Node against ChromaDB
 * (zoom.js); on the deployed site it runs in the browser against the Cloudflare
 * Worker and the shipped vectors (seeds/zoom-live.js). Same three steps, same
 * wording, so the prompts live here rather than in either — otherwise the hosted
 * answers drift from the local ones.
 *
 * Deliberately free of imports: this file is bundled into the page as well as
 * loaded by Node, so it can't reach for anything either side lacks.
 *
 * On the two step-1/step-2 schemas: they're passed as responseSchema where the
 * caller can, but the prompts also spell out the JSON shape in words. The Worker
 * only began accepting a schema recently, and a page deployed against an older
 * one still has to work — so the model is told what to return either way, and
 * both callers parse tolerantly.
 */

/**
 * What each pill asks for, and where in the ranking it reads.
 *
 * `band` is a [skip, take] slice of the passage's own neighbours, after the
 * passage itself is dropped. Zoom in reads from the top; zoom out steps past
 * the first two, which in this corpus are usually the adjacent chunks of the
 * same paragraph and so say nothing the passage doesn't.
 */
export const MODES = {
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

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    corpusQueries: { type: 'array', items: { type: 'string' } },
    webQuestion: { type: 'string' },
  },
  required: ['topic', 'corpusQueries', 'webQuestion'],
};

export const CORPUS_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string' },
    related: { type: 'string' },
  },
  required: ['source', 'related'],
};


export const passageList = (passages) =>
  passages.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');

/** Step 1 — decide what to look up. Returns JSON matching PLAN_SCHEMA. */
export const planPrompt = (text, mode) =>
  `You are helping someone read a passage from a research corpus about small,
community-scale and decentralised AI.

PASSAGE:
"""${text}"""

Decide what would be worth looking up to ${mode === 'out'
  ? 'situate it in its broader context'
  : 'understand it better'}:

${MODES[mode].planAsk}

Reply with JSON only: {"topic": string, "corpusQueries": string[], "webQuestion": string}`;

/** Step 2 — write the two corpus boxes. Returns JSON matching CORPUS_SCHEMA. */
export const corpusBoxesPrompt = ({ text, topic, near, related, mode }) =>
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

${MODES[mode].corpusAsk}

Only use what is in the passages above; do not add outside knowledge here.
Plain prose, no headings, no bullet points, no citation markers.

Reply with JSON only: {"source": string, "related": string}`;

/**
 * Step 3 — the web box. Never given a schema, whoever calls it.
 *
 * Setting a responseSchema on a grounded call makes the API drop
 * groundingMetadata, so the answer arrives with no citations at all. The links
 * are half the point of this box, so it takes prose.
 */
export const webBoxPrompt = ({ topic, question, mode, extra = '' }) =>
  `Search the web and answer, for a reader studying small, community-scale and
decentralised AI.

Topic: ${topic}
Question: ${question}
${extra}
45-70 words of plain prose. ${MODES[mode].webAsk} No headings, bullets or
citation markers.`;

/** Tolerant JSON parse — models fence their output even when told not to. */
export function parseJSON(text, what) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const span = cleaned.match(/\{[\s\S]*\}/);
    if (span) {
      try { return JSON.parse(span[0]); } catch { /* fall through */ }
    }
    throw new Error(`Could not read the ${what} step's JSON: ${cleaned.slice(0, 100)}`);
  }
}
