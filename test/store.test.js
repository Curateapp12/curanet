import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../src/lib/store.js';
import { itemIdFromLink } from '../src/lib/sanitize.js';
import { NOW, daysAgo, CATEGORIES, makeDataDir, removeDir, makeSource, makeItem, readJsonFile } from './fixtures/fetcher/helpers.js';

const NOW_ISO = NOW.toISOString();

describe('dataPaths', () => {
  test('names every file and directory under the data dir', () => {
    const paths = store.dataPaths('/tmp/data');
    assert.equal(paths.root, '/tmp/data');
    assert.equal(paths.sources, path.join('/tmp/data', 'sources.json'));
    assert.equal(paths.categories, path.join('/tmp/data', 'categories.json'));
    assert.equal(paths.hidden, path.join('/tmp/data', 'hidden.json'));
    assert.equal(paths.itemsDir, path.join('/tmp/data', 'items'));
    assert.equal(paths.runsDir, path.join('/tmp/data', 'runs'));
    assert.equal(paths.itemsFile('le-devoir'), path.join('/tmp/data', 'items', 'le-devoir.json'));
  });
});

describe('readJson / writeJson', () => {
  /** @type {string} */
  let dir;
  before(() => { dir = makeDataDir(); });
  after(() => removeDir(dir));

  test('writeJson creates parent directories, pretty-prints with a trailing newline and leaves no temp files', () => {
    const file = path.join(dir, 'deep', 'nested', 'value.json');
    store.writeJson(file, { b: [1, 2], a: 'x' });
    assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "b": [\n    1,\n    2\n  ],\n  "a": "x"\n}\n');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['value.json']);
    assert.deepEqual(store.readJson(file), { b: [1, 2], a: 'x' });
  });

  test('writeJson replaces an existing file completely', () => {
    const file = path.join(dir, 'replace.json');
    store.writeJson(file, { long: 'x'.repeat(500) });
    store.writeJson(file, { s: 1 });
    assert.deepEqual(store.readJson(file), { s: 1 });
  });

  test('readJson returns the fallback when the file is missing', () => {
    const fallback = { items: [] };
    assert.equal(store.readJson(path.join(dir, 'missing.json'), fallback), fallback);
  });

  test('readJson without a fallback throws a plain-language error naming the missing file', () => {
    assert.throws(() => store.readJson(path.join(dir, 'missing.json')), /missing\.json/);
  });

  test('readJson names the file, line and column when the JSON is invalid', () => {
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{\n  "version": 1,\n  "items": [1, 2,]\n}\n');
    assert.throws(() => store.readJson(file), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /broken\.json/);
      assert.match(error.message, /line 3/);
      assert.match(error.message, /column 18/);
      return true;
    });
    fs.writeFileSync(file, '{"version": 1');
    assert.throws(() => store.readJson(file), /broken\.json.*line 1/s);
  });
});

describe('document loaders', () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = makeDataDir({
      sources: [makeSource({ id: 'alpha' })],
      hidden: [{ link: 'https://news.example/hidden', guid: null, sourceId: null, hiddenAt: NOW_ISO }],
      items: { alpha: [makeItem({ link: 'https://alpha.example/one', published: daysAgo(2) }), makeItem({ link: 'https://alpha.example/two', published: daysAgo(1) })] },
    });
  });
  after(() => removeDir(dir));

  test('loadSources / saveSources round-trip', () => {
    const doc = store.loadSources(dir);
    assert.equal(doc.version, 1);
    assert.equal(doc.sources.length, 1);
    assert.equal(doc.sources[0].id, 'alpha');
    doc.sources.push(makeSource({ id: 'beta', status: 'paused' }));
    store.saveSources(dir, doc);
    assert.equal(store.loadSources(dir).sources[1].status, 'paused');
  });

  test('loadCategories returns the category tree', () => {
    assert.deepEqual(store.loadCategories(dir), CATEGORIES);
  });

  test('loadHidden / saveHidden round-trip', () => {
    const doc = store.loadHidden(dir);
    assert.equal(doc.hidden.length, 1);
    doc.hidden.push({ link: 'https://news.example/other', guid: 'g', sourceId: 'alpha', hiddenAt: NOW_ISO });
    store.saveHidden(dir, doc);
    assert.equal(store.loadHidden(dir).hidden.length, 2);
  });

  test('loadItems returns an empty document for a source without a file', () => {
    assert.deepEqual(store.loadItems(dir, 'nobody'), { version: 1, sourceId: 'nobody', items: [] });
  });

  test('saveItems sorts newest first and listItemFiles / deleteItems see the files', () => {
    const doc = store.loadItems(dir, 'alpha');
    assert.equal(doc.items.length, 2);
    assert.equal(doc.items[0].link, 'https://alpha.example/one', 'fixture was written oldest first on purpose');
    store.saveItems(dir, doc);
    const saved = readJsonFile(path.join(dir, 'items', 'alpha.json'));
    assert.equal(saved.items[0].link, 'https://alpha.example/two');
    assert.equal(saved.items[1].link, 'https://alpha.example/one');
    assert.equal(saved.version, 1);
    assert.equal(saved.sourceId, 'alpha');
    store.saveItems(dir, { version: 1, sourceId: 'gamma', items: [] });
    assert.deepEqual(store.listItemFiles(dir), ['alpha', 'gamma']);
    store.deleteItems(dir, 'gamma');
    assert.deepEqual(store.listItemFiles(dir), ['alpha']);
    store.deleteItems(dir, 'gamma');
  });

  test('listItemFiles is empty when the items directory does not exist', () => {
    const empty = makeDataDir();
    try {
      assert.deepEqual(store.listItemFiles(empty), []);
    } finally {
      removeDir(empty);
    }
  });

  test('a missing sources.json or categories.json throws a plain-language error naming the file', () => {
    const bare = makeDataDir();
    fs.rmSync(path.join(bare, 'sources.json'));
    fs.rmSync(path.join(bare, 'categories.json'));
    try {
      assert.throws(() => store.loadSources(bare), /sources\.json/);
      assert.throws(() => store.loadCategories(bare), /categories\.json/);
    } finally {
      removeDir(bare);
    }
  });

  test('a sources.json without a sources list is rejected', () => {
    const odd = makeDataDir();
    fs.writeFileSync(path.join(odd, 'sources.json'), '{ "version": 1 }\n');
    fs.writeFileSync(path.join(odd, 'hidden.json'), '[]\n');
    try {
      assert.throws(() => store.loadSources(odd), /sources\.json.*list/i);
      assert.throws(() => store.loadHidden(odd), /hidden\.json/);
    } finally {
      removeDir(odd);
    }
  });
});

describe('entryToItem', () => {
  const entry = {
    title: '  Hello, world  ',
    link: 'https://News.example/story?utm_source=rss&id=1#top',
    guid: 'g-1',
    published: '2026-10-05T10:00:00.000Z',
    summary: Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '),
    thumbnail: 'https://news.example/img.jpg',
  };

  test('normalises the link, derives the id and trims the title', () => {
    const item = store.entryToItem(entry, { now: NOW });
    assert.ok(item);
    assert.equal(item.link, 'https://news.example/story?id=1');
    assert.equal(item.id, itemIdFromLink('https://news.example/story?id=1'));
    assert.equal(item.title, 'Hello, world');
    assert.equal(item.guid, 'g-1');
    assert.equal(item.published, '2026-10-05T10:00:00.000Z');
    assert.equal(item.thumbnail, 'https://news.example/img.jpg');
    assert.equal(item.type, 'article');
    assert.equal(item.addedAt, NOW_ISO);
    assert.equal('videoId' in item, false, 'articles never carry a videoId key');
  });

  test('truncates the excerpt to 300 characters', () => {
    const item = store.entryToItem(entry, { now: NOW });
    assert.ok(item);
    assert.ok(Array.from(item.excerpt).length <= 300);
    assert.ok(item.excerpt.endsWith('…'));
    assert.ok(item.excerpt.startsWith('word0 word1'));
    const short = store.entryToItem({ ...entry, summary: 'Short.' }, { now: NOW });
    assert.equal(short && short.excerpt, 'Short.');
  });

  test('falls back to now for the published date and null for guid and thumbnail', () => {
    const item = store.entryToItem({ title: 'T', link: 'https://news.example/x', guid: null, published: null, summary: '', thumbnail: null }, { now: NOW });
    assert.ok(item);
    assert.equal(item.published, NOW_ISO);
    assert.equal(item.guid, null);
    assert.equal(item.thumbnail, null);
    assert.equal(item.excerpt, '');
  });

  test('builds video items with their videoId', () => {
    const item = store.entryToItem({ ...entry, link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { now: NOW, type: 'video', videoId: 'dQw4w9WgXcQ' });
    assert.ok(item);
    assert.equal(item.type, 'video');
    assert.equal(item.videoId, 'dQw4w9WgXcQ');
  });

  test('returns null for an empty link or title', () => {
    assert.equal(store.entryToItem({ ...entry, link: '' }, { now: NOW }), null);
    assert.equal(store.entryToItem({ ...entry, link: '   ' }, { now: NOW }), null);
    assert.equal(store.entryToItem({ ...entry, title: '' }, { now: NOW }), null);
    assert.equal(store.entryToItem({ ...entry, title: '   ' }, { now: NOW }), null);
  });
});

describe('isDuplicate', () => {
  const existing = [makeItem({ link: 'https://news.example/a', guid: 'guid-a' }), makeItem({ link: 'https://news.example/n', guid: null })];
  const hidden = [{ link: 'https://news.example/h', guid: 'guid-h', sourceId: 'src', hiddenAt: NOW_ISO }];
  const check = (item) => store.isDuplicate(item, { existing, hidden, sourceId: 'src' });

  test('same link as a stored item', () => {
    assert.equal(check(makeItem({ link: 'https://news.example/a', guid: 'other' })), true);
  });
  test('same guid as a stored item of the same source', () => {
    assert.equal(check(makeItem({ link: 'https://news.example/a2', guid: 'guid-a' })), true);
  });
  test('same link as a hidden item', () => {
    assert.equal(check(makeItem({ link: 'https://news.example/h', guid: null })), true);
  });
  test('same guid as a hidden item of the same source, but not of another source', () => {
    assert.equal(check(makeItem({ link: 'https://news.example/h2', guid: 'guid-h' })), true);
    assert.equal(store.isDuplicate(makeItem({ link: 'https://news.example/h2', guid: 'guid-h' }), { existing, hidden, sourceId: 'other-source' }), false);
  });
  test('a null guid never matches another null guid', () => {
    assert.equal(check(makeItem({ link: 'https://news.example/new', guid: null })), false);
  });
  test('a new link and guid is not a duplicate', () => {
    assert.equal(check(makeItem({ link: 'https://news.example/new', guid: 'guid-new' })), false);
  });
});

describe('mergeItems', () => {
  test('adds only new items, skipping stored, hidden and repeated links, and never changes stored items', () => {
    const stored = makeItem({ link: 'https://news.example/a', guid: 'guid-a', title: 'Original title', published: daysAgo(3) });
    const existing = [stored];
    const hidden = [
      { link: 'https://news.example/hidden-link', guid: null, sourceId: 'src', hiddenAt: NOW_ISO },
      { link: 'https://news.example/hidden-guid-link', guid: 'guid-hidden', sourceId: 'src', hiddenAt: NOW_ISO },
    ];
    const incoming = [
      makeItem({ link: 'https://news.example/a', guid: 'guid-a', title: 'Changed title', published: daysAgo(3) }),
      makeItem({ link: 'https://news.example/b', guid: 'guid-b', published: daysAgo(1) }),
      makeItem({ link: 'https://news.example/b', guid: 'guid-b2', title: 'Same link twice', published: daysAgo(1) }),
      makeItem({ link: 'https://news.example/c', guid: 'guid-b', title: 'Same guid twice', published: daysAgo(1) }),
      makeItem({ link: 'https://news.example/hidden-link', guid: null }),
      makeItem({ link: 'https://news.example/elsewhere', guid: 'guid-hidden' }),
    ];
    const { items, added } = store.mergeItems(existing, incoming, { hidden, sourceId: 'src', now: NOW });
    assert.equal(added, 1);
    assert.deepEqual(items.map((i) => i.link), ['https://news.example/b', 'https://news.example/a']);
    assert.equal(items[1].title, 'Original title');
    assert.equal(items[1], stored, 'the stored copy is kept as is');
    assert.equal(existing.length, 1, 'the existing array is not modified');
  });

  test('skips null entries and works without hidden items', () => {
    const { items, added } = store.mergeItems([], [null, makeItem({ link: 'https://news.example/x' })], { sourceId: 'src', now: NOW });
    assert.equal(added, 1);
    assert.equal(items.length, 1);
  });
});

describe('pruneItems', () => {
  test('removes items published strictly more than 90 days ago', () => {
    const fresh = makeItem({ link: 'https://news.example/fresh', published: daysAgo(1) });
    const boundary = makeItem({ link: 'https://news.example/boundary', published: daysAgo(90) });
    const justInside = makeItem({ link: 'https://news.example/inside', published: daysAgo(90, -1) });
    const justOutside = makeItem({ link: 'https://news.example/outside', published: daysAgo(90, 1) });
    const old = makeItem({ link: 'https://news.example/old', published: daysAgo(200) });
    const { items, pruned } = store.pruneItems([fresh, boundary, justInside, justOutside, old], { now: NOW });
    assert.equal(pruned, 2);
    assert.deepEqual(items.map((i) => i.link), [fresh.link, boundary.link, justInside.link]);
  });

  test('honours a custom maxAgeDays', () => {
    const { items, pruned } = store.pruneItems([makeItem({ published: daysAgo(10) })], { now: NOW, maxAgeDays: 5 });
    assert.equal(pruned, 1);
    assert.equal(items.length, 0);
  });
});

describe('sortItems', () => {
  test('orders by published, then addedAt, then id, without touching the input', () => {
    const a = makeItem({ link: 'https://news.example/a', published: '2026-10-05T10:00:00.000Z', addedAt: '2026-10-05T11:05:00.000Z' });
    const b = makeItem({ link: 'https://news.example/b', published: '2026-10-05T11:00:00.000Z', addedAt: '2026-10-05T11:05:00.000Z' });
    const c = { ...makeItem({ link: 'https://news.example/c', published: '2026-10-05T11:00:00.000Z', addedAt: '2026-10-05T11:10:00.000Z' }), id: 'ffffffffffffffff' };
    const d = { ...makeItem({ link: 'https://news.example/d', published: '2026-10-05T11:00:00.000Z', addedAt: '2026-10-05T11:10:00.000Z' }), id: '0000000000000000' };
    const input = [a, b, c, d];
    const sorted = store.sortItems(input);
    assert.deepEqual(sorted.map((i) => i.link), [d.link, c.link, b.link, a.link]);
    assert.deepEqual(input.map((i) => i.link), [a.link, b.link, c.link, d.link]);
  });
});

describe('attachSourceFields', () => {
  test('adds the source fields the build needs without changing the item', () => {
    const item = makeItem({ link: 'https://news.example/a' });
    const source = makeSource({ id: 'src', name: 'Example News', category: 'news', subcategory: 'top-stories', country: 'FR', language: 'fr' });
    const tagged = store.attachSourceFields(item, source);
    assert.equal(tagged.sourceId, 'src');
    assert.equal(tagged.sourceName, 'Example News');
    assert.equal(tagged.category, 'news');
    assert.equal(tagged.subcategory, 'top-stories');
    assert.equal(tagged.country, 'FR');
    assert.equal(tagged.language, 'fr');
    assert.equal(tagged.link, item.link);
    assert.equal('sourceId' in item, false);
  });
});

describe('hideItemByLink', () => {
  /** @type {string} */
  let dir;
  const a1 = makeItem({ link: 'https://a.example/one', guid: 'a-1', published: daysAgo(2) });
  const a2 = makeItem({ link: 'https://a.example/two', guid: 'a-2', published: daysAgo(1) });
  const b1 = makeItem({ link: 'https://b.example/one', guid: 'b-1', published: daysAgo(1) });
  before(() => {
    dir = makeDataDir({ sources: [makeSource({ id: 'src-a' }), makeSource({ id: 'src-b' })], items: { 'src-a': [a2, a1], 'src-b': [b1] } });
  });
  after(() => removeDir(dir));

  test('removes the item from the right file and records it in hidden.json, matching the normalised link', () => {
    const { removed, sourceId } = store.hideItemByLink(dir, 'https://b.example/one?utm_source=newsletter#frag', { now: NOW, note: 'off topic' });
    assert.ok(removed);
    assert.equal(removed.link, 'https://b.example/one');
    assert.equal(sourceId, 'src-b');
    assert.deepEqual(readJsonFile(path.join(dir, 'items', 'src-b.json')).items, []);
    assert.equal(readJsonFile(path.join(dir, 'items', 'src-a.json')).items.length, 2);
    const hidden = store.loadHidden(dir).hidden;
    assert.equal(hidden.length, 1);
    assert.deepEqual(hidden[0], { link: 'https://b.example/one', guid: 'b-1', sourceId: 'src-b', hiddenAt: NOW_ISO, note: 'off topic' });
  });

  test('also accepts an item id', () => {
    const { removed, sourceId } = store.hideItemByLink(dir, a2.id, { now: NOW });
    assert.ok(removed);
    assert.equal(removed.id, a2.id);
    assert.equal(sourceId, 'src-a');
    const left = readJsonFile(path.join(dir, 'items', 'src-a.json')).items;
    assert.deepEqual(left.map((i) => i.id), [a1.id]);
    const entry = store.loadHidden(dir).hidden[1];
    assert.equal(entry.link, a2.link);
    assert.equal(entry.guid, 'a-2');
    assert.equal(entry.sourceId, 'src-a');
    assert.equal('note' in entry, false);
  });

  test('records the link even when no stored item matches, so later fetches skip it', () => {
    const { removed, sourceId } = store.hideItemByLink(dir, 'https://nowhere.example/story?utm_campaign=x', { now: NOW });
    assert.equal(removed, null);
    assert.equal(sourceId, null);
    const hidden = store.loadHidden(dir).hidden;
    assert.equal(hidden.length, 3);
    assert.deepEqual(hidden[2], { link: 'https://nowhere.example/story', guid: null, sourceId: null, hiddenAt: NOW_ISO });
  });

  test('does not record the same link twice', () => {
    store.hideItemByLink(dir, 'https://nowhere.example/story', { now: NOW });
    assert.equal(store.loadHidden(dir).hidden.length, 3);
  });
});

describe('run logs', () => {
  /** @type {string} */
  let dir;
  before(() => { dir = makeDataDir(); });
  after(() => removeDir(dir));

  const runLog = (startedAt) => ({
    version: 1,
    startedAt,
    finishedAt: startedAt,
    totals: { sources: 0, fetched: 0, unchanged: 0, added: 0, pruned: 0, blocked: 0, errors: 0, skipped: 0 },
    sources: [],
  });

  test('saveRun names the file after startedAt and listRuns returns newest first', () => {
    const file = store.saveRun(dir, runLog('2026-10-05T23:10:00.000Z'));
    assert.equal(file, path.join(dir, 'runs', '2026-10-05T23-10-00Z.json'));
    assert.deepEqual(readJsonFile(file), runLog('2026-10-05T23:10:00.000Z'));
    store.saveRun(dir, runLog('2026-06-01T01:02:03.000Z'));
    store.saveRun(dir, runLog('2026-10-06T00:00:00.000Z'));
    assert.deepEqual(store.listRuns(dir).map((p) => path.basename(p)), ['2026-10-06T00-00-00Z.json', '2026-10-05T23-10-00Z.json', '2026-06-01T01-02-03Z.json']);
  });

  test('pruneRuns deletes logs older than 90 days and returns how many', () => {
    assert.equal(store.pruneRuns(dir, { now: NOW }), 1);
    assert.deepEqual(store.listRuns(dir).map((p) => path.basename(p)), ['2026-10-06T00-00-00Z.json', '2026-10-05T23-10-00Z.json']);
    assert.equal(store.pruneRuns(dir, { now: NOW }), 0);
  });

  test('listRuns is empty when there is no runs directory', () => {
    const empty = makeDataDir();
    try {
      assert.deepEqual(store.listRuns(empty), []);
      assert.equal(store.pruneRuns(empty, { now: NOW }), 0);
    } finally {
      removeDir(empty);
    }
  });
});

test('itemsFile refuses source ids that could escape the data directory', async () => {
  const { dataPaths, entryToItem, hideItemByLink } = await import('../src/lib/store.js');
  const paths = dataPaths('data');
  for (const bad of ['../../pwned', 'Upper', 'a b', '', 'x/../y', 'trailing-']) {
    assert.throws(() => paths.itemsFile(bad), /not a valid source id/, bad);
  }
  assert.ok(paths.itemsFile('globe-and-mail-2').endsWith('globe-and-mail-2.json'));

  const huge = 'x'.repeat(5000);
  const capped = entryToItem({ title: 'T'.repeat(1000), link: 'https://e.example/a', guid: null, published: null, summary: '', thumbnail: 'https://e.example/' + huge });
  assert.ok(capped);
  assert.ok(Array.from(capped.title).length <= 300, 'title capped');
  assert.equal(capped.thumbnail, null, 'oversized thumbnail dropped');
  assert.equal(entryToItem({ title: 't', link: 'https://e.example/' + huge, guid: null, published: null, summary: '', thumbnail: null }), null, 'oversized link skipped');
  assert.equal(entryToItem({ title: 't', link: 'https://e.example/a', guid: huge, published: null, summary: '', thumbnail: null }), null, 'oversized guid skipped');
  assert.equal(entryToItem({ title: 't', link: 'javascript:alert(1)', guid: null, published: null, summary: '', thumbnail: null }), null, 'non-http link skipped');
  const jsThumb = entryToItem({ title: 't', link: 'https://e.example/a', guid: null, published: null, summary: '', thumbnail: 'javascript:alert(2)' });
  assert.equal(jsThumb && jsThumb.thumbnail, null, 'non-http thumbnail dropped');

  assert.throws(() => hideItemByLink('data', 'not a link at all'), /not a web address/);
  assert.throws(() => hideItemByLink('data', 'javascript:alert(1)'), /not a web address/);
});

test('mergeItems treats links stored by any source as duplicates and extends the shared set', async () => {
  const { mergeItems, pruneItems } = await import('../src/lib/store.js');
  const known = new Set(['https://a.example/story']);
  const incoming = /** @type {import('../src/lib/types.js').Item[]} */ ([
    { id: '0000000000000001', guid: null, link: 'https://a.example/story', title: 'Already stored by another source', excerpt: '', published: '2026-10-05T00:00:00.000Z', thumbnail: null, type: 'article', addedAt: '2026-10-05T00:00:00.000Z' },
    { id: '0000000000000002', guid: null, link: 'https://a.example/new', title: 'New', excerpt: '', published: '2026-10-05T00:00:00.000Z', thumbnail: null, type: 'article', addedAt: '2026-10-05T00:00:00.000Z' },
  ]);
  const merged = mergeItems([], incoming, { sourceId: 'b', knownLinks: known });
  assert.equal(merged.added, 1);
  assert.equal(merged.items[0].link, 'https://a.example/new');
  assert.ok(known.has('https://a.example/new'), 'accepted link added to the shared set');

  const now = new Date('2026-10-05T12:00:00Z');
  const old = /** @type {import('../src/lib/types.js').Item} */ ({ id: '0000000000000003', guid: null, link: 'https://a.example/old', title: 'Old undated', excerpt: '', published: '2026-06-01T00:00:00.000Z', thumbnail: null, type: 'article', addedAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(pruneItems([old], { now }).items.length, 0);
  assert.equal(pruneItems([old], { now, keep: (item) => item.published === item.addedAt }).items.length, 1, 'keep predicate retains an old item');
});
