/**
 * Shared HTTP helpers.
 */

/**
 * Read a response body with a hard size cap, streaming so that a chunked answer without a
 * Content-Length cannot be buffered past the cap. Returns null when the cap is exceeded.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Uint8Array|null>}
 */
export async function readBodyCapped(response, maxBytes) {
  const declared = Number(response.headers && response.headers.get ? response.headers.get('content-length') : NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (response.body && typeof response.body.cancel === 'function') await response.body.cancel().catch(() => {});
    return null;
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * True for an absolute http(s) URL.
 * @param {unknown} value
 */
export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
