import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateCategories,
  validateSources,
  validateItems,
  validateHidden,
  validateRun,
  validateAll,
  parseJson,
} from '../src/lib/validate.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/validate/', import.meta.url));
const REAL_DATA = fileURLToPath(new URL('../data', import.meta.url));
const CLI = fileURLToPath(new URL('../scripts/validate-data.js', import.meta.url));

/** @param {string} dir @param {string} file @returns {any} */
function load(dir, file) {
  return JSON.parse(readFileSync(path.join(FIXTURES, dir, file), 'utf8'));
}

/** @param {string[]} errors @param {RegExp} re @returns {string[]} */
function matching(errors, re) {
  return errors.filter((e) => re.test(e));
}

/** @returns {any} */
function goodFeed() {
  return {
    id: 'globe-and-mail',
    type: 'feed',
    name: 'Globe and Mail',
    url: 'https://www.theglobeandmail.com/rss',
    siteUrl: 'https://www.theglobeandmail.com',
    category: 'news',
    subcategory: 'top-stories',
    country: 'CA',
    language: 'en',
    status: 'active',
    addedAt: '2026-10-05T23:00:00.000Z',
    fetch: null,
  };
}

/** @returns {any} */
function goodChannel() {
  return {
    id: 'yt-cbc-news',
    type: 'youtube_channel',
    name: 'CBC News',
    url: 'https://www.youtube.com/@CBCNews',
    handle: '@CBCNews',
    channelId: null,
    category: 'news',
    subcategory: 'top-stories',
    country: 'CA',
    language: 'en',
    status: 'waiting_for_key',
    addedAt: '2026-10-05T23:00:00.000Z',
    fetch: null,
  };
}

/** @param {Partial<any>} [overrides] @returns {any} */
function goodItem(overrides = {}) {
  return {
    id: 'a1b2c3d4e5f60718',
    guid: null,
    link: 'https://example.com/story-1',
    title: 'A headline',
    excerpt: 'Short summary.',
    published: '2026-10-05T21:30:00.000Z',
    thumbnail: null,
    type: 'article',
    addedAt: '2026-10-05T23:10:00.000Z',
    ...overrides,
  };
}

const categoriesDoc = load('good', 'categories.json');
const sourcesDoc = load('good', 'sources.json');

// ---------------------------------------------------------------- validateAll on fixtures

test('validateAll accepts the good fixture directory with zero errors and zero warnings', () => {
  const result = validateAll(path.join(FIXTURES, 'good'));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.counts, { categories: 3, sources: 3, items: 3, hidden: 1, runs: 1 });
});

test('validateAll reports exactly one error for each problem in the bad fixture directory', () => {
  const { errors } = validateAll(path.join(FIXTURES, 'bad'));
  /** @type {[string, RegExp][]} */
  const expected = [
    ['duplicate source id', /sources\.json: source "dup-source" \(2nd\) has the same id as the 1st source/],
    ['unknown category', /sources\.json: source "unknown-cat" \(3rd\) has category "nope" — no such category/],
    ['lowercase country', /sources\.json: source "lower-country" \(4th\) has country "ca" — it must be two upper-case letters like CA/],
    ['bad language', /sources\.json: source "bad-language" \(5th\) has language "EN" — it must be two lower-case letters like en/],
    ['unknown status', /sources\.json: source "unknown-status" \(6th\) has status "stopped"/],
    ['waiting_for_key on a feed', /sources\.json: source "waiting-feed" \(7th\) is a feed with status waiting_for_key/],
    ['HTML in a title', /items\/html-title\.json: item 1 .*HTML in its title/],
    ['excerpt over 300 code points', /items\/long-excerpt\.json: item 1 .*excerpt of 301 characters — the limit is 300/],
    ['video without videoId', /items\/video-no-id\.json: item 1 .*is a video without a videoId/],
    ['unsorted items', /items\/unsorted\.json: items are not sorted newest first — item 2 .* is newer than item 1/],
    ['orphan items file', /items\/orphan\.json: orphan items file — no source with the id "orphan"/],
    ['invalid JSON with position', /runs\/2026-10-05T00-00-00Z\.json: not valid JSON at line 4, column 3/],
    ['unknown item field', /items\/unknown-field\.json: item 1 .*unexpected field "content" — only title, excerpt, link, published, thumbnail/],
  ];
  for (const [name, re] of expected) {
    assert.equal(matching(errors, re).length, 1, `${name}: expected exactly one error matching ${re}\n${errors.join('\n')}`);
  }
  assert.equal(errors.length, expected.length, 'no other errors expected:\n' + errors.join('\n'));
  for (const error of errors) {
    assert.match(error, /^test\/fixtures\/validate\/bad\/[\w./-]+\.json: /, 'every error starts with the file: ' + error);
  }
});

test('validateAll treats a missing sources.json as an empty source list', () => {
  const result = validateAll(path.join(FIXTURES, 'minimal'));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.counts, { categories: 3, sources: 0, items: 0, hidden: 0, runs: 0 });
});

test('validateAll reports a missing categories.json as an error', () => {
  const { errors } = validateAll(path.join(FIXTURES, 'no-categories'));
  assert.equal(matching(errors, /categories\.json: the file does not exist/).length, 1, errors.join('\n'));
});

test('validateAll reports a missing data directory in plain language', () => {
  const { errors } = validateAll(path.join(FIXTURES, 'does-not-exist'));
  assert.ok(errors.length >= 1);
  assert.match(errors[0], /does-not-exist/);
});

test('the real repository data directory has zero errors', () => {
  const result = validateAll(REAL_DATA);
  assert.deepEqual(result.errors, [], 'data/ must always validate:\n' + result.errors.join('\n'));
  assert.ok(result.counts.categories > 0);
});

// ---------------------------------------------------------------- parseJson

test('parseJson reports the line and column of a syntax error', () => {
  const bareWord = parseJson('{\n  "version": 1,\n  oops\n}\n', 'x.json');
  assert.equal(bareWord.ok, false);
  assert.match(bareWord.error, /^x\.json: not valid JSON at line 3, column 3/);
  const trailingComma = parseJson('{"a": 1,}', 'y.json');
  assert.equal(trailingComma.ok, false);
  assert.match(trailingComma.error, /^y\.json: not valid JSON at line 1, column 9/);
  const unterminated = parseJson('{"a": "abc', 'z.json');
  assert.equal(unterminated.ok, false);
  assert.match(unterminated.error, /^z\.json: not valid JSON/);
  const fine = parseJson('\uFEFF{"a": [1, 2.5e3, true, null, "é\\u00e9"]}', 'ok.json');
  assert.equal(fine.ok, true);
  assert.deepEqual(fine.doc, { a: [1, 2500, true, null, 'éé'] });
});

// ---------------------------------------------------------------- validateCategories

test('validateCategories accepts the good tree and the real tree', () => {
  assert.deepEqual(validateCategories(categoriesDoc), []);
  assert.deepEqual(validateCategories(JSON.parse(readFileSync(path.join(REAL_DATA, 'categories.json'), 'utf8'))), []);
});

test('validateCategories reports shape problems without throwing', () => {
  assert.equal(validateCategories(null).length, 1);
  assert.equal(validateCategories('text').length, 1);
  assert.equal(validateCategories([]).length, 1);
  assert.match(validateCategories({ version: 2, categories: [{ id: 'a', name: { en: 'A' }, subcategories: [] }] })[0], /version 2/);
  assert.match(validateCategories({ version: 1, categories: [] })[0], /empty/);
  assert.match(validateCategories({ version: 1, categories: 'x' })[0], /list/);
});

test('validateCategories checks ids, names and subcategories', () => {
  const errors = validateCategories({
    version: 1,
    categories: [
      { id: 'News', name: { en: 'News' }, subcategories: [] },
      { id: 'a', name: { en: 'A' }, subcategories: [] },
      { id: 'a', name: { en: 'A again' }, subcategories: [] },
      { id: 'b', name: { fr: 'B' }, subcategories: [] },
      { id: 'c', name: { en: 'C', fr: 3 }, subcategories: [] },
      { id: 'd', name: { en: 'D' } },
      { id: 'e', name: { en: 'E' }, subcategories: [{ id: 'x', name: { en: 'X' } }, { id: 'x', name: { en: 'X2' } }, { id: 'bad id', name: { en: 'Y' } }, 'nope'] },
      42,
    ],
  });
  assert.equal(matching(errors, /category "News" \(1st\) has id "News"/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /category "a" \(3rd\) has the same id as the 2nd/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /category "b" \(4th\) has no English name/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /category "c" \(5th\) has a French name that is not text/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /category "d" \(6th\) has no "subcategories" list/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /subcategory "x" \(2nd\) of category "e" \(7th\) has the same id as the 1st/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /subcategory "bad id" \(3rd\) of category "e" \(7th\) has id "bad id"/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /the 4th subcategory of category "e" \(7th\) is not an object/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /the 8th category is not an object/).length, 1, errors.join('\n'));
  assert.equal(errors.length, 9, errors.join('\n'));
});

// ---------------------------------------------------------------- validateSources

test('validateSources accepts the good sources', () => {
  const warnings = [];
  assert.deepEqual(validateSources(sourcesDoc, categoriesDoc, { warnings }), []);
  assert.deepEqual(warnings, []);
});

test('validateSources reports shape problems without throwing', () => {
  assert.equal(validateSources(null, categoriesDoc).length, 1);
  assert.equal(validateSources({ version: 1 }, categoriesDoc).length, 1);
  assert.match(validateSources({ version: 1, sources: [null] }, categoriesDoc)[0], /the 1st source is not an object/);
});

test('validateSources checks YouTube channel rules', () => {
  const withoutPrefix = { ...goodChannel(), id: 'cbc-news' };
  assert.match(validateSources({ version: 1, sources: [withoutPrefix] }, categoriesDoc)[0], /does not start with "yt-"/);

  const badUrl = { ...goodChannel(), url: 'https://vimeo.com/cbc' };
  assert.match(validateSources({ version: 1, sources: [badUrl] }, categoriesDoc)[0], /youtube\.com/);

  const badHandle = { ...goodChannel(), handle: 'CBCNews' };
  assert.match(validateSources({ version: 1, sources: [badHandle] }, categoriesDoc)[0], /handle/);

  const noIdentity = { ...goodChannel(), handle: null, channelId: null };
  assert.match(validateSources({ version: 1, sources: [noIdentity] }, categoriesDoc)[0], /handle or a channelId/);

  const withChannelId = { ...goodChannel(), handle: null, channelId: 'UCuFFtHWoLl5fauMMD5Ww2jA' };
  assert.deepEqual(validateSources({ version: 1, sources: [withChannelId] }, categoriesDoc), []);

  const badChannelId = { ...goodChannel(), channelId: 'abc' };
  assert.match(validateSources({ version: 1, sources: [badChannelId] }, categoriesDoc)[0], /channelId/);

  const active = { ...goodChannel(), status: 'active' };
  assert.deepEqual(validateSources({ version: 1, sources: [active] }, categoriesDoc), []);
});

test('validateSources checks feed urls, dates, subcategories, types and fetch state', () => {
  const run = (patch) => validateSources({ version: 1, sources: [{ ...goodFeed(), ...patch }] }, categoriesDoc);
  assert.match(run({ url: 'ftp://example.com/feed' })[0], /url/);
  assert.match(run({ siteUrl: 'not a url' })[0], /siteUrl/);
  assert.match(run({ subcategory: 'nope' })[0], /subcategory "nope" — category "news" has no such subcategory/);
  assert.match(run({ type: 'podcast' })[0], /type "podcast"/);
  assert.match(run({ name: '' })[0], /name/);
  assert.match(run({ addedAt: '2026-10-05' })[0], /addedAt "2026-10-05"/);
  assert.match(run({ fetch: 'yes' })[0], /fetch/);
  assert.match(run({ fetch: { etag: null, lastModified: null, lastAttempt: null, lastSuccess: null, lastResult: 'maybe', lastError: null, failures: 0 } })[0], /lastResult "maybe"/);
  assert.match(run({ fetch: { etag: null, lastModified: null, lastAttempt: null, lastSuccess: null, lastResult: null, lastError: null, failures: -1 } })[0], /failures/);
  assert.match(run({ fetch: { etag: null } })[0], /fetch/);
  assert.match(run({ notes: 5 })[0], /notes/);
  assert.match(run({ id: 'Bad Id' })[0], /id "Bad Id"/);
  assert.deepEqual(run({ fetch: { etag: 'W/"x"', lastModified: null, lastAttempt: '2026-10-05T23:10:00.000Z', lastSuccess: null, lastResult: 'error', lastError: 'timeout after 10000 ms', failures: 2 } }), []);
  assert.deepEqual(run({ siteUrl: undefined }), []);
});

test('validateSources returns unknown fields as warnings, not errors', () => {
  const warnings = [];
  const doc = { version: 1, sources: [{ ...goodFeed(), colour: 'blue', handle: '@x' }] };
  const errors = validateSources(doc, categoriesDoc, { warnings });
  assert.deepEqual(errors, []);
  assert.equal(matching(warnings, /source "globe-and-mail" \(1st\) has an unknown field "colour"/).length, 1, warnings.join('\n'));
  assert.equal(matching(warnings, /handle/).length, 1, warnings.join('\n'));
});

test('validateSources skips the category check when no category tree is given', () => {
  const doc = { version: 1, sources: [{ ...goodFeed(), category: 'anything' }] };
  assert.deepEqual(validateSources(doc, null), []);
  assert.equal(validateSources(doc, categoriesDoc).length, 1);
});

// ---------------------------------------------------------------- validateItems

test('validateItems accepts a good file and counts the excerpt in code points', () => {
  const sources = sourcesDoc.sources;
  const emoji300 = goodItem({ excerpt: '😀'.repeat(300) });
  assert.equal(emoji300.excerpt.length, 600, 'UTF-16 length is twice the code point count');
  const doc = { version: 1, sourceId: 'globe-and-mail-canada', items: [emoji300] };
  assert.deepEqual(validateItems(doc, { sourceId: 'globe-and-mail-canada', sources }), []);

  const emoji301 = { ...doc, items: [goodItem({ excerpt: '😀'.repeat(301) })] };
  const errors = validateItems(emoji301, { sourceId: 'globe-and-mail-canada', sources });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /excerpt of 301 characters — the limit is 300/);
});

test('validateItems checks the envelope, the file name and the owning source', () => {
  const sources = sourcesDoc.sources;
  assert.equal(validateItems(null, { sourceId: 'x', sources }).length, 1);
  assert.match(validateItems({ version: 1, sourceId: 'le-devoir', items: [] }, { sourceId: 'other', sources })[0], /sourceId "le-devoir" but the file is named other\.json/);
  assert.match(validateItems({ version: 1, sourceId: 'ghost', items: [] }, { sourceId: 'ghost', sources })[0], /orphan items file/);
  assert.match(validateItems({ version: 1, items: [] }, { sourceId: 'ghost', sources })[0], /sourceId/);
  assert.deepEqual(validateItems({ version: 1, sourceId: 'ghost', items: [] }, { sourceId: 'ghost' }), [], 'no source list means no orphan check');
});

test('validateItems checks every item field', () => {
  const sources = sourcesDoc.sources;
  const run = (patch) => validateItems({ version: 1, sourceId: 'le-devoir', items: [goodItem(patch)] }, { sourceId: 'le-devoir', sources });
  assert.match(run({ id: 'xyz' })[0], /id "xyz"/);
  assert.match(run({ link: 'javascript:alert(1)' })[0], /link/);
  assert.match(run({ title: '' })[0], /title/);
  assert.match(run({ title: 'Hi <img src=x>' })[0], /HTML in its title/);
  assert.match(run({ excerpt: 'Hi <script>' })[0], /HTML in its excerpt/);
  assert.match(run({ excerpt: 7 })[0], /excerpt/);
  assert.match(run({ published: 'yesterday' })[0], /published "yesterday"/);
  assert.match(run({ thumbnail: 'data:image/png;base64,AAAA' })[0], /thumbnail/);
  assert.match(run({ type: 'podcast' })[0], /type "podcast"/);
  assert.match(run({ type: 'video' })[0], /video without a videoId/);
  assert.match(run({ type: 'video', videoId: 'short' })[0], /videoId "short"/);
  assert.match(run({ videoId: 'dQw4w9WgXcQ' })[0], /is an article but has a videoId/);
  assert.match(run({ addedAt: null })[0], /addedAt/);
  assert.match(run({ guid: 5 })[0], /guid/);
  assert.match(run({ guid: undefined })[0], /guid/);
  assert.match(run({ content: 'full text' })[0], /unexpected field "content"/);
  assert.deepEqual(run({ type: 'video', videoId: 'dQw4w9WgXcQ', thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' }), []);
  assert.deepEqual(run({ guid: 'tag:example.com,2026:1' }), []);
});

test('validateItems reports duplicate ids and links and bad ordering once each', () => {
  const sources = sourcesDoc.sources;
  const older = goodItem({ id: '1111111111111111', link: 'https://example.com/a', published: '2026-10-01T00:00:00.000Z' });
  const newer = goodItem({ id: '2222222222222222', link: 'https://example.com/b', published: '2026-10-03T00:00:00.000Z' });
  const newest = goodItem({ id: '3333333333333333', link: 'https://example.com/c', published: '2026-10-04T00:00:00.000Z' });
  const unsorted = validateItems({ version: 1, sourceId: 'le-devoir', items: [older, newer, newest] }, { sourceId: 'le-devoir', sources });
  assert.equal(unsorted.length, 1, unsorted.join('\n'));
  assert.match(unsorted[0], /not sorted newest first — item 2 \(2026-10-03T00:00:00.000Z\) is newer than item 1 \(2026-10-01T00:00:00.000Z\)/);

  const sameId = validateItems({ version: 1, sourceId: 'le-devoir', items: [newest, { ...newer, id: newest.id }] }, { sourceId: 'le-devoir', sources });
  assert.equal(sameId.length, 1, sameId.join('\n'));
  assert.match(sameId[0], /item 2 .*same id as item 1/);

  const sameLink = validateItems({ version: 1, sourceId: 'le-devoir', items: [newest, { ...newer, link: newest.link }] }, { sourceId: 'le-devoir', sources });
  assert.equal(sameLink.length, 1, sameLink.join('\n'));
  assert.match(sameLink[0], /item 2 .*same link as item 1/);

  const notObject = validateItems({ version: 1, sourceId: 'le-devoir', items: ['x'] }, { sourceId: 'le-devoir', sources });
  assert.match(notObject[0], /item 1 is not an object/);
});

// ---------------------------------------------------------------- validateHidden

test('validateHidden accepts the good file and reports bad entries', () => {
  assert.deepEqual(validateHidden(load('good', 'hidden.json')), []);
  assert.deepEqual(validateHidden({ version: 1, hidden: [{ link: 'https://x.com/a', hiddenAt: '2026-10-05T23:20:00.000Z' }] }), []);
  assert.equal(validateHidden(null).length, 1);
  assert.match(validateHidden({ version: 1, hidden: {} })[0], /list/);
  const errors = validateHidden({
    version: 1,
    hidden: [
      { link: 'nope', hiddenAt: '2026-10-05T23:20:00.000Z' },
      { link: 'https://x.com/a', hiddenAt: 'today' },
      { link: 'https://x.com/b', hiddenAt: '2026-10-05T23:20:00.000Z', guid: 4, sourceId: {}, note: [] },
      7,
    ],
  });
  assert.equal(matching(errors, /hidden item 1 has link "nope"/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /hidden item 2 has hiddenAt "today"/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /hidden item 3 .*guid/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /hidden item 3 .*sourceId/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /hidden item 3 .*note/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /hidden item 4 is not an object/).length, 1, errors.join('\n'));
  assert.equal(errors.length, 6, errors.join('\n'));
});

// ---------------------------------------------------------------- validateRun

test('validateRun accepts the good run log and reports bad ones', () => {
  assert.deepEqual(validateRun(load('good', 'runs/2026-10-05T23-10-00Z.json')), []);
  assert.equal(validateRun(null).length, 1);
  const errors = validateRun({
    version: 1,
    startedAt: '2026-10-05T23:10:00.000Z',
    finishedAt: 'later',
    totals: { sources: 1, fetched: 1, unchanged: 0, added: -3, pruned: 0, blocked: 0, errors: 0 },
    sources: [
      { id: 'a', result: 'ok', added: 1, pruned: 0, ms: 12, error: null },
      { id: 'b', result: 'exploded', added: 0, pruned: 0, ms: 1.5, error: 7 },
      { result: 'ok', added: 0, pruned: 0, ms: 0, error: null },
    ],
  }, { file: 'data/runs/x.json' });
  assert.equal(matching(errors, /^data\/runs\/x\.json: has finishedAt "later"/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /totals\.added/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /totals\.skipped/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /source "b" \(2nd\) has result "exploded"/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /source "b" \(2nd\) has ms 1\.5/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /source "b" \(2nd\) has error 7/).length, 1, errors.join('\n'));
  assert.equal(matching(errors, /the 3rd source has no id/).length, 1, errors.join('\n'));
  assert.equal(errors.length, 7, errors.join('\n'));
  assert.match(validateRun({ version: 1, startedAt: '2026-10-05T23:10:00.000Z', finishedAt: '2026-10-05T23:10:00.000Z', totals: 'none', sources: [] })[0], /totals/);
});

// ---------------------------------------------------------------- CLI

test('validate-data CLI prints counts, warnings, errors and exits 1 on problems', () => {
  const bad = spawnSync(process.execPath, [CLI, '--data', path.join(FIXTURES, 'bad')], { encoding: 'utf8' });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  const lines = bad.stdout.trim().split('\n');
  assert.match(lines[0], /3 categories, 12 sources, 7 items, 0 hidden, 0 runs/);
  assert.equal(lines.filter((l) => l.startsWith('Error: ')).length, 13, bad.stdout);
  assert.equal(lines[lines.length - 1], '13 problems found');

  const good = spawnSync(process.execPath, [CLI, '--data', path.join(FIXTURES, 'good')], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(good.stdout.trim().split('\n').pop(), 'Data OK');

  const missing = spawnSync(process.execPath, [CLI, '--data'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout + missing.stderr, /--data/);
});
