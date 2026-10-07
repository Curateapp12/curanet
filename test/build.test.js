import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { assembleFeedData, compactItem } from '../src/lib/build-data.js';
import { build, escapeJsonForScript, parseBuildArgs, DEFAULTS, THEME_SCRIPT } from '../scripts/build.js';

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

/** @returns {string} the body fragment src/site/index.html */
function readTemplate() {
  return readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
}

/**
 * The article/video toggle's <img> and its three glyphs. They are the live site's both.png,
 * video.png and article.png (30×30 white line art), carried as data URIs so nothing is loaded
 * from anywhere; they are the only images the template embeds.
 */
function toggleGlyphs(template) {
  const tag = (/<img id="type-glyph"[^>]*>/.exec(template) || [])[0];
  assert.ok(tag, 'the template has the toggle glyph <img id="type-glyph">');
  const attr = (name) => (new RegExp(` ${name}="([^"]*)"`).exec(tag) || [])[1];
  return { tag, src: attr('src'), alt: attr('alt'), both: attr('data-src-both'), videos: attr('data-src-videos'), articles: attr('data-src-articles') };
}

/**
 * Every data:image URI of a rendered page outside the toggle glyph's <img>, i.e. any picture that
 * is not one of the three interface glyphs.
 */
function embeddedImagesOutsideGlyphs(html) {
  const { tag } = toggleGlyphs(readTemplate());
  assert.ok(html.includes(tag), 'the page carries the template\'s toggle glyph unchanged');
  return html.split(tag).join('').match(/data:image\/[a-z+]+[;,][^"'\s)]{0,40}/g) || [];
}

/** No web font, font CDN or font file is referenced by a rendered page. */
function assertNoWebFont(html, label) {
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/i.test(html), label + ': no Google Fonts address');
  assert.ok(!/<link[^>]+rel="(?:preconnect|preload|dns-prefetch)"/i.test(html), label + ': no preconnect or preload link');
  assert.ok(!/@font-face|\.woff2?\b|\.ttf\b|\.otf\b/i.test(html), label + ': no font face or font file');
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
  assert.ok(html.includes('<link rel="stylesheet" href="styles.css">'));
  assert.deepEqual(html.match(/<link[^>]*>/g), ['<link rel="icon" type="image/svg+xml" href="icon.svg">', '<link rel="stylesheet" href="styles.css">'], 'the local tab icon and stylesheet are the only <link>s');
  assert.ok(html.includes('<meta name="theme-color" content="#3B82F6">'), 'the live site\'s theme colour tints phone address bars');
  assertNoWebFont(html, 'hosted');
  assert.ok(html.includes('<script src="strings.js"></script>'));
  assert.ok(html.includes('<script src="app.js"></script>'));
  assert.deepEqual(html.match(/<script[^>]+src="[^"]*"/g), ['<script src="strings.js"', '<script src="app.js"'], 'only the two local scripts are loaded');
  assert.deepEqual(embeddedImagesOutsideGlyphs(html), [], 'the hosted site never embeds publisher images');
  assert.equal((html.match(/data:image\//g) || []).length, 4, 'the only data:image URIs are the toggle glyph (src and the three data-src)');
  const themeAt = html.indexOf(THEME_SCRIPT);
  assert.ok(themeAt > 0 && themeAt < html.indexOf('<link rel="stylesheet" href="styles.css">') && themeAt < html.indexOf('<body>'), 'the theme script runs in <head>, before the styles');

  const config = configFrom(html);
  assert.deepEqual(config, { mode: 'hosted', urlState: true, thumbnails: 'remote', video: 'embed', uiLang: 'en' });

  const data = dataFrom(html);
  assert.equal(data.items.length, 6);
  assert.equal(data.items[0].th, 'https://gazette.example/img/harbour.jpg', 'remote address kept');
  assert.ok(!('images' in data), 'the hosted data has no embedded images table');
  for (const item of data.items) assert.ok(item.th === null || /^https?:\/\//.test(item.th), 'every thumbnail is a publisher address');

  for (const file of ['styles.css', 'strings.js', 'app.js', 'icon.svg']) {
    assert.ok(existsSync(path.join(out, file)), file + ' copied');
    assert.equal(readFileSync(path.join(out, file), 'utf8'), readFileSync(path.join(SITE_DIR, file), 'utf8'));
  }
  // The tab icon is the live logo filling its box, drawn with literal colours, loading nothing.
  const icon = readFileSync(path.join(out, 'icon.svg'), 'utf8');
  assert.ok(icon.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 60 60"'), 'the rounded square fills the tab icon');
  assert.ok(icon.includes('fill="#3b82f6"') && !icon.includes('currentColor'), 'literal colours');
  assert.ok(!/href=|<script|<image/i.test(icon), 'the icon loads nothing and runs nothing');
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
  const themeAt = html.indexOf(THEME_SCRIPT);
  const styleAt = html.indexOf('<style>');
  const bodyAt = html.indexOf('<header');
  const dataAt = html.indexOf('<script id="curanet-data"');
  const configAt = html.indexOf('var CURANET_CONFIG');
  const scriptAt = html.indexOf('var CURANET_STRINGS');
  assert.ok(titleAt === 0 && titleAt < themeAt && themeAt < styleAt && styleAt < bodyAt && bodyAt < dataAt && dataAt < configAt && configAt < scriptAt, 'pieces are in order');
  assert.equal((html.slice(0, bodyAt).match(/<script[\s>]/g) || []).length, 1, 'the theme script is the only script before the markup');
  assert.ok(!/<link[\s>]/i.test(html), 'the preview links nothing: no stylesheet, font or icon is loaded');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no script is loaded from anywhere');
  assertNoWebFont(html, 'preview');
  assert.ok(!html.includes('href="styles.css"'), 'CSS is inlined, not linked');
  assert.ok(!html.includes('src="app.js"'), 'JS is inlined, not linked');
  assert.ok(!/<a [^>]*href="\?/.test(html), 'no query-string links: the preview keeps its state inside the page');
  assert.ok(html.includes(readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8').trim()), 'styles.css inlined whole');

  const config = configFrom(html);
  assert.deepEqual(config, { mode: 'preview', urlState: false, thumbnails: 'embedded', video: 'link', uiLang: 'en' });

  const data = dataFrom(html);
  assert.equal(data.items.length, 6);
  assert.ok(data.items.every((i) => i.th === null), 'with --no-thumbs the preview has no thumbnails at all');
  assert.ok(!('images' in data), 'and no images table');
  assert.deepEqual(embeddedImagesOutsideGlyphs(html), [], 'nothing but the toggle glyphs is embedded');
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
  assert.ok(html.includes('No content in this category yet.'), 'the empty state text is in the markup');
  assert.ok(html.includes('id="clear-filters"'), 'with its Clear filters button');
  assertNoWebFont(readFileSync(path.join(out, 'preview.html'), 'utf8'), 'empty preview');
});

test('build copies nothing but the site assets into dist', async () => {
  const out = tempDir();
  await build({ target: 'hosted', dataDir: FIXTURE_DIR, outDir: out, thumbs: false, now: NOW, log: () => {} });
  assert.deepEqual(readdirSync(out).sort(), ['app.js', 'icon.svg', 'index.html', 'strings.js', 'styles.css']);
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
  // The {n}, {title}, {date}, {category} placeholders t() fills must be the same in both languages.
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const key of keys) {
    assert.equal(placeholders(strings.fr[key]), placeholders(strings.en[key]), key + ' has the same placeholders in French');
    assert.ok(!/<|>/.test(strings.en[key] + strings.fr[key]), key + ' is plain text, no markup');
  }
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const used = new Set();
  for (const match of app.matchAll(/\bt\(\s*'([a-zA-Z0-9_]+)'/g)) used.add(match[1]);
  for (const key of used) assert.ok(key in strings.en, 'app.js uses an unknown string key: ' + key);
  const template = readTemplate();
  const inTemplate = new Set();
  for (const match of template.matchAll(/data-t(?:-[a-z-]+)?="([a-zA-Z0-9_]+)"/g)) {
    assert.ok(match[1] in strings.en, 'index.html uses an unknown string key: ' + match[1]);
    inTemplate.add(match[1]);
  }
  // Every key is reachable: asked for by t('key'), named in a data-t attribute, or listed as a
  // quoted key in one of app.js's lookup tables (TYPE_LABELS, STATUS_LABELS, LIVE_LABELS…).
  const quoted = new Set([...app.matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]));
  const unused = keys.filter((key) => !used.has(key) && !inTemplate.has(key) && !quoted.has(key));
  assert.deepEqual(unused, [], 'strings.js has keys nothing uses');
});

test('the template is a body fragment that app.js can fill', () => {
  const template = readTemplate();
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(template.trimStart().startsWith('<!--'), 'starts with the fragment comment');
  for (const forbidden of [/<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i, /<!doctype/i, /<script[\s>]/i, /<style[\s>]/i, /<link[\s>]/i, /<iframe[\s>]/i]) {
    assert.ok(!forbidden.test(template), 'template must not contain ' + forbidden);
  }
  // Every element app.js looks up by id, and every template it clones, is in the markup (app.js
  // throws "the page is missing #…" otherwise), and ids are unique.
  const ids = [...template.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique: ' + ids.filter((id, i) => ids.indexOf(id) !== i).join(', '));
  const looked = [...app.matchAll(/byId\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(looked.length > 60, 'app.js looks its elements up by id');
  for (const id of looked) assert.ok(ids.includes(id), 'template has #' + id + ' (app.js byId)');
  for (const id of [...app.matchAll(/cloneTemplate\('([^']+)'\)/g)].map((m) => m[1])) {
    assert.ok(template.includes('<template id="' + id + '">'), 'template has <template id="' + id + '"> (app.js cloneTemplate)');
  }
  // Version 3 landmarks: the three header bars, the Menu panel, the views and the Settings dialog.
  for (const id of ['site-header', 'topbar', 'brand-link', 'search-toggle', 'search-form', 'search-input', 'loc-button', 'loc-menu', 'type-button', 'type-glyph', 'type-label', 'avatar-button', 'avatar-menu', 'lang-button', 'lang-list', 'theme-toggle', 'settings-button', 'tabsbar', 'tabs-track', 'menu-button', 'subbar', 'sections-row', 'menu-panel', 'panel-categories', 'panel-more', 'main', 'feed-panel', 'feed-list', 'empty-state', 'feed-end', 'manage-section', 'sources-section', 'about-section', 'toast-region', 'profile-panel', 'theme-light', 'theme-dark', 'theme-system', 'subcat-top', 'subcat-bottom']) {
    assert.ok(ids.includes(id), 'template has #' + id);
  }
  // Every in-template class app.js reaches with find(…, '.x') exists in the markup.
  for (const cls of new Set([...app.matchAll(/find\([a-zA-Z]+, '\.([a-z0-9-]+)'\)/g)].map((m) => m[1]))) {
    assert.ok(new RegExp(`class="(?:[^"]* )?${cls}(?: [^"]*)?"`).test(template), 'template has an element with class .' + cls);
  }
  // The popups are disclosures (they hold paragraphs, a nested list and links, which an ARIA menu
  // cannot): the triggers say expanded/collapsed and which element they control, and claim no menu.
  assert.ok(/id="avatar-button"[^>]*aria-expanded="false"[^>]*aria-controls="avatar-menu"/.test(template), 'the avatar button controls its menu');
  assert.ok(/id="loc-button"[^>]*aria-expanded="false"[^>]*aria-controls="loc-menu"/.test(template), 'the location button controls its menu');
  assert.ok(!template.includes('aria-haspopup'), 'no trigger announces a menu that has no menu role or arrow keys');
  assert.ok(!/role="menu(?:item)?"/.test(template), 'and no menu roles');
  assert.ok(/id="menu-button"[^>]*aria-expanded="false"[^>]*aria-controls="menu-panel"/.test(template), 'the ≡ button controls the Menu panel');
  assert.ok(/id="menu-panel" role="dialog" aria-modal="true" aria-labelledby="menu-panel-heading" hidden/.test(template), 'the Menu panel is a labelled modal, hidden at first');
  assert.ok(/<dialog id="profile-panel"[^>]*aria-labelledby="profile-heading"/.test(template), 'Settings is a labelled <dialog>');
  assert.ok(template.includes('data-t="signInLater"'), 'the avatar menu keeps the spot for sign-in');
  // Icons are inline SVG; the only images are the toggle glyph (data URIs) and the item pictures app.js fills.
  assert.ok(!template.includes('<use '), 'no SVG sprite references');
  assert.deepEqual([...template.matchAll(/<img\b[^>]*>/g)].map((m) => (/class="([^"]+)"/.exec(m[0]) || [])[1]), ['type-glyph', 'item-img'], 'two <img> elements: the toggle glyph and the article picture');
  assert.ok(!/\s(?:src|href)="(?:https?:)?\/\//.test(template), 'the template loads nothing and links nowhere outside the page');
  // In-page view links, the disabled heart, live regions, the removal address.
  for (const href of ['#saved', '#following', '#live', '#sources', '#about']) assert.ok(template.includes('href="' + href + '"'), 'a link opens ' + href);
  assert.ok(/class="action action-like" aria-disabled="true" title="Coming later"/.test(template), 'the heart is rendered disabled until accounts exist');
  assert.ok(/id="toast-region" aria-live="polite"/.test(template), 'toasts are announced politely');
  assert.ok(template.includes('removal@curanet.io'));
  assert.ok(!template.includes('mailto:'), 'the removal address is text, not a mailto link');
  assert.ok(/<ol id="feed-list"[^>]*role="list"/.test(template), 'the feed list keeps its list role when list-style is none');
  // Titles clamp an inner span, so the link's focus outline is never clipped; the article's whole
  // text block (publisher, title, picture) is one link, the video's title is its own link.
  assert.ok(/<a class="item-link" target="_blank" rel="noopener" aria-describedby="new-tab-hint">\s*<div class="item-row">[\s\S]*?<span class="publisher-name"><\/span>[\s\S]*?<span class="item-title-text"><\/span>[\s\S]*?<div class="item-thumb">[\s\S]*?<\/a>/.test(template), 'the article link wraps publisher, title and picture');
  assert.ok(/<h2 class="item-title"><a class="item-link" target="_blank" rel="noopener" aria-describedby="new-tab-hint"><span class="item-title-text"><\/span><\/a><\/h2>/.test(template), 'the video title link wraps the clamped span');
  for (const id of ['tpl-article', 'tpl-video']) {
    const tpl = (new RegExp(`<template id="${id}">([\\s\\S]*?)</template>`).exec(template) || [])[1] || '';
    assert.ok(/<div class="item-text">[\s\S]*?publisher-name[\s\S]*?item-title-text[\s\S]*?<\/h2>\s*<\/div>/.test(tpl), id + ': .item-text wraps exactly the publisher and the title');
    const text = (/<div class="item-text">([\s\S]*?<\/h2>)\s*<\/div>/.exec(tpl) || [])[1] || '';
    assert.ok(!/item-time|actions/.test(text), id + ': the time and the buttons stay outside .item-text (they are interface text)');
  }
  // The share menu: Copy Link plus the five services, as links that open a new tab; app.js sets
  // their addresses.
  const share = (/<template id="tpl-share-menu">([\s\S]*?)<\/template>/.exec(template) || [])[1] || '';
  assert.ok(share.includes('class="menu-item share-copy"'), 'Copy Link');
  for (const service of ['facebook', 'twitter', 'linkedin', 'whatsapp', 'telegram']) {
    assert.ok(new RegExp(`<a class="menu-item share-${service}" target="_blank" rel="noopener" aria-describedby="new-tab-hint">`).test(share), service + ' is a new-tab link');
  }
  assert.ok(!/\shref=/.test(share), 'the share addresses are not hard-coded in the template');
});

test('the article/video toggle carries the three live PNG glyphs as data URIs, the only images in the template', () => {
  const template = readTemplate();
  const glyphs = toggleGlyphs(template);
  for (const key of ['both', 'videos', 'articles']) {
    assert.match(glyphs[key], /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, key + ' is a PNG data URI');
    const png = Buffer.from(glyphs[key].slice(glyphs[key].indexOf(',') + 1), 'base64');
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], key + ' decodes to a PNG');
    assert.equal(png.toString('latin1', 12, 16), 'IHDR');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [30, 30], key + ' is the live 30×30 glyph');
    assert.ok(png.length < 1024, key + ' stays small');
  }
  assert.equal(new Set([glyphs.both, glyphs.videos, glyphs.articles]).size, 3, 'three different glyphs');
  assert.equal(glyphs.src, glyphs.both, 'the first paint shows "Articles and videos"');
  assert.equal(glyphs.alt, '', 'the glyph is decorative; the button is named by #type-label');
  assert.ok(/<button type="button" id="type-button"[^>]*data-type="both">\s*<img id="type-glyph"[^>]*>\s*<span class="visually-hidden" id="type-label" aria-live="polite" data-t="showingBoth">/.test(template), 'the button holds the glyph and its spoken label');
  assert.equal(template.split(glyphs.tag).join('').indexOf('data:'), -1, 'nothing else in the template is embedded');
  // app.js swaps the src from data-src-<value> for every value of the cycle.
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(app.includes("typeGlyph.getAttribute('data-src-' + state.type)"), 'app.js picks the glyph of the current setting');
  for (const value of loadHelpers().TYPE_CYCLE) assert.ok(glyphs[value], 'a glyph exists for ' + value);
});

/*
 * The in-page links (logo, "Back to the feed", the avatar menu's Saved / Following / Live and
 * footer links, the Menu panel's MORE cells) are driven by click handlers in app.js rather than by
 * the #hash, because a fragment navigation is swallowed by popstate on the hosted site and is a
 * no-op in the preview once the hash already matches. This checks that the template exposes the
 * hooks and that app.js binds them. Manual check (both outputs, 390 and 1280 px): the avatar
 * menu's rows and the Menu panel's cells each open their view on one click; "Back to the feed"
 * returns to the feed; from a category the logo returns Home; Live opens on All from a category;
 * the hosted address becomes ?view=… with no #hash left behind.
 */
test('the in-page links have the hooks app.js binds click handlers to', () => {
  const template = readTemplate();
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/<a class="logo" href="#feed" id="brand-link"[^>]*>/.test(template), 'the logo is #brand-link');
  assert.equal((template.match(/<p class="back-row"><a class="back-link" href="#feed" data-t="backToFeed">/g) || []).length, 2, 'Sources and About each end with a back link under the card');
  for (const [id, href] of [['menu-saved', '#saved'], ['menu-following', '#following'], ['menu-live', '#live']]) {
    assert.ok(template.includes(`<a class="menu-item" id="${id}" href="${href}">`), 'the avatar menu links to ' + href);
  }
  assert.deepEqual([...template.matchAll(/class="menu-foot-link" href="(#[a-z]+)"/g)].map((m) => m[1]), ['#sources', '#about'], 'the avatar menu footer links Sources and About');
  const more = (/<div class="cell-grid" id="panel-more">([\s\S]*?)<\/div>/.exec(template) || [])[1] || '';
  assert.deepEqual([...more.matchAll(/<a class="cell" href="(#[a-z]+)"/g)].map((m) => m[1]), ['#saved', '#following', '#live', '#sources', '#about'], 'the Menu panel\'s MORE cells');
  assert.ok(app.includes("byId('brand-link')") && /brandLink\.addEventListener\('click'/.test(app), 'app.js binds the logo');
  assert.ok(/querySelectorAll\('\.back-link'\)/.test(app), 'app.js binds the back links');
  assert.ok(/function bindInPageLinks\(root\) \{\s*var links = root\.querySelectorAll\('a\[href\^="#"\]'\);/.test(app), 'bindInPageLinks binds every #link under a root');
  assert.ok(app.includes('bindInPageLinks(avatarMenu);') && app.includes('bindInPageLinks(panelMore);'), 'app.js binds the avatar menu and the Menu panel links');
  assert.ok(/function onMenuLinkClick\(event, link\) \{[\s\S]*?event\.preventDefault\(\);/.test(app), 'the click opens the view instead of following the #hash');
  assert.ok(/function onPopState\(\) \{\s*if \(viewFromHash\(\)\) \{\s*onHashChange\(\);\s*return;/.test(app), 'popstate hands a #hash to the hash handler');
  assert.ok(/if \(next === 'live' && view !== 'live'\) state\.s = '';/.test(app), 'entering Live resets the section to All');
});

/**
 * The three token blocks of styles.css: bare :root (light), the dark block used when following a
 * dark system, and the dark block used when Dark is chosen.
 */
function themeBlocks() {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  return {
    css,
    light: (/^:root\s*\{([\s\S]*?)\n\}/m.exec(css) || [])[1] || '',
    systemDark: (/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\n {2}\}\n\}/.exec(css) || [])[1] || '',
    dark: (/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/m.exec(css) || [])[1] || '',
  };
}

/** @returns {Record<string, string>} custom property → value, from one token block */
function tokensOf(block) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

test('styles.css declares the theme tokens in the artifact shape and uses the system font stack', () => {
  const { css, light, systemDark, dark } = themeBlocks();
  assert.ok(light && systemDark && dark, 'the three token blocks are present');
  assert.ok(/color-scheme: light/.test(light) && /color-scheme: dark/.test(systemDark) && /color-scheme: dark/.test(dark));
  const lightTokens = tokensOf(light);
  const darkTokens = tokensOf(dark);
  assert.deepEqual(tokensOf(systemDark), darkTokens, 'following a dark system and choosing Dark give the same palette');
  const colourNames = Object.keys(lightTokens).filter((name) => /^(#|rgba?\()/.test(lightTokens[name]));
  for (const name of colourNames) assert.ok(name in darkTokens, name + ' has a dark value');
  for (const name of Object.keys(darkTokens)) assert.ok(name in lightTokens, name + ' (dark) has a light value');
  assert.ok(/body\s*\{[^}]*background: var\(--page\)/.test(css), 'body background from a token');
  // Version 3 palette (docs/LAYOUT.md).
  for (const [name, value] of [['--bar', '#305dd2'], ['--page', '#f9fafb'], ['--card', '#ffffff'], ['--text', '#101828'], ['--publisher', '#364153'], ['--muted', '#6a7282'], ['--card-border', '#e5e7eb'], ['--divider', '#f3f4f6'], ['--control-hover', '#a7c4ff'], ['--avatar-bg', '#e5e7eb']]) {
    assert.equal(lightTokens[name], value, 'light ' + name);
  }
  for (const [name, value] of [['--bar', '#214fcc'], ['--page', '#030712'], ['--card', '#101828'], ['--text', '#f9fafb'], ['--publisher', '#f3f4f6'], ['--primary', '#6393ff'], ['--primary-line', '#4677ed'], ['--menu-bg', '#171717'], ['--toast-bg', '#0a0a0a'], ['--avatar-bg', '#364153']]) {
    assert.equal(darkTokens[name], value, 'dark ' + name);
  }
  // The system font stack, nothing loaded.
  assert.equal(lightTokens['--font'], 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"');
  assert.ok(/body\s*\{[^}]*font-family: var\(--font\);[^}]*-webkit-font-smoothing: antialiased;/.test(css), 'body uses the stack, antialiased');
  assert.ok(!/@font-face|@import|url\(/i.test(css), 'no font face, import or external resource');
  assert.ok(!/Geist|Roboto|Bricolage|Source Sans/.test(css), 'no web font family is named');
  // Breakpoints, the main container, motion, focus, safe areas.
  for (const query of ['(min-width: 640px)', '(min-width: 768px)', '(max-width: 639px)', '(prefers-reduced-motion: reduce)']) assert.ok(css.includes(query), query);
  assert.ok(/\.main-container \{ max-width: 896px; padding: 16px 0; \}/.test(css), 'the main container is at most 896px, no side padding on phones');
  assert.ok(/@media \(min-width: 640px\) \{\s*\.main-container \{ padding: 16px; \}/.test(css), 'and 16px on every side from 640px (card 864px wide at 1280)');
  assert.ok(/\.container \{[^}]*max-width: 928px;[^}]*padding: 0 16px;/.test(css), 'the bars share an 896px container inside 16px gutters');
  assert.ok(css.includes(':focus-visible'));
  assert.ok(/\.menu-item:hover \.menu-hint, \.menu-item:focus-visible \.menu-hint \{ color: inherit; \}/.test(css), 'the Language hint takes the hovered row\'s ink');
  assert.ok(css.includes('env(safe-area-inset-bottom, 0px)'), 'the docked grey row clears the home indicator');
  assert.ok(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none !important;[^}]*transition: none !important;[\s\S]*?\.site-header\.is-hidden \{ top: 0; \}/.test(css), 'reduced motion stops animations and keeps the header in place');
});

test('app.js fills the template strings before it writes state-dependent texts', () => {
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const init = (/function init\(\) \{([\s\S]*?)\n {2}\}\n/.exec(app) || [])[1] || '';
  const stringsAt = init.indexOf('applyStrings(document);');
  assert.ok(stringsAt >= 0, 'init applies the strings');
  // applyTheme writes "Light Mode" into the theme row on a dark page; applying the strings
  // afterwards would put the "Dark Mode" fallback back.
  for (const call of ['applyTheme();', 'syncControls();', 'buildLocMenu();', 'buildLangList();', 'showView(view, false);']) {
    const at = init.indexOf(call);
    assert.ok(at > stringsAt, call + ' runs after applyStrings(document)');
  }
  assert.ok(/function syncThemeToggle\(\) \{[\s\S]*?themeToggleLabel\.textContent = t\(dark \? 'lightMode' : 'darkMode'\);/.test(app), 'the theme row names the theme it switches to');
});

test('a menu that opens focuses its current choice only when that row is visible', () => {
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const open = (/open: function \(\) \{([\s\S]*?)\n {6}\},/.exec(app) || [])[1] || '';
  assert.ok(open, 'createMenu has an open()');
  // The avatar menu's current language is in the collapsed Language list; querying the whole
  // menu for [aria-current] would pick that hidden row and focus would never enter the menu.
  assert.ok(!open.includes("menu.querySelector('[aria-current=\"true\"]')"), 'no lookup of hidden rows');
  assert.ok(/var items = focusableIn\(menu\);\s*var current = items\.filter\(/.test(open), 'the current row is picked among the focusable, visible rows');
  assert.ok(/focusOn\(current \|\| items\[0\] \|\| menu, true\);/.test(open), 'else the first row');
});

test('every state class app.js toggles is styled', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const toggled = new Set([...app.matchAll(/classList\.(?:add|remove|toggle)\('([a-z0-9-]+)'/g)].map((m) => m[1]));
  assert.ok(toggled.size >= 8, 'app.js toggles state classes');
  for (const cls of toggled) assert.ok(new RegExp(`\\.${cls}\\b`).test(css), 'styles.css styles .' + cls);
});

// ------------------------------------------------------------------ the pure helpers in app.js

/**
 * app.js keeps its DOM-free helpers between two marker comments; this evaluates only that block
 * so the rules can be tested without a browser.
 */
function loadHelpers() {
  const source = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const start = source.indexOf('/* == pure helpers begin ==');
  const end = source.indexOf('/* == pure helpers end == */');
  assert.ok(start >= 0 && end > start, 'app.js has the pure helpers block');
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  assert.ok(context.CURANET_HELPERS, 'the block defines CURANET_HELPERS');
  return context.CURANET_HELPERS;
}

test('cycleTypeValue runs both → videos → articles → both, as on the live site', () => {
  const { cycleTypeValue, TYPE_CYCLE } = loadHelpers();
  assert.deepEqual([...TYPE_CYCLE], ['both', 'videos', 'articles']);
  assert.equal(cycleTypeValue('both'), 'videos');
  assert.equal(cycleTypeValue('videos'), 'articles');
  assert.equal(cycleTypeValue('articles'), 'both');
  assert.equal(cycleTypeValue('nonsense'), 'both', 'an unknown value restarts the cycle');
  let value = 'both';
  for (let i = 0; i < 3; i += 1) value = cycleTypeValue(value);
  assert.equal(value, 'both', 'three clicks come back to the start');
});

test('formatRelativeOrDate is relative for 7 days, singular at 1, then an absolute date', () => {
  const helpers = loadHelpers();
  // Objects made inside the vm have their own Object prototype; copy them before deepEqual.
  const formatRelativeOrDate = (iso, now) => Object.assign({}, helpers.formatRelativeOrDate(iso, now));
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  const at = (ms) => new Date(now - ms).toISOString();
  assert.deepEqual(formatRelativeOrDate(at(10 * 1000), now), { kind: 'now' });
  assert.deepEqual(formatRelativeOrDate(at(44 * 1000), now), { kind: 'now' });
  assert.deepEqual(formatRelativeOrDate(at(45 * 1000), now), { kind: 'relative', unit: 'minute', n: 1 }, 'never "0 minutes ago"');
  assert.deepEqual(formatRelativeOrDate(at(5 * 60 * 1000), now), { kind: 'relative', unit: 'minute', n: 5 });
  assert.deepEqual(formatRelativeOrDate(at(60 * 60 * 1000), now), { kind: 'relative', unit: 'hour', n: 1 });
  assert.deepEqual(formatRelativeOrDate(at(23.9 * 60 * 60 * 1000), now), { kind: 'relative', unit: 'hour', n: 23 });
  assert.deepEqual(formatRelativeOrDate(at(24 * 60 * 60 * 1000), now), { kind: 'relative', unit: 'day', n: 1 });
  assert.deepEqual(formatRelativeOrDate(at(2 * 86400 * 1000), now), { kind: 'relative', unit: 'day', n: 2 });
  assert.deepEqual(formatRelativeOrDate(at(7 * 86400 * 1000 - 1), now), { kind: 'relative', unit: 'day', n: 6 });
  const old = formatRelativeOrDate(at(7 * 86400 * 1000), now);
  assert.equal(old.kind, 'date');
  assert.equal(old.date.toISOString(), '2026-09-29T12:00:00.000Z');
  assert.equal(formatRelativeOrDate(at(400 * 86400 * 1000), now).kind, 'date');
  assert.deepEqual(formatRelativeOrDate('not a date', now), { kind: 'invalid' });
  assert.deepEqual(formatRelativeOrDate(at(-60 * 1000), now), { kind: 'now' }, 'a date slightly in the future reads as just now');
});

test('shareLinks gives the five public share addresses with the original link and title, encoded', () => {
  const { shareLinks } = loadHelpers();
  const url = 'https://gazette.example/news/harbour reopens?from=rss&id=7#top';
  const title = 'Harbour & "pilings": 100% fixed? Ça va + <b>';
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = Object.assign({}, shareLinks(url, title));
  assert.deepEqual(links, {
    facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
    twitter: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t,
    linkedin: 'https://www.linkedin.com/shareArticle?mini=true&url=' + u + '&title=' + t,
    whatsapp: 'https://wa.me/?text=' + t + '%20' + u,
    telegram: 'https://t.me/share/url?url=' + u + '&text=' + t,
  });
  const hosts = { facebook: 'www.facebook.com', twitter: 'twitter.com', linkedin: 'www.linkedin.com', whatsapp: 'wa.me', telegram: 't.me' };
  for (const [service, address] of Object.entries(links)) {
    const parsed = new URL(address);
    assert.equal(parsed.protocol, 'https:', service + ' is https');
    assert.equal(parsed.hostname, hosts[service], service + ' goes to the service itself');
    assert.equal(parsed.hash, '', service + ': the original link\'s #fragment stays inside the parameter');
    assert.ok(!/[\s"<>]/.test(address), service + ': nothing unencoded');
  }
  // Decoding the parameters gives back exactly the original link and title.
  const param = (address, name) => new URL(address).searchParams.get(name);
  assert.equal(param(links.facebook, 'u'), url);
  assert.equal(param(links.twitter, 'url'), url);
  assert.equal(param(links.twitter, 'text'), title);
  assert.equal(param(links.linkedin, 'url'), url);
  assert.equal(param(links.linkedin, 'title'), title);
  assert.equal(param(links.linkedin, 'mini'), 'true');
  assert.equal(param(links.whatsapp, 'text'), title + ' ' + url);
  assert.equal(param(links.telegram, 'url'), url);
  assert.equal(param(links.telegram, 'text'), title);
  // An item without a title still gives working addresses.
  const bare = shareLinks('https://a.example/x', '');
  assert.equal(new URL(bare.twitter).searchParams.get('url'), 'https://a.example/x');
  assert.equal(new URL(bare.whatsapp).searchParams.get('text'), ' https://a.example/x');
  // app.js shares the item's original address (the article, or the video's YouTube page), never a Curanet page.
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/function shareUrl\(item\) \{\s*return item\.ty === 'v' \? watchUrl\(item\) : item\.l;\s*\}/.test(app), 'shareUrl is the original link');
  assert.ok(/var url = shareUrl\(item\);[\s\S]{0,80}var links = H\.shareLinks\(url, item\.t\);/.test(app), 'the share menu is built from the original link and title');
  assert.ok(/copyText\(url, /.test(app), 'Copy Link copies the same original link');
  assert.ok(!/curanet\.io\/content/.test(app), 'no Curanet detail page address');
});

test('fold lower-cases and strips accents for search', () => {
  const { fold } = loadHelpers();
  assert.equal(fold('Éléphant À Paris'), 'elephant a paris');
  assert.equal(fold(''), '');
  assert.equal(fold(null), '');
});

/*
 * WCAG AA for the version 3 palette, in light and in dark: 4.5:1 for text, 3:1 for icons, the
 * focus ring and other non-text parts (1.4.3, 1.4.11). Translucent tokens (the dark outline
 * buttons, the hover tints) are composited over the surface they sit on before measuring.
 */
test('the version 3 palette meets WCAG AA in light and dark', () => {
  const { light, dark } = themeBlocks();
  /** @returns {{r: number, g: number, b: number, a: number}|null} */
  const parse = (value) => {
    if (typeof value !== 'string') return null;
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
    m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const luminance = ({ r, g, b }) => {
    const [lr, lg, lb] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  const ratio = (a, b) => { const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

  // [foreground, background, minimum, what it is, surface under a translucent background, foreground opacity]
  /** @type {Array<[string, string, number, string, (string|undefined)?, number?]>} */
  const pairs = [
    // The card and the feed.
    ['--text', '--card', 4.5, 'item title on the card'],
    ['--publisher', '--card', 4.5, 'publisher name on the card'],
    ['--muted', '--card', 4.5, 'time, "You\'ve reached the end", empty text on the card'],
    ['--muted', '--page', 4.5, 'hints on the page background'],
    ['--primary', '--card', 4.5, 'title hover, text buttons and links on the card'],
    // The header bars.
    ['--on-bar', '--bar', 4.5, 'white wordmark, labels and icons on the bar blue'],
    ['--control-hover-ink', '--control-hover', 4.5, 'icon and label of a hovered control on the blue bar'],
    ['--primary', '--card', 4.5, 'active tab text on the tabs bar'],
    ['--tab-ink', '--card', 4.5, 'inactive tab text and the ≡ glyph on the tabs bar'],
    ['--primary-line', '--card', 3, 'active tab underline on the tabs bar'],
    ['--text-2', '--row-bg', 4.5, 'inactive link on the grey row'],
    ['--primary', '--row-bg', 4.5, 'active and hovered link on the grey row'],
    ['--primary-line', '--row-bg', 3, 'active link underline on the grey row'],
    ['--avatar-ink', '--avatar-bg', 3, 'avatar glyph on its circle (the glyph identifies the button)'],
    // The action row.
    ['--action-ink', '--outline-bg', 4.5, 'Save / Share / heart ink on the outline button', '--card'],
    ['--save-hover', '--save-hover-bg', 4.5, 'hovered Save', '--card'],
    ['--share-hover', '--share-hover-bg', 4.5, 'hovered Share', '--card'],
    // Menus (location, avatar, share), the Settings dialog and the toasts.
    ['--menu-ink', '--menu-bg', 4.5, 'menu text on the menu'],
    ['--menu-hover-ink', '--menu-hover', 4.5, 'hovered menu row'],
    ['--menu-icon', '--menu-bg', 3, 'menu icon and check on the menu'],
    ['--menu-icon', '--menu-hover', 3, 'menu icon on a hovered row'],
    ['--menu-hint', '--menu-bg', 4.5, 'the Language hint ("All") on the menu'],
    ['--menu-title', '--menu-bg', 4.5, 'avatar menu heading'],
    ['--label', '--menu-bg', 4.5, 'avatar menu subtitle'],
    ['--muted', '--menu-bg', 4.5, 'avatar menu footer and dialog hints'],
    ['--primary', '--menu-bg', 4.5, 'avatar menu footer links'],
    ['--text', '--menu-bg', 4.5, 'Settings heading and legends'],
    ['--menu-ink', '--toast-bg', 4.5, 'toast title'],
    ['--menu-ink', '--toast-bg', 4.5, 'toast description at 90 % opacity', undefined, 0.9],
    ['--menu-ink', '--input-bg', 4.5, 'typed search words'],
    ['--placeholder', '--input-bg', 4.5, 'search placeholder'],
    ['--muted', '--input-bg', 3, 'magnifier inside the search field'],
    // The Menu panel and the pages.
    ['--cell-ink', '--fill', 4.5, 'Menu panel cell label'],
    ['--on-bar', '--bar', 4.5, 'hovered Menu panel cell and the primary button'],
    ['--on-bar', '--primary-hover', 4.5, 'hovered primary button'],
    ['--label', '--panel-bg', 4.5, 'Menu panel group headings'],
    ['--badge-ink', '--badge-bg', 4.5, 'Manage Following count badge'],
    ['--text-2', '--fill', 4.5, 'unpressed All / Following pill'],
    ['--primary', '--fill', 4.5, 'removal address on its chip'],
    ['--check-border', '--check-bg', 3, 'unchecked checkbox border'],
    ['--primary-line', '--card', 3, 'checked checkbox on the card'],
    ['--bar', '--on-bar', 4.5, 'skip link'],
    // Focus (3:1): the ring on the card, the page, the grey row and menus; white on the blue bars.
    ['--focus', '--card', 3, 'focus ring against the card and the tabs bar'],
    ['--focus', '--page', 3, 'focus ring against the page'],
    ['--focus', '--row-bg', 3, 'focus ring against the grey row'],
    ['--focus', '--menu-bg', 3, 'focus ring inside a menu or the dialog'],
    ['--focus', '--fill', 3, 'focus ring on a Menu panel cell'],
    ['--on-bar', '--bar', 3, 'focus outline (white) on the blue bars'],
  ];
  for (const [theme, block] of [['light', light], ['dark', dark]]) {
    const tokens = tokensOf(block);
    const colour = (name) => {
      const value = parse(tokens[name]);
      assert.ok(value, `${theme}: ${name} is a colour token (${tokens[name]})`);
      return value;
    };
    for (const [fg, bg, min, what, base, alpha] of pairs) {
      let back = colour(bg);
      if (back.a < 1) back = over(back, colour(base || '--card'));
      let fore = colour(fg);
      if (alpha !== undefined) fore = { ...fore, a: fore.a * alpha };
      if (fore.a < 1) fore = over(fore, back);
      const value = ratio(fore, back);
      assert.ok(value >= min, `${theme}: ${what} (${fg} on ${bg}) is ${value.toFixed(2)}:1, below ${min}:1`);
    }
  }
});

test('index.html only uses string keys for the texts that app.js fills from the template', () => {
  const template = readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8');
  const bodyOnly = template.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // Every visible word in the template sits inside an element with data-t (or is a fallback for one).
  const untranslated = [];
  for (const match of bodyOnly.matchAll(/<([a-z0-9]+)([^>]*)>([^<]+)<\/\1>/g)) {
    const text = match[3].trim();
    if (!text) continue;
    if (/data-t=/.test(match[2])) continue;
    if (/^(Following \(0\))$/.test(text)) continue; // replaced by app.js before it can be seen
    untranslated.push(text);
  }
  assert.deepEqual(untranslated, [], 'hard-coded text in index.html');
});

// ------------------------------------------------------------------ review fixes (version 3)

test('the build keeps every address that becomes an href or src to http(s), whatever the data says', async () => {
  const dataDir = tempDir();
  writeFileSync(path.join(dataDir, 'categories.json'), readFileSync(path.join(FIXTURE_DIR, 'categories.json')));
  const sources = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'sources.json'), 'utf8'));
  const gazette = sources.sources.find((s) => s.id === 'gazette');
  gazette.siteUrl = 'javascript:alert(document.domain)';
  writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify({ version: 1, sources: [gazette] }));
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(dataDir, 'items'));
  const base = { guid: 'x', title: 'T', excerpt: 'E', published: '2026-10-05T09:00:00.000Z', type: 'article', addedAt: '2026-10-05T09:00:00.000Z' };
  writeFileSync(path.join(dataDir, 'items', 'gazette.json'), JSON.stringify({ version: 1, sourceId: 'gazette', items: [
    { ...base, id: 'a000000000000001', link: 'javascript:alert(1)', thumbnail: null },
    { ...base, id: 'a000000000000002', link: 'https://gazette.example/ok', thumbnail: 'javascript:void 0' },
    { ...base, id: 'a000000000000003', link: 'https://gazette.example/video', thumbnail: 'data:image/svg+xml,<svg/>', type: 'video', videoId: 'bad id"><x' },
  ] }));
  const data = assembleFeedData(dataDir, { now: NOW });
  assert.deepEqual(data.items.map((i) => i.id), ['a000000000000002', 'a000000000000003'], 'the javascript: link never reaches the page');
  assert.equal(data.items[0].th, null, 'a javascript: thumbnail is dropped');
  assert.equal(data.items[1].th, null, 'only http(s) thumbnails come from the data (the preview embeds its own)');
  assert.ok(!('v' in data.items[1]), 'a malformed video id is dropped, so the watch link falls back to the checked link');
  assert.equal(data.sources[0].siteUrl, null, 'a javascript: siteUrl is dropped');
  assert.equal(data.sources[0].url, 'https://gazette.example/feed.xml');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/var ITEMS = DATA\.items\.filter\(function \(item\) \{ return item && SOURCES\[item\.s\] && isHttpAddress\(item\.l\); \}\);/.test(app), 'app.js checks again before an item link becomes an href');
  assert.ok(/isHttpAddress\(source\.siteUrl\) \? source\.siteUrl : isHttpAddress\(source\.url\)/.test(app), 'and before a source address does');
});

test('the blue bar fits at 360px whatever the country name, in English and French', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  // The bar is logo 40 + search 36 + location + toggle 32 + avatar 40 with 16px gaps in 328px:
  // "United Kingdom" (136px) pushed the avatar 20px off a 360px screen. The middle spacer gives up
  // its room first, then the label shrinks and is cut with an ellipsis, in any language, with no
  // fixed cap that would cut names that fit.
  assert.ok(/\.topbar-middle \{ flex: 1 1 auto; min-width: 0; \}/.test(css), 'the empty middle shrinks first');
  assert.ok(/\.loc-picker \{ position: relative; flex: 0 1 auto; min-width: 0; \}/.test(css), 'the picker may shrink');
  assert.ok(/\.loc-button \{\s*max-width: 100%;\s*flex-shrink: 1;/.test(css), 'and its button with it');
  assert.ok(/\.loc-button \.icon \{ flex: none;/.test(css), 'the globe keeps its 16px');
  assert.ok(/\.loc-label \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/.test(css), 'the label is cut with an ellipsis');
  assert.ok(!/\.loc-label \{[^}]*max-width:\s*\d+px/.test(css), 'no fixed width cap');
  assert.ok(/locLabel\.textContent = label;\s*\/\/[^\n]*\n\s*locButton\.title = label;/.test(app), 'the full name stays readable as the button\'s tooltip');
  // Manual check (Playwright, both outputs): at 360x800 with every country of the data (GB and US
  // included) and uiLang en and fr, scrollWidth equals clientWidth and the avatar ends at x <= 344.
});

test('video items and a leading video match the live card', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/\.item-body \{ padding: 0 16px 16px; \}/.test(css) && /\.item-body \{ padding: 0 24px 16px; \}/.test(css), 'the text block under the player has the live 16px bottom padding (pb-4)');
  assert.ok(!/\.feed-card \.item:first-child \.video-box/.test(css), 'no player rounds its corners 16px below the card edge');
  assert.ok(/\.feed-card\.is-category \.item-video:first-child \{ padding-top: 0; \}/.test(css), 'on a category page a leading video sits flush with the card top');
  assert.ok(/\.feed-card\.is-category \.item-video:first-child \.video-box \{ border-radius: calc\(var\(--radius-lg\) - 1px\) calc\(var\(--radius-lg\) - 1px\) 0 0; \}/.test(css), 'and takes the card\'s inner corners');
  assert.ok(/feedPanel\.classList\.toggle\('is-category', view === 'feed' && Boolean\(state\.c\)\);/.test(app), 'only while a category is open');
});

test('the build never shows a date in the future: such items count from when they were added', () => {
  const nowMs = Date.parse('2026-10-07T18:00:00.000Z');
  /** @type {import('../src/lib/types.js').Item} */
  const base = { id: 'a000000000000001', guid: null, link: 'https://news.example/a', title: 'T', excerpt: '', thumbnail: null, type: 'article', published: '2026-10-07T17:00:00.000Z', addedAt: '2026-10-07T17:30:27.000Z' };
  assert.equal(compactItem({ ...base, published: '2026-10-07T21:27:51.000Z' }, 'ctv', nowMs).p, '2026-10-07T17:30:27.000Z', 'four hours ahead: the time it was added');
  assert.equal(compactItem({ ...base, published: '2026-10-07T18:05:00.000Z' }, 'ctv', nowMs).p, '2026-10-07T18:05:00.000Z', 'within the clock tolerance: kept');
  assert.equal(compactItem({ ...base, published: '2026-10-07T17:00:00.000Z' }, 'ctv', nowMs).p, '2026-10-07T17:00:00.000Z');
  assert.equal(compactItem({ ...base, published: '2026-10-08T00:00:00.000Z', addedAt: '2026-10-08T00:00:00.000Z' }, 'ctv', nowMs).p, '2026-10-07T18:00:00.000Z', 'both in the future: the build time');
});

test('videos play in place on the hosted site: picture and headline, inline on phones, one at a time', () => {
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  assert.ok(app.includes("'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.v) + '?autoplay=1&playsinline=1&rel=0'"), 'the privacy-enhanced player starts playing, inline on phones');
  const render = app.slice(app.indexOf('function renderVideo'), app.indexOf('function renderItem'));
  const embedBranch = render.slice(render.indexOf("if (CONFIG.video === 'embed' && item.v) {"), render.indexOf('} else {'));
  assert.ok(embedBranch.includes('mountPlayButton(box, item);'), 'the picture is a play button');
  assert.ok(embedBranch.includes("link.removeAttribute('target');") && embedBranch.includes("link.removeAttribute('aria-describedby');"), 'the headline no longer opens a new tab');
  assert.ok(/event\.preventDefault\(\);\s*embedPlayer\(box, item\);/.test(embedBranch), 'pressing the headline plays the video in place');
  assert.ok(embedBranch.includes("link.setAttribute('role', 'button');") && embedBranch.includes("event.key !== ' '"), 'it is announced and operated as a button (Space too)');
  assert.ok(/if \(event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;/.test(embedBranch), 'a deliberate middle- or modifier-click still reaches YouTube');
  const embed = app.slice(app.indexOf('function embedPlayer'), app.indexOf('function renderVideo'));
  assert.ok(/stopPlaying\(\);\s*var frame = document\.createElement\('iframe'\);/.test(embed), 'starting a video stops the one already playing');
  assert.ok(/function stopPlaying\(\) \{[\s\S]*?mountPlayButton\(current\.box, current\.item\);/.test(app), 'which goes back to its picture and play button');
  assert.ok(/\.video-box, \.video-preview,[^{]*\{ scroll-margin-top: calc\(var\(--header-h, 143px\) \+ 8px\); \}/.test(css), 'a player started from its headline is scrolled into view below the header');
  // Manual check (Playwright, hosted build, 1280 and 390): pressing the picture or the headline
  // opens no new page, the player appears in the same box, and a second video stops the first.
});

test('menus: the share menu flips to stay on screen, header menus scroll, rows match the live spacing', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/\.menu\.menu-up \{\s*top: auto;\s*bottom: calc\(100% \+ 4px\);/.test(css), 'a flipped menu opens above its button');
  assert.ok(/var controller = createMenu\(shareButton, menu, \{ onOpen: place \}\);/.test(app), 'the share menu places itself when it opens');
  assert.ok(/menu\.classList\.remove\('menu-up'\);[\s\S]{0,400}if \(height > below && above > below\) menu\.classList\.add\('menu-up'\);/.test(app), 'it flips only when the other side has more room, and never stays flipped');
  assert.ok(/if \(!siteHeader\.contains\(menu\) && typeof menu\.scrollIntoView === 'function'\) menu\.scrollIntoView\(\{ block: 'nearest' \}\);/.test(app), 'an opened share menu is scrolled into view, so its focused row is never off screen');
  assert.ok(/\.share-menu \{ z-index: 40; scroll-margin: 16px 0; \}/.test(css), 'with room for the opening animation');
  assert.ok(/\.site-header \.menu \{\s*max-height: calc\(100vh - 64px\);\s*max-height: calc\(100dvh - 64px\);\s*overflow-y: auto;/.test(css), 'the location and avatar menus scroll inside themselves on short screens');
  assert.ok(/\n\.menu-item-icon \{ margin-right: 8px; \}/.test(css) && !css.includes('.share-menu .menu-item-icon'), 'every menu icon has the live mr-2: labels sit 16px after their icon');
  assert.ok(/\.menu-sublist \.menu-item \{ padding-left: 40px; \}/.test(css), 'the language choices line up with the labels');
  // Live menus are modal: while open, their trigger shows its resting look under the pointer.
  assert.ok(/\.action-share:hover \{ color: var\(--share-hover\); background: var\(--share-hover-bg\); \}/.test(css), 'Share is green on hover only');
  assert.ok(/\.action-share\[aria-expanded="true"\]:hover \{ color: var\(--action-ink\); background: var\(--outline-bg\); \}/.test(css));
  assert.ok(/\.loc-button\[aria-expanded="true"\]:hover \{ background: transparent; color: var\(--on-bar\); \}/.test(css));
  assert.ok(/\.avatar-button\[aria-expanded="true"\]:hover \{ background: transparent; \}/.test(css));
  assert.ok(!/(search-toggle|menu-button)\[aria-expanded="true"\]:hover/.test(css), 'the search toggle and ≡ keep their hover (not modal menus on the live site)');
  // The avatar's hover colour sits under its opaque face, as on the live site: no ring.
  assert.ok(/\.avatar-button:hover \{ background: var\(--control-hover\); \}/.test(css) && !/\.avatar-button:hover \{[^}]*box-shadow/.test(css), 'no hover ring around the avatar');
  // Opening a header menu while the Menu panel is open closes the panel (it would cover the menu).
  assert.ok(/if \(openMenu && openMenu !== controller\) openMenu\.close\(false\);\s*if \(!menuPanel\.hidden\) closeMenuPanel\(false\);/.test(app), 'a menu never opens under the Menu panel');
  assert.ok(/topbar\.addEventListener\('click', function \(\) \{ if \(!menuPanel\.hidden\) closeMenuPanel\(false\); \}, true\);/.test(app), 'any click in the blue bar closes the panel first');
});

test('tabs and the grey row: Home stays current except on a category, aria-current, a ring that clears the label', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/function activeTabId\(\) \{\s*return view === 'feed' \? state\.c : '';\s*\}/.test(app), 'Home is the current tab on every view but a category');
  const sections = (/function renderSections\(\) \{([\s\S]*?)\n {2}\}\n/.exec(app) || [])[1] || '';
  assert.ok(sections.includes('subbar.hidden = false;') && !sections.includes('show = false'), 'the grey row shows on every view (the header keeps its 143px)');
  assert.ok(/if \(view === 'following' \|\| view === 'manage'\) \{[\s\S]*?setCurrent\(manage, view === 'manage'\);/.test(sections), 'Manage stays in the row, current while Manage Following is open');
  // The tabs and grey-row links open places; they are not toggles.
  assert.ok(/function setCurrent\(node, current\) \{\s*if \(current\) node\.setAttribute\('aria-current', 'true'\);\s*else node\.removeAttribute\('aria-current'\);/.test(app));
  for (const fn of ['makeTab', 'markActiveTab', 'makeSectionLink', 'markActiveSection']) {
    const body = (new RegExp(`function ${fn}\\([^)]*\\) \\{([\\s\\S]*?)\\n {2}\\}\\n`).exec(app) || [])[1] || '';
    assert.ok(body.includes('setCurrent('), fn + ' marks the current item with aria-current');
    assert.ok(!body.includes('aria-pressed'), fn + ' does not use aria-pressed');
  }
  assert.ok(/\.tab\[aria-current="true"\]/.test(css) && /\.section-link\[aria-current="true"\]/.test(css) && !/\.(tab|section-link)\[aria-pressed/.test(css), 'the CSS follows aria-current');
  // The focus ring is drawn around the label, not over it.
  assert.ok(/\.tab:focus-visible, \.section-link:focus-visible \{ outline: none; \}/.test(css));
  assert.ok(/\.tab:focus-visible::after, \.section-link:focus-visible::after \{\s*content: "";\s*position: absolute;\s*inset: 0;\s*border: 3px solid var\(--focus\);/.test(css), 'a 3px ring (a border, so forced colours paint it)');
  assert.ok(/\.section-link:focus-visible::after \{ inset: -4px -6px 2px; \}/.test(css), 'grey-row links: the ring clears the letters and the underline');
  assert.ok(/\.tab:first-child:focus-visible::after \{ left: -6px; \}/.test(css), 'Home (no left padding from 640px) keeps its "H" clear');
});

test('toasts: one at a time, rising from the bottom, paused while in use, dismissed by Escape, never over focus', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/var MAX_TOASTS = 1;/.test(app), 'a new toast replaces the one showing (the live store keeps one)');
  assert.ok(/@keyframes toast-in-bottom/.test(css) && /\.toast \{ animation-name: toast-in-bottom; \}/.test(css) && !css.includes('toast-in-right'), 'desktop toasts rise from the bottom');
  const toast = (/function showToast\(title, description\) \{([\s\S]*?)\n {2}\}\n/.exec(app) || [])[1] || '';
  for (const event of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) assert.ok(toast.includes(`addEventListener('${event}'`), 'the timer reacts to ' + event);
  assert.ok(/remaining -= Date\.now\(\) - startedAt;/.test(toast) && /window\.setTimeout\(control\.dismiss, Math\.max\(remaining, 0\)\)/.test(toast), 'it resumes with the time that was left');
  assert.ok(/document\.addEventListener\('visibilitychange', onVisibilityChange\);/.test(app), 'and waits while the page is in the background');
  assert.ok(/if \(toast\.contains\(document\.activeElement\)\) focusOn\(mainEl, true\);/.test(toast), 'focus on a toast that goes stays in the page');
  assert.ok(/if \(liveToasts\.length && !dialog\.hasAttribute\('open'\)\) \{\s*event\.preventDefault\(\);\s*liveToasts\[liveToasts\.length - 1\]\.dismiss\(\);/.test(app), 'Escape dismisses the newest toast without moving focus');
  assert.ok(/keepFocusClearOfToasts\(\);/.test(toast) && /window\.scrollBy\(0, rect\.bottom - region\.top \+ 8\);/.test(app), 'a toast landing on the focused control scrolls it clear');
  assert.ok(/html \{ scroll-padding-bottom: var\(--toast-space, 0px\); \}/.test(css), 'and the next Tab stop is kept above the toast');
});

test('focus stays visible: in the header menus, in forced colours, and on the blue bar while scrolling', () => {
  const css = readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(/\.topbar \.menu :focus-visible \{ outline-color: var\(--focus\); \}/.test(css), 'the white bar ring does not reach the white menus inside the bar');
  // Forced colours drop box-shadows and repaint borders: a transparent outline is what they paint.
  for (const selector of ['.search-input:focus-visible, .manage-search-input:focus-visible', '.action:focus-visible', '.button:focus-visible', '.select:focus-visible', '.check-input:focus-visible + .check-box']) {
    const rule = (new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css) || [])[1];
    assert.ok(rule !== undefined, selector + ' is styled');
    assert.ok(!/outline: none/.test(rule) && /outline: 3px solid transparent/.test(rule), selector + ' keeps an outline for forced colours');
  }
  assert.ok(/if \(active && topbar\.contains\(active\)\) \{\s*try \{\s*if \(active\.matches\(':focus-visible'\)\) return true;/.test(app), 'the blue bar does not slide away from a keyboard-focused control');
  // The live bar, ≡ and outline buttons show the arrow; the avatar, tabs and menu rows the hand.
  assert.ok(/\.bar-button \{[^}]*cursor: default;/.test(css) && /\.action \{[^}]*cursor: default;/.test(css), 'bar and action buttons use the default cursor');
});

test('the article/video glyph stays readable on its light hover', () => {
  const { css, light, systemDark, dark } = themeBlocks();
  assert.equal(tokensOf(light)['--control-hover-glyph'], 'brightness(0) opacity(0.91)', 'light: the white glyph turns #171717 like the other bar controls (white is 1.75:1 on #a7c4ff)');
  assert.equal(tokensOf(systemDark)['--control-hover-glyph'], 'none', 'dark (system): white stays (5.6:1 on #3f64b9)');
  assert.equal(tokensOf(dark)['--control-hover-glyph'], 'none', 'dark (chosen)');
  assert.ok(/\.type-button:hover \.type-glyph \{ filter: var\(--control-hover-glyph\); \}/.test(css));
});

test('screen readers: no stray text, one announcement per action, item context, language of parts', () => {
  const template = readTemplate();
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  assert.ok(template.includes('<span id="new-tab-hint" hidden data-t="openInNewTab">'), 'the new-tab description is hidden, not read as page text');
  assert.ok(template.includes('<span id="coming-later-hint" hidden data-t="comingLater">'), 'the heart\'s "Coming later" description');
  assert.ok(!template.includes('action-status') && !app.includes('actionStatus'), 'Save and Copy Link are announced once, by the toast region');
  // Save's label carries its state, so it is not also a toggle; each action names its item.
  assert.ok(/class="action action-save" data-saved="false"/.test(template) && !/action-save"[^>]*aria-pressed/.test(template), 'Save has no aria-pressed');
  assert.ok(/save\.setAttribute\('data-saved', saved \? 'true' : 'false'\);/.test(app) && !/save\.setAttribute\('aria-pressed'/.test(app));
  assert.ok(/save\.setAttribute\('aria-describedby', titleId\);/.test(app) && /share\.setAttribute\('aria-describedby', titleId\);/.test(app) && /like\.setAttribute\('aria-describedby', titleId \+ ' coming-later-hint'\);/.test(app), 'Save, Share and the heart are described by the item title');
  assert.ok(/title\.id = 'it-' \+ itemSerial;/.test(app), 'every title gets a unique id');
  assert.ok(/menu\.id = 'share-menu-' \+ shareMenuSerial;\s*shareButton\.setAttribute\('aria-controls', menu\.id\);/.test(app), 'each Share button names the menu it controls');
  // A French headline on the English interface is marked as French (WCAG 3.1.2).
  assert.ok(/if \(source\.language && source\.language !== UI_LANG\) find\(card, '\.item-text'\)\.setAttribute\('lang', source\.language\);/.test(app), '.item-text takes the source language');
  // The Language list names each language in itself ("Français"), marked with its language.
  assert.ok(/new Intl\.DisplayNames\(\[code\], \{ type: 'language' \}\)\.of\(code\)/.test(app) && /name\.charAt\(0\)\.toLocaleUpperCase\(code\)/.test(app), 'native names, capitalised by their own rules');
  assert.ok(/find\(item, '\.menu-item-label'\)\.setAttribute\('lang', entry\.code\);/.test(app) && /langCurrent\.setAttribute\('lang', state\.lang\);/.test(app) && /langCurrent\.removeAttribute\('lang'\);/.test(app), 'list rows and the hint carry their lang');
});

test('state and navigation: search from any view, preferences that follow, Back, and focus that never drops', () => {
  const app = readFileSync(path.join(SITE_DIR, 'app.js'), 'utf8');
  // A search from Sources, About or Manage Following opens the feed with the results.
  assert.ok(/var leave = words !== '' && !FEED_VIEWS\[view\];\s*if \(words === state\.q && !leave\) return;[\s\S]*?if \(leave\) \{\s*state\.c = '';\s*state\.s = '';\s*showView\('feed', false\);/.test(app));
  // Closing the field drops unapplied words.
  assert.ok(/function setSearchOpen\(open, moveFocus\) \{[\s\S]{0,200}if \(!open\) searchInput\.value = state\.q;/.test(app));
  // Saving preferences applies them at once; ?view= is not a filter.
  assert.ok(/function savePreferences\(\) \{[\s\S]*?state\.lang = lang;\s*state\.loc = loc;\s*syncControls\(\);\s*refresh\(true\);/.test(app));
  assert.ok(/if \(FILTER_PARAMS\[i\] !== 'view' && params\.has\(FILTER_PARAMS\[i\]\)\) return true;/.test(app));
  assert.ok(/var lang = \(params\.get\('lang'\) \|\| ''\)\.toLowerCase\(\);/.test(app), '?lang=FR reads like ?loc=ca');
  // Back returns to the previous view or category on the hosted site; canonical writes replace.
  assert.ok(/push = \['view', 'c', 's'\]\.some\(/.test(app) && /if \(push\) history\.pushState\(null, '', url\);\s*else history\.replaceState\(history\.state, '', url\);/.test(app));
  assert.ok(/refresh\(false, true\);\s*if \(hashView && CONFIG\.urlState\) writeUrlState\(true\);/.test(app), 'start-up only makes the address canonical');
  assert.ok(/goToView\(next, true\);\s*if \(CONFIG\.urlState\) writeUrlState\(true\);/.test(app), 'so does a #hash');
  assert.ok(/function onPopState\(\) \{[\s\S]*?refresh\(false, true\);/.test(app), 'and Back/Forward');
  // Saved ids of items that left the data do not count.
  assert.ok(/var savedIds = stringList\(readStorage\(SAVED_KEY\)\)\.filter\(function \(id\) \{ return Boolean\(ITEM_BY_ID\[id\]\); \}\);/.test(app));
  // The avatar menu's Following row has one handler.
  assert.ok(!app.includes("byId('menu-following')"), 'no second click handler on top of bindInPageLinks');
  // The Settings dialog closes on its backdrop only, not on its own padding.
  assert.ok(/function onDialogClick\(event\) \{\s*if \(event\.target !== dialog\) return;[\s\S]*?if \(outside\) closeDialog\(\);/.test(app));
  // Show more's last batch moves focus to the first new item.
  assert.ok(/if \(hadFocus && showMore\.hidden\) \{[\s\S]*?focusOn\(firstLink \|\| mainEl, true\);/.test(app));
  // The empty block's button row takes no room when both buttons are hidden.
  assert.ok(/emptyActions\.hidden = clearButton\.hidden && manageFollowingButton\.hidden;/.test(app));
});
