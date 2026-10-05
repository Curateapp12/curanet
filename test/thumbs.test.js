import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { downloadThumbnail, embedThumbnails, toDataUri, SAFETY_MARGIN_BYTES } from '../src/lib/thumbs.js';

/** @param {number} width @param {number} height */
async function makePng(width, height) {
  return sharp({ create: { width, height, channels: 3, background: '#1d6f6b' } }).png().toBuffer();
}

/**
 * A fetch stand-in that answers every request with the same response.
 * @param {{status?: number, body?: Buffer|string, headers?: Record<string, string>}} options
 */
function fakeFetch(options) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const headers = new Headers(options.headers || { 'content-type': 'image/png' });
    const body = /** @type {any} */ (options.body === undefined ? new Uint8Array() : options.body);
    return new Response(body, { status: options.status || 200, headers });
  };
  return { fetch, calls };
}

test('downloadThumbnail turns a PNG into a WebP no wider than 240 px', async () => {
  const png = await makePng(480, 360);
  const { fetch, calls } = fakeFetch({ body: png });
  const out = await downloadThumbnail('https://example.com/a.png', { fetch });
  assert.ok(Buffer.isBuffer(out));
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 240);
  assert.equal(meta.height, 180);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/a.png');
  assert.equal(new Headers(calls[0].init.headers).get('user-agent'), 'Curanet/0.1 (+https://curanet.io)');
  assert.ok(calls[0].init.signal, 'request carries an abort signal for the timeout');
});

test('downloadThumbnail never upscales a small image', async () => {
  const png = await makePng(100, 80);
  const { fetch } = fakeFetch({ body: png });
  const out = await downloadThumbnail('https://example.com/small.png', { fetch });
  assert.ok(out);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 100);
  assert.equal(meta.height, 80);
});

test('downloadThumbnail returns null on a non-200 answer', async () => {
  const { fetch } = fakeFetch({ status: 404, body: await makePng(10, 10) });
  assert.equal(await downloadThumbnail('https://example.com/missing.png', { fetch }), null);
});

test('downloadThumbnail returns null when the answer is not an image', async () => {
  const { fetch } = fakeFetch({ body: '<html>not an image</html>', headers: { 'content-type': 'text/html' } });
  assert.equal(await downloadThumbnail('https://example.com/page', { fetch }), null);
  const garbage = fakeFetch({ body: Buffer.from('definitely not a jpeg'), headers: { 'content-type': 'image/jpeg' } });
  assert.equal(await downloadThumbnail('https://example.com/broken.jpg', { fetch: garbage.fetch }), null, 'sharp failure is swallowed');
});

test('downloadThumbnail returns null when the image is too large', async () => {
  const { fetch } = fakeFetch({ body: await makePng(10, 10), headers: { 'content-type': 'image/png', 'content-length': String(9 * 1024 * 1024) } });
  assert.equal(await downloadThumbnail('https://example.com/huge.png', { fetch }), null);
});

test('downloadThumbnail returns null on timeout and on a throwing fetch', async () => {
  const slow = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  assert.equal(await downloadThumbnail('https://example.com/slow.png', { fetch: slow, timeoutMs: 20 }), null);
  const failing = async () => { throw new TypeError('fetch failed'); };
  assert.equal(await downloadThumbnail('https://example.com/down.png', { fetch: failing }), null);
  assert.equal(await downloadThumbnail('not a url', { fetch: failing }), null);
  assert.equal(await downloadThumbnail('', { fetch: failing }), null);
});

test('downloadThumbnail caches by sha1 of the address and reads the cache first', async () => {
  const cacheDir = path.join(mkdtempSync(path.join(tmpdir(), 'curanet-thumbs-')), 'nested');
  const url = 'https://example.com/cached.png';
  const first = fakeFetch({ body: await makePng(300, 200) });
  const out1 = await downloadThumbnail(url, { fetch: first.fetch, cacheDir });
  assert.ok(out1);
  const expectedName = createHash('sha1').update(url).digest('hex') + '.webp';
  assert.deepEqual(readdirSync(cacheDir), [expectedName]);
  const failing = async () => { throw new Error('network is off'); };
  const out2 = await downloadThumbnail(url, { fetch: failing, cacheDir });
  assert.ok(out2 && out2.equals(out1), 'served from the cache without touching the network');
});

test('toDataUri builds a WebP data URI', () => {
  const uri = toDataUri(Buffer.from('abc'));
  assert.equal(uri, 'data:image/webp;base64,YWJj');
});

test('embedThumbnails gives the newest items their thumbnails and drops the rest once the budget is used', async () => {
  const items = [];
  for (let i = 0; i < 10; i += 1) {
    items.push({ id: 'i' + i, th: i === 3 || i === 7 ? null : 'https://example.com/' + i + '.jpg' });
  }
  const buf = Buffer.alloc(300, 1); // 300 bytes → 400 base64 chars + prefix = 423 chars per data URI
  const uriLength = toDataUri(buf).length;
  const baseBytes = 1000;
  const maxBytes = baseBytes + SAFETY_MARGIN_BYTES + uriLength * 3 + 10; // room for exactly three
  const order = [];
  const download = async (url) => {
    order.push(url);
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 10)); // out-of-order completion
    return buf;
  };
  const stats = await embedThumbnails(items, { maxBytes, baseBytes, download, concurrency: 4 });
  assert.deepEqual(items.map((i) => i.id), ['i0', 'i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9'], 'order unchanged');
  assert.ok(String(items[0].th).startsWith('data:image/webp;base64,'));
  assert.ok(String(items[1].th).startsWith('data:image/webp;base64,'));
  assert.ok(String(items[2].th).startsWith('data:image/webp;base64,'));
  assert.equal(items[3].th, null, 'had no thumbnail to begin with');
  for (const item of items.slice(4)) assert.equal(item.th, null, item.id + ' dropped for budget');
  assert.equal(stats.embedded, 3);
  assert.equal(stats.skipped, 2);
  assert.equal(stats.droppedForBudget, 5);
  assert.equal(stats.failed, 0);
  assert.equal(stats.bytes, uriLength * 3);
  assert.equal(stats.embedded + stats.skipped + stats.droppedForBudget + stats.failed, items.length, 'stats add up');
  assert.deepEqual(order.slice(0, 3), ['https://example.com/0.jpg', 'https://example.com/1.jpg', 'https://example.com/2.jpg'], 'newest first');

  // With one worker the downloads are strictly in order and stop right after the budget is spent.
  const serialItems = items.map((item, i) => ({ id: item.id, th: i === 3 || i === 7 ? null : 'https://example.com/' + i + '.jpg' }));
  const serialOrder = [];
  const serialStats = await embedThumbnails(serialItems, { maxBytes, baseBytes, download: async (url) => { serialOrder.push(url); return buf; }, concurrency: 1 });
  assert.equal(serialOrder.length, 4, 'three fit, the fourth overflows, nothing else is downloaded');
  assert.equal(serialStats.droppedForBudget, 5);
});

test('embedThumbnails counts failed downloads and embeds everything when the budget allows', async () => {
  const items = [
    { id: 'a', th: 'https://example.com/a.jpg' },
    { id: 'b', th: 'https://example.com/fails.jpg' },
    { id: 'c', th: null },
    { id: 'd', th: 'https://example.com/d.jpg' },
  ];
  const download = async (url) => (url.includes('fails') ? null : Buffer.alloc(10, 2));
  const stats = await embedThumbnails(items, { maxBytes: 1_000_000, baseBytes: 100, download, concurrency: 2 });
  assert.ok(String(items[0].th).startsWith('data:'));
  assert.equal(items[1].th, null);
  assert.equal(items[2].th, null);
  assert.ok(String(items[3].th).startsWith('data:'));
  assert.deepEqual({ embedded: stats.embedded, skipped: stats.skipped, droppedForBudget: stats.droppedForBudget, failed: stats.failed }, { embedded: 2, skipped: 1, droppedForBudget: 0, failed: 1 });
  assert.equal(stats.bytes, toDataUri(Buffer.alloc(10, 2)).length * 2);
});

test('embedThumbnails swallows a throwing downloader and handles an empty list', async () => {
  const items = [{ id: 'a', th: 'https://example.com/a.jpg' }];
  const stats = await embedThumbnails(items, { maxBytes: 1_000_000, baseBytes: 0, download: async () => { throw new Error('boom'); } });
  assert.equal(items[0].th, null);
  assert.equal(stats.failed, 1);
  const empty = await embedThumbnails([], { maxBytes: 10, baseBytes: 0, download: async () => null });
  assert.deepEqual(empty, { embedded: 0, skipped: 0, droppedForBudget: 0, failed: 0, bytes: 0 });
});
