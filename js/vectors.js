/**
 * Chunk vectors for the browser.
 *
 * The ask box takes free text, so its retrieval can't be precomputed the way
 * zoom's is — the question is only known at click time. That means the browser
 * has to do the cosine itself, which means it needs the vectors.
 *
 * Written as raw little-endian float32 rather than JSON, which would be roughly
 * three times the size for the same numbers.
 *
 * Truncated to 768 of the 3072 dimensions and renormalised. gemini-embedding-001
 * is Matryoshka-trained, so a truncated prefix is still a usable embedding — and
 * measured over six realistic questions, 768 dims returned the same top result
 * as the full vector every time and 90% of the same top five. 1536 scored
 * identically to 768, so the extra 850 kB buys nothing.
 *
 *   3072 dims: 3396 kB
 *   1536 dims: 1698 kB   <- no better than 768
 *    768 dims:  849 kB   <- what we ship
 *
 * The query side must truncate and renormalise exactly the same way or the
 * cosines are meaningless. See `truncate` in seeds/ask.js, which mirrors this.
 */

export const VECTOR_DIMS = 768;

/** Truncate to `dims` and renormalise to unit length. */
export function truncate(vector, dims = VECTOR_DIMS) {
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

/**
 * Pack every chunk vector into one buffer, chunk-major.
 *
 * Row `i` is `chunks[i]`, matching the order in search.json, so the browser can
 * index straight into it without a lookup table.
 */
export function packVectors(chunks, dims = VECTOR_DIMS) {
  const packed = new Float32Array(chunks.length * dims);
  chunks.forEach((chunk, i) => packed.set(truncate(chunk.vector, dims), i * dims));
  return Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
}
