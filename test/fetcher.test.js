import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { USER_AGENT, classifyHttpStatus, fetchSource, processFeedSource, processYouTubeSource, runFetch, formatSourceLine } from '../src/lib/fetcher.js';
import { loadSources, loadItems, listRuns } from '../src/lib/store.js';
import {
  NOW, daysAgo, readFixture, makeSource, makeYouTubeSource, makeItem, makeDataDir, removeDir, readJsonFile,
  rssFeed, respondXml, respondStatus, networkError, hangUntilAborted, fakeFetch, sleep,
} from './fixtures/fetcher/helpers.js';

const NOW_ISO = NOW.toISOString();
const FEED_OK = readFixture('feed-ok.xml');
const HTML_PAGE = readFixture('html-page.html');
const DAY_MS = 24 * 3600 * 1000;

/** @param {Partial<import('../src/lib/types.js').Source>} [overrides] */
function sourceWithState(overrides = {}) {
  return makeSource({
    id: 'news',
    url: 'https://news.example/feed.xml',
    fetch: { etag: 'W/"v1"', lastModified: 'Sun, 04 Oct 2026 10:00:00 GMT', lastAttempt: daysAgo(1), lastSuccess: daysAgo(1), lastResult: 'ok', lastError: null, failures: 0 },
    ...overrides,
  });
}

describe('USER_AGENT and classifyHttpStatus', () => {
  test('the user agent names Curanet with its version and site', () => {
    assert.match(USER_AGENT, /^Curanet\/\d+\.\d+ \(\+https:\/\/curanet\.io\)$/);
    const version = readJsonFile(path.join(process.cwd(), 'package.json')).version;
    assert.ok(USER_AGENT.startsWith(`Curanet/${version.split('.').slice(0, 2).join('.')} `));
  });

  test('classifies status codes', () => {
    assert.equal(classifyHttpStatus(200), 'ok');
    assert.equal(classifyHttpStatus(226), 'ok');
    assert.equal(classifyHttpStatus(202), 'blocked', 'a 202 without content is a bot check');
    assert.equal(classifyHttpStatus(204), 'blocked');
    assert.equal(classifyHttpStatus(304), 'unchanged');
    assert.equal(classifyHttpStatus(401), 'blocked');
    assert.equal(classifyHttpStatus(403), 'blocked');
    assert.equal(classifyHttpStatus(451), 'blocked');
    assert.equal(classifyHttpStatus(404), 'error');
    assert.equal(classifyHttpStatus(429), 'error');
    assert.equal(classifyHttpStatus(500), 'error');
    assert.equal(classifyHttpStatus(503), 'error');
    assert.equal(classifyHttpStatus(301), 'error');
  });
});

describe('fetchSource', () => {
  test('sends the Curanet user agent, accept and conditional headers and returns the response details', async () => {
    const calls = [];
    const fetch = fakeFetch({
      'https://news.example/feed.xml': respondXml(FEED_OK, { etag: 'W/"v2"', lastModified: 'Mon, 05 Oct 2026 10:00:00 GMT' }),
    }, calls);
    const result = await fetchSource(sourceWithState(), { fetch, timeoutMs: 1000 });
    assert.equal(result.result, 'ok');
    if (result.result !== 'ok') return;
    assert.equal(result.status, 200);
    assert.equal(result.body, FEED_OK);
    assert.equal(result.etag, 'W/"v2"');
    assert.equal(result.lastModified, 'Mon, 05 Oct 2026 10:00:00 GMT');
    assert.equal(result.finalUrl, 'https://news.example/feed.xml');
    assert.match(result.contentType || '', /rss\+xml/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.get('user-agent'), USER_AGENT);
    assert.equal(calls[0].headers.get('accept'), 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8');
    assert.equal(calls[0].headers.get('if-none-match'), 'W/"v1"');
    assert.equal(calls[0].headers.get('if-modified-since'), 'Sun, 04 Oct 2026 10:00:00 GMT');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  test('sends no conditional headers for a source that was never fetched', async () => {
    const calls = [];
    const fetch = fakeFetch({ 'https://news.example/feed.xml': respondXml(FEED_OK) }, calls);
    await fetchSource(sourceWithState({ fetch: null }), { fetch });
    assert.equal(calls[0].headers.has('if-none-match'), false);
    assert.equal(calls[0].headers.has('if-modified-since'), false);
  });

  test('304 is unchanged', async () => {
    const fetch = fakeFetch({ 'https://news.example/feed.xml': respondStatus(304) });
    assert.deepEqual(await fetchSource(sourceWithState(), { fetch }), { result: 'unchanged', status: 304 });
  });

  test('401, 403 and 451 are blocked', async () => {
    for (const status of [401, 403, 451]) {
      const fetch = fakeFetch({ 'https://news.example/feed.xml': respondStatus(status) });
      const result = await fetchSource(sourceWithState(), { fetch });
      assert.equal(result.result, 'blocked');
      assert.equal(result.status, status);
      assert.equal(result.result === 'blocked' && result.error, `HTTP ${status}`);
    }
  });

  test('500 and 429 are errors, not blocks', async () => {
    for (const status of [500, 429, 404]) {
      const fetch = fakeFetch({ 'https://news.example/feed.xml': respondStatus(status) });
      const result = await fetchSource(sourceWithState(), { fetch });
      assert.equal(result.result, 'error');
      assert.equal(result.status, status);
      assert.match(result.result === 'error' ? result.error : '', new RegExp(`HTTP ${status}`));
    }
  });

  test('a feed that hangs becomes a timeout error', async () => {
    const fetch = fakeFetch({ 'https://news.example/feed.xml': (_url, init) => hangUntilAborted(init) });
    const result = await fetchSource(sourceWithState(), { fetch, timeoutMs: 20 });
    assert.equal(result.result, 'error');
    assert.equal(result.result === 'error' && result.error, 'timeout after 20 ms');
  });

  test('network errors carry the message and the cause code', async () => {
    const fetch = fakeFetch({});
    const result = await fetchSource(sourceWithState(), { fetch });
    assert.equal(result.result, 'error');
    assert.match(result.result === 'error' ? result.error : '', /ENOTFOUND/);
    assert.equal(result.status, null);
  });

  test('a fetch that throws synchronously is handled too', async () => {
    const fetch = /** @type {typeof globalThis.fetch} */ (() => { throw new Error('boom'); });
    const result = await fetchSource(sourceWithState(), { fetch });
    assert.equal(result.result, 'error');
    assert.match(result.result === 'error' ? result.error : '', /boom/);
  });

  test('a body larger than maxBytes is an error', async () => {
    const fetch = fakeFetch({ 'https://news.example/feed.xml': respondXml('x'.repeat(2000)) });
    const result = await fetchSource(sourceWithState(), { fetch, maxBytes: 1000 });
    assert.equal(result.result, 'error');
    assert.match(result.result === 'error' ? result.error : '', /larger than/);
    const big = await fetchSource(sourceWithState(), { fetch: fakeFetch({ 'https://news.example/feed.xml': respondXml('x', { contentType: 'text/xml' }) }), maxBytes: 5 * 1024 * 1024 });
    assert.equal(big.result, 'ok');
  });

  test('a declared content-length above the limit is refused before reading the body', async () => {
    const fetch = fakeFetch({
      'https://news.example/feed.xml': () => new Response('tiny', { status: 200, headers: { 'content-length': String(6 * 1024 * 1024) } }),
    });
    const result = await fetchSource(sourceWithState(), { fetch });
    assert.equal(result.result, 'error');
    assert.equal(result.result === 'error' && result.error, 'feed larger than 5 MB');
  });

  test('decodes a latin-1 body using the declared charset', async () => {
    const bytes = new TextEncoder().encode(rssFeed([{ title: 'caf\u0000', link: 'https://news.example/cafe' }]));
    const index = bytes.indexOf(0);
    bytes[index] = 0xe9;
    const fetch = fakeFetch({ 'https://news.example/feed.xml': () => new Response(bytes, { status: 200, headers: { 'content-type': 'text/xml; charset=iso-8859-1' } }) });
    const result = await fetchSource(sourceWithState(), { fetch });
    assert.equal(result.result, 'ok');
    assert.match(result.result === 'ok' ? result.body : '', /café/);
  });
});

describe('processFeedSource', () => {
  /** @type {string} */
  let dir;
  before(() => { dir = makeDataDir(); });
  after(() => removeDir(dir));

  /** @param {typeof globalThis.fetch} fetch @param {Partial<{hidden: object[], now: Date}>} [extra] */
  const ctx = (fetch, extra = {}) => ({ dataDir: dir, now: NOW, fetch, timeoutMs: 1000, hidden: [], log: () => {}, ...extra });

  test('stores the parsed items, updates the fetch state and does not touch the source object given', async () => {
    const source = sourceWithState({ id: 'ok-source', url: 'https://ok.example/feed.xml', fetch: null });
    const fetch = fakeFetch({ 'https://ok.example/feed.xml': respondXml(FEED_OK, { etag: 'W/"v2"', lastModified: 'Mon, 05 Oct 2026 10:00:00 GMT' }) });
    const { source: updated, result } = await processFeedSource(source, ctx(fetch));
    assert.deepEqual(result, { id: 'ok-source', result: 'ok', added: 3, pruned: 0, ms: result.ms, error: null });
    assert.ok(Number.isInteger(result.ms) && result.ms >= 0);
    assert.equal(source.fetch, null, 'input is not mutated');
    assert.deepEqual(updated.fetch, { etag: 'W/"v2"', lastModified: 'Mon, 05 Oct 2026 10:00:00 GMT', lastAttempt: NOW_ISO, lastSuccess: NOW_ISO, lastResult: 'ok', lastError: null, failures: 0 });
    assert.equal(updated.status, 'active');
    const stored = loadItems(dir, 'ok-source');
    assert.equal(stored.items.length, 3);
    assert.equal(stored.items[0].title, 'Fresh story with markup & an entity');
    assert.equal(stored.items[0].link, 'https://news.example/fresh?id=1');
    assert.equal(stored.items[0].guid, 'news-fresh');
    assert.equal(stored.items[0].thumbnail, 'https://news.example/img/fresh.jpg');
    assert.equal(stored.items[0].excerpt, 'Two hours old. Read more.');
    assert.equal(stored.items[0].addedAt, NOW_ISO);
    assert.deepEqual(stored.items.map((i) => i.published), ['2026-10-05T10:00:00.000Z', '2026-10-04T09:00:00.000Z', '2026-08-26T09:00:00.000Z']);
  });

  test('a second fetch of the same feed adds nothing and keeps the stored titles', async () => {
    const source = sourceWithState({ id: 'ok-source', url: 'https://ok.example/feed.xml' });
    const changed = FEED_OK.replace("Yesterday's story", 'A rewritten headline');
    const fetch = fakeFetch({ 'https://ok.example/feed.xml': respondXml(changed) });
    const { source: updated, result } = await processFeedSource(source, ctx(fetch));
    assert.equal(result.result, 'ok');
    assert.equal(result.added, 0);
    assert.equal(updated.fetch && updated.fetch.etag, null, 'a response without an ETag clears the stored one');
    assert.equal(loadItems(dir, 'ok-source').items[1].title, "Yesterday's story");
  });

  test('an unchanged feed still prunes items that aged out', async () => {
    const source = sourceWithState({ id: 'ok-source', url: 'https://ok.example/feed.xml' });
    const fetch = fakeFetch({ 'https://ok.example/feed.xml': respondStatus(304) });
    const later = new Date(NOW.getTime() + 60 * DAY_MS);
    const { source: updated, result } = await processFeedSource(source, ctx(fetch, { now: later }));
    assert.equal(result.result, 'unchanged');
    assert.equal(result.pruned, 1);
    assert.equal(loadItems(dir, 'ok-source').items.length, 2);
    assert.equal(updated.fetch && updated.fetch.lastResult, 'unchanged');
    assert.equal(updated.fetch && updated.fetch.lastSuccess, later.toISOString());
    assert.equal(updated.fetch && updated.fetch.etag, 'W/"v1"', 'the stored validators are kept');
    assert.equal(updated.fetch && updated.fetch.failures, 0);
  });

  test('hidden items are never re-added', async () => {
    const source = sourceWithState({ id: 'hidden-source', url: 'https://hidden.example/feed.xml', fetch: null });
    const hidden = [{ link: 'https://news.example/fresh?id=1', guid: null, sourceId: null, hiddenAt: NOW_ISO }, { link: 'https://other.example/x', guid: 'news-august', sourceId: 'hidden-source', hiddenAt: NOW_ISO }];
    const fetch = fakeFetch({ 'https://hidden.example/feed.xml': respondXml(FEED_OK) });
    const { result } = await processFeedSource(source, ctx(fetch, { hidden }));
    assert.equal(result.added, 1);
    assert.deepEqual(loadItems(dir, 'hidden-source').items.map((i) => i.link), ['https://news.example/yesterday']);
  });

  test('an HTML page instead of a feed is an error with the parser message', async () => {
    const source = sourceWithState({ id: 'html-source', url: 'https://html.example/feed.xml', fetch: null });
    const fetch = fakeFetch({ 'https://html.example/feed.xml': respondXml(HTML_PAGE, { contentType: 'text/html' }) });
    const { source: updated, result } = await processFeedSource(source, ctx(fetch));
    assert.equal(result.result, 'error');
    assert.match(result.error || '', /HTML page/);
    assert.equal(updated.status, 'active');
    assert.equal(updated.fetch && updated.fetch.lastResult, 'error');
    assert.equal(updated.fetch && updated.fetch.failures, 1);
    assert.equal(updated.fetch && updated.fetch.lastError, result.error);
    assert.equal(updated.fetch && updated.fetch.lastSuccess, null);
    assert.equal(fs.existsSync(path.join(dir, 'items', 'html-source.json')), false, 'nothing is written for a failed source');
  });

  test('a refusal marks the source blocked and changes nothing else', async () => {
    const source = sourceWithState({ id: 'blocked-source', url: 'https://blocked.example/feed.xml' });
    const fetch = fakeFetch({ 'https://blocked.example/feed.xml': respondStatus(403) });
    const { source: updated, result } = await processFeedSource(source, ctx(fetch));
    assert.equal(result.result, 'blocked');
    assert.equal(result.error, 'HTTP 403');
    assert.equal(updated.status, 'blocked');
    assert.equal(updated.fetch && updated.fetch.lastResult, 'blocked');
    assert.equal(updated.fetch && updated.fetch.lastError, 'HTTP 403');
    assert.equal(updated.fetch && updated.fetch.failures, 1);
    assert.equal(updated.fetch && updated.fetch.lastAttempt, NOW_ISO);
    assert.equal(updated.fetch && updated.fetch.etag, 'W/"v1"');
    assert.equal(updated.fetch && updated.fetch.lastSuccess, source.fetch && source.fetch.lastSuccess);
    assert.equal(source.status, 'active');
  });

  test('errors increment the failure counter and keep the source active', async () => {
    const source = sourceWithState({ id: 'down-source', url: 'https://down.example/feed.xml', fetch: { etag: null, lastModified: null, lastAttempt: daysAgo(1), lastSuccess: null, lastResult: 'error', lastError: 'HTTP 500', failures: 2 } });
    const fetch = fakeFetch({});
    const { source: updated, result } = await processFeedSource(source, ctx(fetch));
    assert.equal(result.result, 'error');
    assert.match(result.error || '', /ENOTFOUND/);
    assert.equal(updated.status, 'active');
    assert.equal(updated.fetch && updated.fetch.failures, 3);
    assert.equal(updated.fetch && updated.fetch.lastResult, 'error');
  });

  test('sources that are not active are skipped without a request', async () => {
    const calls = [];
    const fetch = fakeFetch({}, calls);
    const paused = await processFeedSource(sourceWithState({ id: 'p', status: 'paused' }), ctx(fetch));
    assert.deepEqual(paused.result, { id: 'p', result: 'skipped', added: 0, pruned: 0, ms: 0, error: 'paused' });
    const blocked = await processFeedSource(sourceWithState({ id: 'b', status: 'blocked' }), ctx(fetch));
    assert.equal(blocked.result.result, 'skipped');
    assert.equal(blocked.result.error, `blocked since ${daysAgo(1)}`);
    assert.equal(calls.length, 0);
    assert.deepEqual(paused.source, sourceWithState({ id: 'p', status: 'paused' }), 'a skipped source is returned unchanged');
  });
});

describe('processYouTubeSource', () => {
  /** @type {string} */
  let dir;
  before(() => { dir = makeDataDir(); });
  after(() => removeDir(dir));

  const videoEntry = {
    videoId: 'dQw4w9WgXcQ',
    title: 'A video <b>title</b>',
    link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    guid: 'yt:dQw4w9WgXcQ',
    published: '2026-10-05T09:00:00.000Z',
    summary: 'Description of the video.',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  };

  /** @param {object} youtube @param {string|null} apiKey */
  const ctx = (youtube, apiKey) => ({ dataDir: dir, now: NOW, fetch: fakeFetch({}), timeoutMs: 1000, hidden: [], log: () => {}, apiKey, youtube });

  test('without a key the channel is skipped and keeps waiting', async () => {
    let called = false;
    const youtube = { fetchChannelVideos: async () => { called = true; return { channelId: 'x', uploadsPlaylistId: 'y', entries: [] }; } };
    const source = makeYouTubeSource();
    const { source: updated, result } = await processYouTubeSource(source, ctx(youtube, null));
    assert.deepEqual(result, { id: 'yt-example', result: 'skipped', added: 0, pruned: 0, ms: 0, error: 'waiting for key' });
    assert.equal(updated.status, 'waiting_for_key');
    assert.deepEqual(updated, source);
    assert.equal(called, false);
  });

  test('with a key the uploads are stored as videos, the channel id is learned and the source becomes active', async () => {
    const seen = [];
    const youtube = {
      fetchChannelVideos: async (source, options) => {
        seen.push({ source, options });
        return { channelId: 'UCxxxxxxxxxxxxxxxxxxxxxx', uploadsPlaylistId: 'UUxxxxxxxxxxxxxxxxxxxxxx', entries: [videoEntry] };
      },
    };
    const { source: updated, result } = await processYouTubeSource(makeYouTubeSource(), ctx(youtube, 'SECRET-KEY'));
    assert.equal(result.result, 'ok');
    assert.equal(result.added, 1);
    assert.equal(updated.status, 'active');
    assert.equal(updated.channelId, 'UCxxxxxxxxxxxxxxxxxxxxxx');
    assert.equal(updated.fetch && updated.fetch.lastResult, 'ok');
    assert.equal(updated.fetch && updated.fetch.lastSuccess, NOW_ISO);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].options.apiKey, 'SECRET-KEY');
    const stored = loadItems(dir, 'yt-example');
    assert.equal(stored.items.length, 1);
    assert.equal(stored.items[0].type, 'video');
    assert.equal(stored.items[0].videoId, 'dQw4w9WgXcQ');
    assert.equal(stored.items[0].guid, 'yt:dQw4w9WgXcQ');
    assert.equal(stored.items[0].link, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  test('API failures are errors, not blocks, and never show the key', async () => {
    const youtube = {
      fetchChannelVideos: async () => {
        throw Object.assign(new Error('YouTube API error 403: quota exceeded for key SECRET-KEY'), { reason: 'quotaExceeded' });
      },
    };
    const source = makeYouTubeSource({ id: 'yt-quota' });
    const { source: updated, result } = await processYouTubeSource(source, ctx(youtube, 'SECRET-KEY'));
    assert.equal(result.result, 'error');
    assert.match(result.error || '', /quotaExceeded/);
    assert.doesNotMatch(result.error || '', /SECRET-KEY/);
    assert.equal(updated.status, 'waiting_for_key');
    assert.equal(updated.fetch && updated.fetch.lastResult, 'error');
    assert.equal(updated.fetch && updated.fetch.failures, 1);
    assert.doesNotMatch(JSON.stringify(updated), /SECRET-KEY/);
  });

  test('paused channels are skipped even with a key', async () => {
    const youtube = { fetchChannelVideos: async () => { throw new Error('should not be called'); } };
    const { result } = await processYouTubeSource(makeYouTubeSource({ id: 'yt-paused', status: 'paused' }), ctx(youtube, 'KEY'));
    assert.equal(result.result, 'skipped');
    assert.equal(result.error, 'paused');
  });
});

describe('runFetch', () => {
  /** The five-source scenario: one ok, one refused, one unreachable, one paused, one channel without key. */
  const scenarioSources = () => [
    makeSource({ id: 'ok-feed', url: 'https://ok.example/feed.xml' }),
    makeSource({ id: 'blocked-feed', url: 'https://blocked.example/feed.xml' }),
    makeSource({ id: 'down-feed', url: 'https://down.example/feed.xml' }),
    makeSource({ id: 'paused-feed', url: 'https://paused.example/feed.xml', status: 'paused' }),
    makeYouTubeSource({ id: 'yt-channel' }),
  ];
  const scenarioRoutes = () => ({
    'https://ok.example/feed.xml': (_url, init) => {
      const headers = new Headers(init.headers || {});
      if (headers.get('if-none-match') === 'W/"v1"') return respondStatus(304)();
      return respondXml(FEED_OK, { etag: 'W/"v1"', lastModified: 'Mon, 05 Oct 2026 10:00:00 GMT' })();
    },
    'https://blocked.example/feed.xml': respondStatus(403),
    'https://down.example/feed.xml': () => { throw networkError('ECONNRESET'); },
  });

  test('processes every source, writes sources.json, the items and the run log', async () => {
    const dir = makeDataDir({ sources: scenarioSources() });
    const calls = [];
    try {
      const lines = [];
      const run = await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes(), calls), apiKey: null, log: (line) => lines.push(line) });
      assert.equal(run.version, 1);
      assert.equal(run.startedAt, NOW_ISO);
      assert.ok(Date.parse(run.finishedAt) >= Date.parse(run.startedAt));
      assert.deepEqual(run.totals, { sources: 5, fetched: 1, unchanged: 0, added: 3, pruned: 0, blocked: 1, errors: 1, skipped: 2 });
      const byId = Object.fromEntries(run.sources.map((s) => [s.id, s]));
      assert.deepEqual(run.sources.map((s) => s.id), ['ok-feed', 'blocked-feed', 'down-feed', 'paused-feed', 'yt-channel']);
      assert.equal(byId['ok-feed'].result, 'ok');
      assert.equal(byId['ok-feed'].added, 3);
      assert.equal(byId['blocked-feed'].result, 'blocked');
      assert.equal(byId['blocked-feed'].error, 'HTTP 403');
      assert.equal(byId['down-feed'].result, 'error');
      assert.match(byId['down-feed'].error || '', /ECONNRESET/);
      assert.equal(byId['paused-feed'].result, 'skipped');
      assert.equal(byId['paused-feed'].error, 'paused');
      assert.equal(byId['yt-channel'].result, 'skipped');
      assert.equal(byId['yt-channel'].error, 'waiting for key');
      for (const entry of run.sources) {
        assert.ok(Number.isInteger(entry.ms) && entry.ms >= 0);
        assert.ok(entry.error === null || typeof entry.error === 'string');
      }
      assert.deepEqual(calls.map((c) => c.url).sort(), ['https://blocked.example/feed.xml', 'https://down.example/feed.xml', 'https://ok.example/feed.xml']);

      const sources = loadSources(dir).sources;
      const sourceById = /** @type {Record<string, any>} */ (Object.fromEntries(sources.map((s) => [s.id, s])));
      assert.equal(sourceById['ok-feed'].status, 'active');
      assert.equal(sourceById['ok-feed'].fetch.etag, 'W/"v1"');
      assert.equal(sourceById['ok-feed'].fetch.lastResult, 'ok');
      assert.equal(sourceById['blocked-feed'].status, 'blocked');
      assert.equal(sourceById['blocked-feed'].fetch.lastResult, 'blocked');
      assert.equal(sourceById['down-feed'].status, 'active');
      assert.equal(sourceById['down-feed'].fetch.failures, 1);
      assert.equal(sourceById['paused-feed'].fetch, null);
      assert.equal(sourceById['yt-channel'].status, 'waiting_for_key');
      assert.equal(sourceById['yt-channel'].fetch, null);

      const items = readJsonFile(path.join(dir, 'items', 'ok-feed.json'));
      assert.equal(items.sourceId, 'ok-feed');
      assert.equal(items.items.length, 3);
      for (let i = 1; i < items.items.length; i += 1) assert.ok(items.items[i - 1].published >= items.items[i].published, 'newest first');
      assert.deepEqual(fs.readdirSync(path.join(dir, 'items')), ['ok-feed.json']);

      const runs = fs.readdirSync(path.join(dir, 'runs'));
      assert.deepEqual(runs, ['2026-10-05T12-00-00Z.json']);
      assert.match(runs[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.json$/);
      assert.deepEqual(readJsonFile(path.join(dir, 'runs', runs[0])), run);
      assert.equal(lines.length, 5, 'one log line per source');
      assert.ok(lines.some((l) => /^BLOCKED\s+blocked-feed\s+HTTP 403$/.test(l)), lines.join('\n'));
      assert.ok(lines.some((l) => /^ok\s+ok-feed\s+\+3\s+\(\d+ ms\)$/.test(l)), lines.join('\n'));
    } finally {
      removeDir(dir);
    }
  });

  test('a second run sends the stored ETag, gets 304 and still prunes aged items', async () => {
    const dir = makeDataDir({ sources: scenarioSources() });
    try {
      await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes()), apiKey: null });
      const later = new Date(NOW.getTime() + 60 * DAY_MS);
      const calls = [];
      const run = await runFetch({ dataDir: dir, now: later, fetch: fakeFetch(scenarioRoutes(), calls), apiKey: null });
      const okCall = calls.find((c) => c.url === 'https://ok.example/feed.xml');
      assert.ok(okCall);
      assert.equal(okCall.headers.get('if-none-match'), 'W/"v1"');
      assert.equal(okCall.headers.get('if-modified-since'), 'Mon, 05 Oct 2026 10:00:00 GMT');
      const ok = run.sources.find((s) => s.id === 'ok-feed');
      assert.ok(ok);
      assert.equal(ok.result, 'unchanged');
      assert.equal(ok.pruned, 1);
      assert.equal(run.totals.unchanged, 1);
      assert.equal(run.totals.fetched, 1);
      assert.equal(run.totals.pruned, 1);
      assert.equal(run.totals.sources, 5);
      assert.equal(run.totals.skipped, 3, 'the blocked source is now skipped');
      assert.equal(run.totals.blocked, 0);
      assert.equal(readJsonFile(path.join(dir, 'items', 'ok-feed.json')).items.length, 2);
      assert.equal(calls.some((c) => c.url === 'https://blocked.example/feed.xml'), false, 'a blocked source is not requested again');
      assert.deepEqual(fs.readdirSync(path.join(dir, 'runs')), ['2026-10-05T12-00-00Z.json', '2026-12-04T12-00-00Z.json']);
    } finally {
      removeDir(dir);
    }
  });

  test('never has more than `concurrency` requests in flight', async () => {
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const dir = makeDataDir({ sources: ids.map((id) => makeSource({ id, url: `https://${id}.example/feed.xml` })) });
    try {
      let inFlight = 0;
      let peak = 0;
      const routes = Object.fromEntries(ids.map((id) => [`https://${id}.example/feed.xml`, async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await sleep(15);
        inFlight -= 1;
        return respondXml(rssFeed([{ title: `Story from ${id}`, link: `https://${id}.example/story`, published: daysAgo(1) }]))();
      }]));
      const run = await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(routes), apiKey: null, concurrency: 2 });
      assert.equal(peak, 2, `peak in-flight requests was ${peak}`);
      assert.equal(run.totals.fetched, 6);
      assert.equal(run.totals.added, 6);
      assert.deepEqual(run.sources.map((s) => s.id), ids, 'results keep the order of sources.json');
    } finally {
      removeDir(dir);
    }
  });

  test('`only` restricts the run to the named sources', async () => {
    const dir = makeDataDir({ sources: scenarioSources() });
    try {
      const calls = [];
      const run = await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes(), calls), apiKey: null, only: ['ok-feed', 'no-such-source'] });
      assert.equal(run.totals.sources, 1);
      assert.deepEqual(run.sources.map((s) => s.id), ['ok-feed']);
      assert.deepEqual(calls.map((c) => c.url), ['https://ok.example/feed.xml']);
      assert.equal(loadSources(dir).sources.find((s) => s.id === 'blocked-feed')?.status, 'active');
    } finally {
      removeDir(dir);
    }
  });

  test('dryRun writes nothing and returns the would-be log', async () => {
    const dir = makeDataDir({ sources: scenarioSources() });
    try {
      const before = fs.readFileSync(path.join(dir, 'sources.json'), 'utf8');
      const run = await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes()), apiKey: null, dryRun: true });
      assert.deepEqual(run.totals, { sources: 5, fetched: 1, unchanged: 0, added: 3, pruned: 0, blocked: 1, errors: 1, skipped: 2 });
      assert.equal(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'), before);
      assert.equal(fs.existsSync(path.join(dir, 'items')), false);
      assert.equal(fs.existsSync(path.join(dir, 'runs')), false);
    } finally {
      removeDir(dir);
    }
  });

  test('throws before writing anything when a data file is missing or invalid', async () => {
    const dir = makeDataDir({ sources: scenarioSources() });
    try {
      fs.writeFileSync(path.join(dir, 'sources.json'), '{ "version": 1, "sources": [ }');
      await assert.rejects(() => runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes()), apiKey: null }), /sources\.json/);
      fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ version: 1, sources: scenarioSources() }));
      fs.rmSync(path.join(dir, 'categories.json'));
      await assert.rejects(() => runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes()), apiKey: null }), /categories\.json/);
      fs.writeFileSync(path.join(dir, 'categories.json'), '{"version":1,"categories":[]}');
      fs.writeFileSync(path.join(dir, 'hidden.json'), 'not json');
      await assert.rejects(() => runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes()), apiKey: null }), /hidden\.json/);
      assert.equal(fs.existsSync(path.join(dir, 'runs')), false);
      assert.equal(fs.existsSync(path.join(dir, 'items')), false);
    } finally {
      removeDir(dir);
    }
  });

  test('a fetch that throws synchronously or oddly fails only that source', async () => {
    const dir = makeDataDir({ sources: [makeSource({ id: 'a', url: 'https://a.example/feed.xml' }), makeSource({ id: 'b', url: 'https://b.example/feed.xml' })] });
    try {
      const fetch = /** @type {typeof globalThis.fetch} */ ((input) => {
        if (String(input).startsWith('https://a.')) throw new Error('boom');
        if (String(input).startsWith('https://b.')) throw 'a string, not an Error';
        return Promise.resolve(new Response('', { status: 500 }));
      });
      const run = await runFetch({ dataDir: dir, now: NOW, fetch, apiKey: null });
      assert.equal(run.totals.errors, 2);
      assert.match(run.sources[0].error || '', /boom/);
      assert.match(run.sources[1].error || '', /a string/);
      assert.equal(loadSources(dir).sources[0].fetch?.failures, 1);
    } finally {
      removeDir(dir);
    }
  });

  test('a YouTube channel is fetched through the injected client when a key is given', async () => {
    const dir = makeDataDir({ sources: [makeYouTubeSource({ id: 'yt-one' })] });
    try {
      const youtube = {
        fetchChannelVideos: async () => ({
          channelId: 'UCyyyyyyyyyyyyyyyyyyyyyy',
          uploadsPlaylistId: 'UUyyyyyyyyyyyyyyyyyyyyyy',
          entries: [{ videoId: 'abcdefghijk', title: 'Clip', link: 'https://www.youtube.com/watch?v=abcdefghijk', guid: 'yt:abcdefghijk', published: daysAgo(1), summary: '', thumbnail: null }],
        }),
      };
      const run = await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch({}), apiKey: 'KEY', youtube });
      assert.equal(run.totals.added, 1);
      assert.equal(loadSources(dir).sources[0].status, 'active');
      assert.equal(loadSources(dir).sources[0].channelId, 'UCyyyyyyyyyyyyyyyyyyyyyy');
      assert.doesNotMatch(fs.readFileSync(listRuns(dir)[0], 'utf8'), /KEY/);
    } finally {
      removeDir(dir);
    }
  });

  test('a stored item hidden by the owner is dropped by mergeItems on later runs', async () => {
    const dir = makeDataDir({
      sources: [makeSource({ id: 'ok-feed', url: 'https://ok.example/feed.xml' })],
      hidden: [{ link: 'https://news.example/yesterday', guid: null, sourceId: 'ok-feed', hiddenAt: NOW_ISO }],
      items: { 'ok-feed': [makeItem({ link: 'https://news.example/old-one', published: daysAgo(5) })] },
    });
    try {
      const run = await runFetch({ dataDir: dir, now: NOW, fetch: fakeFetch(scenarioRoutes()), apiKey: null });
      assert.equal(run.totals.added, 2);
      const links = readJsonFile(path.join(dir, 'items', 'ok-feed.json')).items.map((i) => i.link);
      assert.deepEqual(links, ['https://news.example/fresh?id=1', 'https://news.example/old-one', 'https://news.example/august']);
    } finally {
      removeDir(dir);
    }
  });
});

describe('formatSourceLine', () => {
  test('lays out one line per result', () => {
    assert.equal(formatSourceLine({ id: 'globe-and-mail-canada', result: 'ok', added: 12, pruned: 0, ms: 812, error: null }), 'ok        globe-and-mail-canada  +12  (812 ms)');
    assert.equal(formatSourceLine({ id: 'x', result: 'unchanged', added: 0, pruned: 2, ms: 90, error: null }, { idWidth: 5 }), 'unchanged x      +0 -2  (90 ms)');
    assert.equal(formatSourceLine({ id: 'x', result: 'blocked', added: 0, pruned: 0, ms: 50, error: 'HTTP 403' }), 'BLOCKED   x  HTTP 403');
    assert.equal(formatSourceLine({ id: 'x', result: 'error', added: 0, pruned: 0, ms: 10003, error: 'timeout after 10000 ms' }), 'error     x  timeout after 10000 ms');
    assert.equal(formatSourceLine({ id: 'x', result: 'skipped', added: 0, pruned: 0, ms: 0, error: 'waiting for key' }), 'skipped   x  waiting for key');
  });
});
