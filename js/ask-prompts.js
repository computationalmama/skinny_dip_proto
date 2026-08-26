/**
 * The ask box's two prompts, shared by both ends.
 *
 * The browser runs this move through the Cloudflare Worker (seeds/ask.js) and
 * the local server runs it directly (rag_web.js), so the prompts live here
 * rather than in either — otherwise they drift and the hosted answers stop
 * matching the local ones.
 *
 * Deliberately free of imports: this file is bundled into the page as well as
 * loaded by Node, so it can't reach for anything either side lacks.
 */

const passageList = (passages) => passages.map((p, i) => `[${i + 1}] ${p.text}`).join('\n\n');

/** Answer from retrieved passages only, and say so when they don't answer it. */
export const corpusPrompt = ({ passage, question, hits }) =>
  `Answer the reader's question using only the passages below, from a corpus
about small, community-scale and decentralised AI.

THE PASSAGE THEY ARE LOOKING AT:
"""${passage}"""

QUESTION: ${question}

PASSAGES RETRIEVED FOR THE QUESTION:
${passageList(hits) || '(none)'}

45-80 words of plain prose. Name what the passages name. If they don't answer
the question, say so plainly and say what they do cover instead — don't fill the
gap from your own knowledge. No headings, bullets or citation markers.`;

/** Reach past the corpus. Kept short, because long prompts ground less often. */
export const webPrompt = ({ passage, question }) =>
  `Search the web and answer, for a reader studying small, community-scale and
decentralised AI.

QUESTION: ${question}
CONTEXT THEY ARE READING: ${passage.slice(0, 500)}

45-80 words of plain prose. Name the specific projects, organisations, places and
dates you find. No headings, bullets or citation markers.`;
