/**
 * Thumbnails for the private preview. The hosted site loads images from the publisher's address;
 * only the preview file carries copies, shrunk to a small WebP and embedded as data URIs, newest
 * items first, until the file would pass its size limit. Nothing here ever throws: a thumbnail
 * that cannot be fetched or decoded simply becomes null and the item shows without an image.
 */
import { createHash } from 'node:crypto';
import { readBodyCapped } from './http.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const USER_AGENT = 'Curanet/0.1 (+https://curanet.io)';
/** Bytes kept free under the limit so JSON quoting and rounding never push the file over it. */
export const SAFETY_MARGIN_BYTES = 200 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {Object} DownloadOptions
 * @property {typeof globalThis.fetch} [fetch]   Injected for tests; defaults to the global fetch.
 * @property {number} [timeoutMs]                Whole download budget per image (default 10 s).
 * @property {string} [cacheDir]                 When given, finished WebPs are cached here by sha1(url).
 * @property {number} [width]                    Target width (default 240); never upscales.
 * @property {number} [quality]                  WebP quality (default 72).
 *
 * @typedef {Object} EmbedOptions
 * @property {number} maxBytes                   Size the finished preview file must stay under.
 * @property {number} baseBytes                  Size of the file with every thumbnail set to null.
 * @property {(url: string) => Promise<Buffer|null>} download   Fetches one image as a WebP buffer, or null.
 * @property {number} [concurrency]              Downloads in flight at once (default 6).
 * @property {(message: string) => void} [log]   Optional progress output.
 *
 * @typedef {Object} EmbedStats
 * @property {number} embedded          Items that received a data URI.
 * @property {number} skipped           Items that had no thumbnail address to begin with.
 * @property {number} droppedForBudget  Items whose thumbnail was left out to respect maxBytes.
 * @property {number} failed            Items whose download or conversion failed.
 * @property {number} bytes             Total length of the embedded data URIs.
 */

/**
 * @param {string} url
 * @returns {string}
 */
function cacheName(url) {
  return createHash('sha1').update(url).digest('hex') + '.webp';
}

/**
 * @param {string|undefined} cacheDir
 * @param {string} url
 * @returns {Buffer|null}
 */
function readCache(cacheDir, url) {
  if (!cacheDir) return null;
  try {
    const file = path.join(cacheDir, cacheName(url));
    return existsSync(file) ? readFileSync(file) : null;
  } catch {
    return null;
  }
}

/**
 * @param {string|undefined} cacheDir
 * @param {string} url
 * @param {Buffer} data
 */
function writeCache(cacheDir, url, data) {
  if (!cacheDir) return;
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, cacheName(url)), data);
  } catch {
    // A cache that cannot be written is only a missed shortcut.
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * @param {Response} response
 * @returns {boolean} true when the headers already rule the body out as an image.
 */
function looksLikeImage(response) {
  const type = (response.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') return false;
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) return false;
  return true;
}

/**
 * Fetch one image with the Curanet user agent and a time limit, and return it as a small WebP.
 * Returns null on any failure: non-200 answer, non-image body, timeout, oversize (> 8 MB) or a
 * decoding error. Never throws. With `cacheDir`, the finished WebP is cached by sha1 of the address
 * and served from there on the next build.
 * @param {string} url
 * @param {DownloadOptions} [options]
 * @returns {Promise<Buffer|null>}
 */
export async function downloadThumbnail(url, { fetch = globalThis.fetch, timeoutMs = 10000, cacheDir, width = 240, quality = 72 } = {}) {
  if (typeof url !== 'string' || !isHttpUrl(url)) return null;
  const cached = readCache(cacheDir, url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'image/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response || response.status !== 200 || !looksLikeImage(response)) return null;
    const bytes = await readBodyCapped(response, MAX_IMAGE_BYTES);
    if (bytes === null || bytes.byteLength === 0) return null;
    const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const webp = await sharp(body, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();
    writeCache(cacheDir, url, webp);
    return webp;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Buffer} webp
 * @returns {string}
 */
export function toDataUri(webp) {
  return 'data:image/webp;base64,' + webp.toString('base64');
}

/**
 * Replace each item's thumbnail address (`th`) with an embedded data URI, newest first, while the
 * file stays under `maxBytes` (counting `baseBytes`, the embedded URIs and a 200 KB margin). Once
 * the budget is spent every remaining item gets `th = null`, so the oldest thumbnails are the ones
 * dropped. Items without a thumbnail are left alone. Items keep their order. A few downloads run at
 * once, but the budget is always granted in item order, so the result does not depend on timing.
 * @param {{th: string|null}[]} items   Sorted newest first; changed in place.
 * @param {EmbedOptions} options
 * @returns {Promise<EmbedStats>}
 */
export async function embedThumbnails(items, { maxBytes, baseBytes, download, concurrency = 6, log }) {
  const stats = { embedded: 0, skipped: 0, droppedForBudget: 0, failed: 0, bytes: 0 };
  const pending = items.filter((item) => typeof item.th === 'string' && item.th !== '');
  stats.skipped = items.length - pending.length;
  if (pending.length === 0) return stats;

  /**
   * results[i] is undefined until item i has been handled, then a Buffer (downloaded), null
   * (download failed) or false (not downloaded because the budget was already spent).
   * @type {(Buffer|null|false|undefined)[]}
   */
  const results = new Array(pending.length);
  let next = 0; // next item to download
  let commit = 0; // next item to grant budget to
  let exhausted = false;

  const grantInOrder = () => {
    while (commit < pending.length) {
      const webp = results[commit];
      if (webp === undefined) break; // not handled yet; a later worker will continue from here
      const item = pending[commit];
      results[commit] = false; // free the memory
      commit += 1;
      if (webp === false) {
        item.th = null;
        stats.droppedForBudget += 1;
        continue;
      }
      if (webp === null) {
        item.th = null;
        stats.failed += 1;
        continue;
      }
      const uri = toDataUri(webp);
      if (exhausted || baseBytes + SAFETY_MARGIN_BYTES + stats.bytes + uri.length > maxBytes) {
        exhausted = true;
        item.th = null;
        stats.droppedForBudget += 1;
        continue;
      }
      item.th = uri;
      stats.bytes += uri.length;
      stats.embedded += 1;
      if (log && stats.embedded % 100 === 0) log(`  ${stats.embedded} thumbnails embedded so far…`);
    }
  };

  const worker = async () => {
    while (next < pending.length) {
      const index = next;
      next += 1;
      if (exhausted) {
        results[index] = false;
        grantInOrder();
        continue;
      }
      const webp = await Promise.resolve()
        .then(() => download(/** @type {string} */ (pending[index].th)))
        .catch(() => null);
      results[index] = Buffer.isBuffer(webp) && webp.length > 0 ? webp : null;
      grantInOrder();
    }
  };

  const workers = Math.max(1, Math.min(concurrency, pending.length));
  await Promise.all(Array.from({ length: workers }, worker));
  grantInOrder();
  return stats;
}
