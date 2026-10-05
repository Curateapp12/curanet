/**
 * Helpers for the store and fetcher tests: a temporary data directory in the shape of `data/`,
 * tiny feed builders, and fake `fetch` functions. Nothing here touches the network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLink, itemIdFromLink } from '../../../src/lib/sanitize.js';

export const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The fixed clock every test uses, so dates and file names are predictable. */
export const NOW = new Date('2026-10-05T12:00:00.000Z');

const DAY_MS = 24 * 3600 * 1000;

/**
 * A time relative to NOW.
 * @param {number} days   Positive = in the past.
 * @param {number} [seconds]
 * @returns {string} ISO time
 */
export function daysAgo(days, seconds = 0) {
  return new Date(NOW.getTime() - days * DAY_MS - seconds * 1000).toISOString();
}

export const CATEGORIES = {
  version: 1,
  categories: [
    {
      id: 'news',
      name: { en: 'News', fr: 'Actualités' },
      subcategories: [{ id: 'top-stories', name: { en: 'Top Stories', fr: 'À la une' } }],
    },
  ],
};

/**
 * @param {string} name   File name inside test/fixtures/fetcher/.
 * @returns {string}
 */
export function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

/**
 * A feed source with sensible defaults.
 * @param {Partial<import('../../../src/lib/types.js').Source>} [overrides]
 * @returns {import('../../../src/lib/types.js').Source}
 */
export function makeSource(overrides = {}) {
  const id = overrides.id || 'example-feed';
  return {
    id,
    type: 'feed',
    name: 'Example',
    url: `https://${id}.example/feed.xml`,
    siteUrl: `https://${id}.example`,
    category: 'news',
    subcategory: 'top-stories',
    country: 'CA',
    language: 'en',
    status: 'active',
    addedAt: '2026-09-01T00:00:00.000Z',
    fetch: null,
    ...overrides,
  };
}

/**
 * A YouTube channel source waiting for the API key.
 * @param {Partial<import('../../../src/lib/types.js').Source>} [overrides]
 * @returns {import('../../../src/lib/types.js').Source}
 */
export function makeYouTubeSource(overrides = {}) {
  const id = overrides.id || 'yt-example';
  return {
    id,
    type: 'youtube_channel',
    name: 'Example Channel',
    url: 'https://www.youtube.com/@Example',
    handle: '@Example',
    channelId: null,
    category: 'news',
    subcategory: 'top-stories',
    country: 'CA',
    language: 'en',
    status: 'waiting_for_key',
    addedAt: '2026-09-01T00:00:00.000Z',
    fetch: null,
    ...overrides,
  };
}

/**
 * A stored item with sensible defaults; id follows from the link as in the real store.
 * @param {Partial<import('../../../src/lib/types.js').Item>} [overrides]
 * @returns {import('../../../src/lib/types.js').Item}
 */
export function makeItem(overrides = {}) {
  const link = normalizeLink(overrides.link || 'https://news.example/story');
  return {
    id: itemIdFromLink(link),
    guid: null,
    link,
    title: 'A story',
    excerpt: '',
    published: daysAgo(1),
    thumbnail: null,
    type: 'article',
    addedAt: NOW.toISOString(),
    ...overrides,
    ...(overrides.link ? { link } : {}),
  };
}

/**
 * Create a temporary directory laid out like `data/`.
 * @param {{sources?: object[], categories?: object, hidden?: object[], items?: Record<string, object[]>}} [layout]
 * @returns {string} the directory
 */
export function makeDataDir({ sources = [], categories = CATEGORIES, hidden = [], items = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curanet-test-'));
  writeJsonFile(path.join(dir, 'sources.json'), { version: 1, sources });
  writeJsonFile(path.join(dir, 'categories.json'), categories);
  writeJsonFile(path.join(dir, 'hidden.json'), { version: 1, hidden });
  for (const [sourceId, list] of Object.entries(items)) {
    writeJsonFile(path.join(dir, 'items', `${sourceId}.json`), { version: 1, sourceId, items: list });
  }
  return dir;
}

/** @param {string} dir */
export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** @param {string} file @param {unknown} value */
export function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** @param {string} file @returns {any} */
export function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @param {string} text @returns {string} */
function escapeXml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a small RSS 2.0 document.
 * @param {{title: string, link: string, guid?: string, published?: string, description?: string}[]} entries
 * @param {{title?: string, link?: string}} [channel]
 * @returns {string}
 */
export function rssFeed(entries, { title = 'Test feed', link = 'https://news.example/' } = {}) {
  const items = entries.map((entry) => [
    '    <item>',
    `      <title>${escapeXml(entry.title)}</title>`,
    `      <link>${escapeXml(entry.link)}</link>`,
    entry.guid ? `      <guid isPermaLink="false">${escapeXml(entry.guid)}</guid>` : '',
    entry.published ? `      <pubDate>${new Date(entry.published).toUTCString()}</pubDate>` : '',
    entry.description ? `      <description>${escapeXml(entry.description)}</description>` : '',
    '    </item>',
  ].filter(Boolean).join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n  <channel>\n    <title>${escapeXml(title)}</title>\n    <link>${escapeXml(link)}</link>\n${items}\n  </channel>\n</rss>\n`;
}

/**
 * A route handler that answers with a feed body. Each call builds a fresh Response, because a
 * Response body can be read only once.
 * @param {string} body
 * @param {{status?: number, etag?: string, lastModified?: string, contentType?: string}} [options]
 * @returns {(url?: string, init?: RequestInit) => Response}
 */
export function respondXml(body, { status = 200, etag, lastModified, contentType = 'application/rss+xml; charset=utf-8' } = {}) {
  return () => {
    const headers = new Headers({ 'content-type': contentType });
    if (etag) headers.set('etag', etag);
    if (lastModified) headers.set('last-modified', lastModified);
    return new Response(body, { status, headers });
  };
}

/**
 * A route handler that answers with a bare status code (304, 403, 500, ...).
 * @param {number} status
 * @returns {(url?: string, init?: RequestInit) => Response}
 */
export function respondStatus(status) {
  return () => new Response(status === 304 ? null : 'nope', { status });
}

/**
 * The error undici throws when a host cannot be reached.
 * @param {string} [code]
 * @returns {Error}
 */
export function networkError(code = 'ENOTFOUND') {
  const cause = Object.assign(new Error(`getaddrinfo ${code} host.example`), { code });
  return new TypeError('fetch failed', { cause });
}

/**
 * A promise that never settles on its own but rejects the way fetch does when its signal aborts.
 * Used to simulate a feed that hangs until the timeout.
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
export function hangUntilAborted(init) {
  return new Promise((_, reject) => {
    const signal = init && init.signal;
    if (!signal) return;
    const abort = () => reject(signal.reason || Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/**
 * @typedef {{url: string, init: RequestInit, headers: Headers}} FetchCall
 */

/**
 * A fake fetch: looks the URL up in `routes` and calls its handler; unknown URLs fail like an
 * unreachable host. Every call is recorded in `calls`.
 * @param {Record<string, (url: string, init: RequestInit) => Response|Promise<Response>>} routes
 * @param {FetchCall[]} [calls]
 * @returns {typeof globalThis.fetch}
 */
export function fakeFetch(routes, calls = []) {
  const fetchFn = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init, headers: new Headers(init.headers || {}) });
    const handler = routes[url];
    if (!handler) throw networkError();
    return handler(url, init);
  };
  return /** @type {typeof globalThis.fetch} */ (fetchFn);
}

/** @param {number} ms @returns {Promise<void>} */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
