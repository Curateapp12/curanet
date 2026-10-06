import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { assembleFeedData } from '../src/lib/build-data.js';
import { build, escapeJsonForScript, parseBuildArgs, DEFAULTS } from '../scripts/build.js';

const FIXTURE_DIR = new URL('./fixtures/build/', import.meta.url).pathname;
const SITE_DIR = new URL('../src/site/', import.meta.url).pathname;
const NOW = new Date('2026-10-05T12:00:00.000Z');

/** @returns {string} a fresh temporary directory */
function tempDir() {
  return mkdtempSync(path.join(tmpdir(), 'curanet-build-'));
}

/** Pulls the JSON out of the data script of a rendered page. */
function dataFrom(html) {
  const match = /<script id="curanet-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'the page has the data script');
  return JSON.parse(match[1]);
}

/** Pulls CURANET_CONFIG out of a rendered page. */
function configFrom(html) {
  const match = /var CURANET_CONFIG = (\{[^;]*\});/.exec(html);
  assert.ok(match, 'the page has the config script');
  return JSON.parse(match[1]);
}

// ------------------------------------------------------------------ assembleFeedData

test('assembleFeedData reads the fixture directory into compact feed data', () => {
  const data = assembleFeedData(FIXTURE_DIR, { now: NOW });
  assert.equal(data.generatedAt, NOW.toISOString());
  assert.deepEqual(Object.keys(data).sort(), ['categories', 'countries', 'generatedAt', 'items', 'languages', 'sources']);

  assert.equal(data.categories.length, 2);
  assert.deepEqual(data.categories[0], {
    id: 'news',
    name: { en: 'News', fr: 'Actualités' },
    subcategories: [
      { id: 'top-stories', name: { en: 'Top Stories', fr: 'À la une' } },
      { id: 'politics', name: { en: 'Politics', fr: 'Politique' } },
      { id: 'world', name: { en: 'World', fr: 'International' } },
    ],
  });

  assert.equal(data.sources.length, 4, 'every source is listed, whatever its status');
  const gazette = data.sources.find((s) => s.id === 'gazette');
  assert.deepEqual(gazette, {
    id: 'gazette', name: 'Example Gazette', type: 'feed', url: 'https://gazette.example/feed.xml', siteUrl: 'https://gazette.example',
    category: 'news', subcategory: 'top-stories', country: 'CA', language: 'en', status: 'active',
    lastSuccess: '2026-10-05T12:00:00.000Z', lastResult: 'ok',
  });
  const tube = data.sources.find((s) => s.id === 'yt-tech-tube');
  assert.ok(tube);
  assert.equal(tube.siteUrl, null, 'a channel has no siteUrl');
  assert.equal(tube.lastSuccess, null, 'never fetched');
  assert.equal(tube.lastResult, null);
});

test('assembleFeedData keeps items of paused sources, drops orphans and hidden items, sorts newest first', () => {
  const { items } = assembleFeedData(FIXTURE_DIR, { now: NOW });
  assert.equal(items.length, 6, '4 gazette - 1 hidden + 2 journal (paused) + 1 video; orphan dropped');
  assert.deepEqual(items.map((i) => i.id), [
    '1a2b3c4d5e6f7081', // gazette 10-05 09:00
    '5e6f708192031425', // le-journal 10-05 06:15 (paused source, still shown)
    '7081920314253647', // video 10-04 20:00
    '2b3c4d5e6f708192', // gazette 10-04 15:30
    '3c4d5e6f70819203', // gazette 10-02
    '6f70819203142536', // le-journal 09-28
  ]);
  for (let i = 1; i < items.length; i += 1) assert.ok(items[i - 1].p >= items[i].p, 'sorted newest first');
  assert.ok(!items.some((i) => i.l === 'https://gazette.example/news/hidden-story'), 'hidden item is gone');
  assert.ok(!items.some((i) => i.s === 'orphan-source'), 'orphan items are gone');
});

test('assembleFeedData emits only the compact keys', () => {
  const { items } = assembleFeedData(FIXTURE_DIR, { now: NOW });
  const article = items[0];
  assert.deepEqual(article, {
    id: '1a2b3c4d5e6f7081',
    s: 'gazette',
    t: 'Harbour reopens after a week of repairs',
    l: 'https://gazette.example/news/harbour-reopens',
    p: '2026-10-05T09:00:00.000Z',
    th: 'https://gazette.example/img/harbour.jpg',
    ty: 'a',
    x: 'Ferries run again from Monday morning after crews replaced the damaged pilings.',
  });
  const video = items.find((i) => i.ty === 'v');
  assert.ok(video);
  assert.deepEqual(Object.keys(video).sort(), ['id', 'l', 'p', 's', 't', 'th', 'ty', 'v', 'x']);
  assert.equal(video.v, 'dQw4w9WgXcQ');
  assert.equal(video.s, 'yt-tech-tube');
  const noThumb = items.find((i) => i.id === '2b3c4d5e6f708192');
  assert.ok(noThumb);
  assert.equal(noThumb.th, null);
  for (const item of items) {
    assert.ok(!('guid' in item) && !('addedAt' in item) && !('title' in item), 'no raw item fields leak');
    assert.ok(item.x.length <= 300, 'excerpts stay within 300 characters');
  }
  assert.equal(noThumb.x.length, 300, 'a 300-character excerpt is kept whole');
});

test('assembleFeedData derives languages and countries only from sources that have items', () => {
  const data = assembleFeedData(FIXTURE_DIR, { now: NOW });
  assert.deepEqual(data.languages, ['en', 'fr'], 'de (blocked source without items) is not offered');
  assert.deepEqual(data.countries, ['CA', 'US'], 'DE is not offered');
});

test('assembleFeedData copes with an empty data directory', () => {
  const dir = tempDir();
  const data = assembleFeedData(dir, { now: NOW });
  assert.deepEqual(data.items, []);
  assert.deepEqual(data.sources, []);
  assert.deepEqual(data.categories, []);
  assert.deepEqual(data.languages, []);
  assert.deepEqual(data.countries, []);
});

test('assembleFeedData names the broken file when JSON cannot be read', () => {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'sources.json'), '{ not json');
  assert.throws(() => assembleFeedData(dir), /sources\.json/);
});

// ------------------------------------------------------------------ the build

test('build renders the hosted site as a full document with remote thumbnails and URL state', async () => {
  const out = tempDir();
  const result = await build({ target: 'hosted', dataDir: FIXTURE_DIR, outDir: out, thumbs: false, now: NOW, log: () => {} });
  const html = readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'), 'starts with the doctype');
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/.test(html));
  assert.ok(html.includes('<title>Curanet — Curate the internet</title>'));
  assert.ok(html.includes('<meta name="description"'));
  assert.ok(html.includes('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque'));
  assert.ok(html.includes('<link rel="stylesheet" href="styles.css">'));
  assert.ok(html.includes('<script src="strings.js"></script>'));
  assert.ok(html.includes('<script src="app.js"></script>'));
  assert.ok(!html.includes('data:image'), 'hosted site never embeds images');

  const config = configFrom(html);
  assert.deepEqual(config, { mode: 'hosted', urlState: true, thumbnails: 'remote', video: 'embed', uiLang: 'en' });

  const data = dataFrom(html);
  assert.equal(data.items.length, 6);
  assert.equal(data.items[0].th, 'https://gazette.example/img/harbour.jpg', 'remote address kept');

  for (const file of ['styles.css', 'strings.js', 'app.js']) {
    assert.ok(existsSync(path.join(out, file)), file + ' copied');
    assert.equal(readFileSync(path.join(out, file), 'utf8'), readFileSync(path.join(SITE_DIR, file), 'utf8'));
  }
  assert.ok(result.hosted);
  assert.equal(result.hosted.items, 6);
  assert.ok(result.hosted.bytes > 1000);
  assert.equal(result.preview, null);
});

test('build renders the preview as an artifact fragment with embedded mode, link videos and in-page state', async () => {
  const out = tempDir();
  const previewOut = path.join(out, 'nested', 'curanet-preview.html');
  const result = await build({ target: 'preview', dataDir: FIXTURE_DIR, previewOut, thumbs: false, now: NOW, log: () => {} });
  const html = readFileSync(previewOut, 'utf8');
  assert.ok(html.startsWith('<title>Curanet</title>'), 'the title comes first');
  for (const forbidden of [/<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i, /<!doctype/i, /<\/html>/i, /<\/body>/i, /<\/head>/i]) {
    assert.ok(!forbidden.test(html), 'fragment must not contain ' + forbidden);
  }
  const titleAt = html.indexOf('<title>');
  const fontsAt = html.indexOf('<link rel="stylesheet" href="https://fonts.googleapis.com');
  const styleAt = html.indexOf('<style>');
  const bodyAt = html.indexOf('<header');
  const dataAt = html.indexOf('<script id="curanet-data"');
  const configAt = html.indexOf('var CURANET_CONFIG');
  const scriptAt = html.indexOf('var CURANET_STRINGS');
  assert.ok(titleAt < fontsAt && fontsAt < styleAt && styleAt < bodyAt && bodyAt < dataAt && dataAt < configAt && configAt < scriptAt, 'pieces are in order');
  assert.ok(!html.includes('<link rel="stylesheet" href="styles.css">'), 'CSS is inlined, not linked');
  assert.ok(!html.includes('src="app.js"'), 'JS is inlined, not linked');
  assert.ok(html.includes(readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8').trim()), 'styles.css inlined whole');

  const config = configFrom(html);
  assert.deepEqual(config, { mode: 'preview', urlState: false, thumbnails: 'embedded', video: 'link', uiLang: 'en' });

  const data = dataFrom(html);
  assert.equal(data.items.length, 6);
  assert.ok(data.items.every((i) => i.th === null), 'with --no-thumbs the preview has no thumbnails at all');
  assert.ok(!html.includes('data:image'));
  assert.equal(result.hosted, null);
  assert.ok(result.preview);
  assert.equal(result.preview.embedded, 0);
  assert.equal(result.preview.bytes, Buffer.byteLength(html));
});

test('build embeds thumbnails in the preview through the injected downloader and reports the stats', async () => {
  const out = tempDir();
  const previewOut = path.join(out, 'curanet-preview.html');
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6f6a' } }).png().toBuffer();
  const webp = await sharp(png).resize({ width: 240 }).webp().toBuffer();
  const asked = [];
  const download = async (url) => { asked.push(url); return url.includes('garden') ? null : webp; };
  const result = await build({ target: 'preview', dataDir: FIXTURE_DIR, previewOut, thumbs: true, download, now: NOW, log: () => {} });
  const html = readFileSync(previewOut, 'utf8');
  const data = dataFrom(html);
  assert.equal(asked.length, 4, 'one download per item that has a thumbnail');
  assert.equal(typeof data.items[0].th, 'number', 'embedded pictures are referenced by index');
  assert.ok(data.images[data.items[0].th].startsWith('data:image/webp;base64,'));
  assert.equal(data.images.length, 1, 'identical pictures are stored once in the images table');
  assert.equal(data.items.find((i) => i.id === '3c4d5e6f70819203').th, null, 'a failed download leaves no thumbnail');
  assert.ok(result.preview);
  assert.equal(result.preview.embedded, 3);
  assert.equal(result.preview.skipped, 2);
  assert.equal(result.preview.droppedForBudget, 0);
  assert.ok(result.preview.bytes > result.preview.baseBytes);
});

test('build fails in plain language when the preview would exceed the size limit', async () => {
  const out = tempDir();
  await assert.rejects(
    build({ target: 'preview', dataDir: FIXTURE_DIR, previewOut: path.join(out, 'p.html'), thumbs: false, maxBytes: 5000, now: NOW, log: () => {} }),
    /larger than/,
  );
});

test('build renders both targets by default and survives an empty data directory', async () => {
  const dataDir = tempDir();
  const out = tempDir();
  const result = await build({ dataDir, outDir: path.join(out, 'dist'), previewOut: path.join(out, 'preview.html'), thumbs: false, now: NOW, log: () => {} });
  assert.ok(result.hosted && result.preview);
  assert.equal(result.hosted.items, 0);
  assert.equal(result.preview.items, 0);
  const html = readFileSync(path.join(out, 'dist', 'index.html'), 'utf8');
  assert.deepEqual(dataFrom(html).items, []);
  assert.ok(html.includes('Nothing matches this selection.'), 'the empty state text is in the markup');
});

test('build copies nothing but the site assets into dist', async () => {
  const out = tempDir();
  await build({ target: 'hosted', dataDir: FIXTURE_DIR, outDir: out, thumbs: false, now: NOW, log: () => {} });
  assert.deepEqual(readdirSync(out).sort(), ['app.js', 'index.html', 'strings.js', 'styles.css']);
});

test('escapeJsonForScript keeps JSON valid and the script element unbreakable', () => {
  const nasty = { t: '</script><script>alert(1)</script> <!-- x --> a/b  ' };
  const escaped = escapeJsonForScript(JSON.stringify(nasty));
  assert.ok(!escaped.includes('</'), 'no raw closing tag');
  assert.ok(!escaped.includes('<!--'), 'no raw comment opener');
  assert.deepEqual(JSON.parse(escaped), nasty, 'still the same JSON');
});

test('parseBuildArgs understands every flag and the defaults', () => {
  assert.deepEqual(parseBuildArgs([]), {
    target: DEFAULTS.target, dataDir: DEFAULTS.dataDir, outDir: DEFAULTS.outDir, previewOut: DEFAULTS.previewOut,
    maxBytes: DEFAULTS.maxBytes, thumbs: true, thumbConcurrency: DEFAULTS.thumbConcurrency, thumbTimeoutMs: DEFAULTS.thumbTimeoutMs, cacheDir: DEFAULTS.cacheDir,
  });
  const parsed = parseBuildArgs(['--target', 'preview', '--data', 'd', '--out', 'o', '--preview-out', 'p.html', '--max-bytes', '1000', '--no-thumbs', '--thumb-concurrency', '2', '--thumb-timeout', '500', '--cache', 'c']);
  assert.deepEqual(parsed, { target: 'preview', dataDir: 'd', outDir: 'o', previewOut: 'p.html', maxBytes: 1000, thumbs: false, thumbConcurrency: 2, thumbTimeoutMs: 500, cacheDir: 'c' });
  assert.throws(() => parseBuildArgs(['--target', 'elsewhere']), /hosted, preview or all/);
  assert.throws(() => parseBuildArgs(['--max-bytes', 'lots']), /--max-bytes/);
});

// ------------------------------------------------------------------ static checks on the browser code

test('app.js and strings.js parse as plain scripts', () => {
  for (const file of ['strings.js', 'app.js']) {
    const source = readFileSync(path.join(SITE_DIR, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' has a syntax error');
    assert.ok(!/^\s*(import|export)\s/m.test(source), file + ' is not a module');
  }
});

test('app.js never puts data into innerHTML and never uses document.write or eval', () => {
  const source = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const lines = source.split('\n').filter((line) => line.includes('innerHTML'));
  for (const line of lines) {
    assert.match(line, /innerHTML\s*=\s*(''|"")\s*;?\s*$/, 'only literal empty-string assignments are allowed: ' + line.trim());
  }
  assert.ok(!/document\.write|\beval\(|new Function\(|insertAdjacentHTML|outerHTML\s*=/.test(source));
});

test('strings.js has the same keys in English and French and app.js only asks for keys that exist', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(SITE_DIR, 'strings.js'), 'utf8'), context);
  const strings = context.CURANET_STRINGS;
  assert.ok(strings && strings.en && strings.fr);
  const keys = Object.keys(strings.en);
  assert.deepEqual(Object.keys(strings.fr).sort(), keys.slice().sort(), 'French covers every English key');
  for (const key of keys) {
    assert.equal(typeof strings.en[key], 'string', key + ' is a string');
    assert.ok(strings.fr[key].trim() !== '', key + ' has a French value');
  }
  const untranslated = keys.filter((key) => strings.fr[key] === strings.en[key]);
  assert.ok(untranslated.length <= Math.ceil(keys.length * 0.15), 'French is translated, not copied: ' + untranslated.join(', '));
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const used = new Set();
  for (const match of app.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+)'/g)) used.add(match[1]);
  for (const key of used) assert.ok(key in strings.en, 'app.js uses an unknown string key: ' + key);
  const template = readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
  for (const match of template.matchAll(/data-t(?:-[a-z-]+)?="([a-zA-Z0-9_]+)"/g)) {
    assert.ok(match[1] in strings.en, 'index.html uses an unknown string key: ' + match[1]);
  }
});

test('the template is a body fragment that app.js can fill', () => {
  const template = readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
  assert.ok(template.trimStart().startsWith('<!--'), 'starts with the fragment comment');
  for (const forbidden of [/<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i, /<!doctype/i, /<script[\s>]/i, /<style[\s>]/i]) {
    assert.ok(!forbidden.test(template), 'template must not contain ' + forbidden);
  }
  for (const id of ['ribbon-categories', 'ribbon-subcategories', 'filter-lang', 'filter-loc', 'type-button', 'search-form', 'search-input', 'profile-button', 'profile-panel', 'feed-list', 'empty-state', 'result-count', 'feed-sentinel', 'show-more', 'sources-section', 'about-section', 'tpl-article', 'tpl-video']) {
    assert.ok(template.includes('id="' + id + '"'), 'template has #' + id);
  }
  assert.ok(template.includes('data-slot="account"'), 'account slot for later sign-in');
  assert.ok(template.includes('aria-live="polite"'));
  assert.ok(template.includes('removal@curanet.io'));
  assert.ok(!template.includes('mailto:'), 'the removal address is text, not a mailto link');
});

test('styles.css declares the theme tokens in the artifact shape and the Curanet fonts', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  assert.ok(/^:root\s*\{/m.test(css), 'bare :root block');
  assert.ok(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{[\s\S]*?color-scheme: dark/.test(css));
  assert.ok(/:root\[data-theme="dark"\]\s*\{[\s\S]*?color-scheme: dark/.test(css));
  assert.ok(/body\s*\{[^}]*background: var\(--/.test(css), 'body background from a token');
  assert.ok(css.includes('"Bricolage Grotesque"') && css.includes('"Source Sans 3"'));
  assert.ok(css.includes('prefers-reduced-motion'));
  assert.ok(css.includes(':focus-visible'));
  assert.ok(css.includes('env(safe-area-inset-top, 0px)'));
});
