#!/usr/bin/env node
/**
 * Builds the site from the data files. Two outputs come from the same template and browser code:
 *
 *   hosted   dist/index.html + app.js + styles.css + strings.js — a full document; images load
 *            from the publishers' addresses, videos play in youtube-nocookie.com, filters live in
 *            the query string.
 *   preview  preview/curanet-preview.html — one self-contained artifact fragment (no doctype,
 *            html, head or body tags); CSS and JS inlined, thumbnails downloaded and embedded as
 *            small WebP data URIs newest first until the file would pass --max-bytes, videos open on
 *            YouTube, state stays inside the page.
 *
 * Usage: node scripts/build.js [--target hosted|preview|all] [--data data] [--out dist]
 *        [--preview-out preview/curanet-preview.html] [--max-bytes 12000000] [--no-thumbs]
 *        [--thumb-concurrency 6] [--thumb-timeout 10000] [--cache .cache/thumbs]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/lib/cli.js';
import { assembleFeedData, listItemFiles } from '../src/lib/build-data.js';
import { downloadThumbnail, embedThumbnails } from '../src/lib/thumbs.js';

/** @typedef {import('../src/lib/build-data.js').FeedData} FeedData */
/** @typedef {import('../src/lib/thumbs.js').EmbedStats} EmbedStats */

const SITE_DIR = fileURLToPath(new URL('../src/site/', import.meta.url));
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap';
const DESCRIPTION = 'Curanet collects headlines from news feeds and videos from YouTube in one feed you can narrow by category, language, location and type.';

/**
 * Applies the visitor's theme before the first paint: light by default, dark when chosen, and no
 * attribute for "follow system". Without it a visitor whose device is dark would see a dark flash
 * before the light default, and one who chose Dark a light flash. It reads the same key, the same
 * way, as readSettings/applyTheme in app.js, which repeat the decision once they load.
 */
export const THEME_SCRIPT = '<script>(function(){var theme="light";try{var raw=window.localStorage.getItem("curanet.settings");var saved=raw?JSON.parse(raw):null;if(saved&&(saved.theme==="dark"||saved.theme==="system"))theme=saved.theme;}catch(e){}var root=document.documentElement;if(theme==="system")root.removeAttribute("data-theme");else root.setAttribute("data-theme",theme);})();</script>';

export const DEFAULTS = Object.freeze({
  target: 'all',
  dataDir: 'data',
  outDir: 'dist',
  previewOut: 'preview/curanet-preview.html',
  maxBytes: 12_000_000,
  thumbConcurrency: 6,
  thumbTimeoutMs: 10_000,
  cacheDir: '.cache/thumbs',
});

/**
 * @typedef {Object} BuildOptions
 * @property {'hosted'|'preview'|'all'} [target]
 * @property {string} [dataDir]
 * @property {string} [outDir]
 * @property {string} [previewOut]
 * @property {number} [maxBytes]
 * @property {boolean} [thumbs]                 false skips downloading images for the preview.
 * @property {number} [thumbConcurrency]
 * @property {number} [thumbTimeoutMs]
 * @property {string} [cacheDir]
 * @property {typeof globalThis.fetch} [fetch]  Injected for tests.
 * @property {(url: string) => Promise<Buffer|null>} [download]   Replaces the downloader entirely (tests).
 * @property {Date} [now]
 * @property {(message: string) => void} [log]
 * @property {string} [siteDir]                 Where index.html, styles.css, strings.js and app.js live.
 *
 * @typedef {Object} SiteAssets
 * @property {string} template   Body markup (src/site/index.html).
 * @property {string} css
 * @property {string} strings
 * @property {string} app
 *
 * @typedef {Object} SiteConfig
 * @property {'hosted'|'preview'} mode
 * @property {boolean} urlState
 * @property {'remote'|'embedded'} thumbnails
 * @property {'embed'|'link'} video
 * @property {string} uiLang
 *
 * @typedef {Object} HostedResult
 * @property {string} file
 * @property {number} bytes
 * @property {number} items
 *
 * @typedef {Object} PreviewResult
 * @property {string} file
 * @property {number} bytes
 * @property {number} baseBytes
 * @property {number} items
 * @property {number} embedded
 * @property {number} skipped
 * @property {number} droppedForBudget
 * @property {number} failed
 *
 * @typedef {Object} BuildResult
 * @property {HostedResult|null} hosted
 * @property {PreviewResult|null} preview
 */

export const HOSTED_CONFIG = Object.freeze({ mode: 'hosted', urlState: true, thumbnails: 'remote', video: 'embed', uiLang: 'en' });
export const PREVIEW_CONFIG = Object.freeze({ mode: 'preview', urlState: false, thumbnails: 'embedded', video: 'link', uiLang: 'en' });

// ------------------------------------------------------------------ rendering

/**
 * Make a JSON text safe inside a <script> element: no "</" (which could close the element) and no
 * "<!--" (which changes how the parser reads the rest). Both replacements are valid JSON escapes.
 * @param {string} json
 * @returns {string}
 */
export function escapeJsonForScript(json) {
  return json.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Make JavaScript source safe to inline: a literal "</script" inside a string would end the element.
 * @param {string} source
 * @returns {string}
 */
function escapeScriptSource(source) {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * @param {FeedData} data
 * @returns {string}
 */
function renderDataScript(data) {
  return '<script id="curanet-data" type="application/json">' + escapeJsonForScript(JSON.stringify(data)) + '</script>';
}

/**
 * @param {SiteConfig} config
 * @returns {string}
 */
function renderConfigScript(config) {
  return '<script>var CURANET_CONFIG = ' + JSON.stringify(config) + ';</script>';
}

/**
 * @param {string} dir
 * @returns {SiteAssets}
 */
function readAssets(dir) {
  const read = (name) => readFileSync(path.join(dir, name), 'utf8');
  return { template: read('index.html'), css: read('styles.css'), strings: read('strings.js'), app: read('app.js') };
}

/**
 * The hosted page: a complete HTML document that links its assets.
 * @param {FeedData} data
 * @param {SiteAssets} assets
 * @returns {string}
 */
export function renderHosted(data, assets) {
  return [
    '<!doctype html>',
    `<html lang="${HOSTED_CONFIG.uiLang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>Curanet — Curate the internet</title>',
    `<meta name="description" content="${DESCRIPTION}">`,
    '<meta name="color-scheme" content="light dark">',
    THEME_SCRIPT,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS_HREF}">`,
    '<link rel="stylesheet" href="styles.css">',
    '</head>',
    '<body>',
    assets.template.trim(),
    renderDataScript(data),
    renderConfigScript(HOSTED_CONFIG),
    '<script src="strings.js"></script>',
    '<script src="app.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * The preview: an artifact fragment with everything inlined. The artifact viewer adds the document
 * skeleton itself, so no doctype, html, head or body tags appear here. The theme script is the
 * only script before the markup, so the first paint already has the right theme.
 * @param {FeedData} data
 * @param {SiteAssets} assets
 * @returns {string}
 */
export function renderPreview(data, assets) {
  return [
    '<title>Curanet</title>',
    THEME_SCRIPT,
    `<link rel="stylesheet" href="${FONTS_HREF}">`,
    '<style>',
    assets.css.trim(),
    '</style>',
    assets.template.trim(),
    renderDataScript(data),
    renderConfigScript(PREVIEW_CONFIG),
    '<script>',
    escapeScriptSource(assets.strings.trim()),
    '',
    escapeScriptSource(assets.app.trim()),
    '</script>',
    '',
  ].join('\n');
}

// ------------------------------------------------------------------ the build

/**
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
  if (bytes < 1000) return bytes + ' B';
  if (bytes < 1_000_000) return (bytes / 1000).toFixed(0) + ' KB';
  return (bytes / 1_000_000).toFixed(1) + ' MB';
}

/**
 * @param {FeedData} data
 * @param {SiteAssets} assets
 * @param {string} outDir
 * @param {(message: string) => void} log
 * @returns {HostedResult}
 */
function buildHosted(data, assets, outDir, log) {
  mkdirSync(outDir, { recursive: true });
  const html = renderHosted(data, assets);
  const file = path.join(outDir, 'index.html');
  writeFileSync(file, html);
  writeFileSync(path.join(outDir, 'styles.css'), assets.css);
  writeFileSync(path.join(outDir, 'strings.js'), assets.strings);
  writeFileSync(path.join(outDir, 'app.js'), assets.app);
  const bytes = Buffer.byteLength(html);
  log(`Hosted: ${data.items.length} items, ${formatSize(bytes)} → ${path.join(outDir, 'index.html')} (+ app.js, styles.css, strings.js)`);
  return { file, bytes, items: data.items.length };
}

/**
 * @param {FeedData} data
 * @param {SiteAssets} assets
 * @param {Required<Pick<BuildOptions, 'previewOut'|'maxBytes'|'thumbs'|'thumbConcurrency'|'log'>> & {download: (url: string) => Promise<Buffer|null>}} options
 * @returns {Promise<PreviewResult>}
 */
async function buildPreview(data, assets, options) {
  const { previewOut, maxBytes, thumbs, thumbConcurrency, download, log } = options;
  // Thumbnails are embedded into a copy of the items so the hosted output (built from the same
  // data) keeps the publishers' addresses.
  /** @type {FeedData & {images?: string[], items: (Omit<FeedData['items'][number], 'th'> & {th: string|number|null})[]}} */
  const previewData = { ...data, items: data.items.map((item) => ({ ...item })) };
  const addresses = previewData.items.map((item) => item.th);
  for (const item of previewData.items) item.th = null;
  const baseBytes = Buffer.byteLength(renderPreview(previewData, assets));

  /** @type {EmbedStats} */
  let stats = { embedded: 0, skipped: previewData.items.length, droppedForBudget: 0, failed: 0, bytes: 0 };
  if (thumbs) {
    previewData.items.forEach((item, index) => { item.th = addresses[index]; });
    stats = await embedThumbnails(/** @type {{th: string|null}[]} */ (previewData.items), { maxBytes, baseBytes, download, concurrency: thumbConcurrency, log });
    // Identical images (one picture used by several items) are stored once in an images table and
    // referenced by index, so the file only pays for each picture once.
    /** @type {string[]} */
    const images = [];
    /** @type {Map<string, number>} */
    const indexByUri = new Map();
    for (const item of previewData.items) {
      if (typeof item.th !== 'string' || !item.th.startsWith('data:')) continue;
      let index = indexByUri.get(item.th);
      if (index === undefined) {
        index = images.length;
        images.push(item.th);
        indexByUri.set(item.th, index);
      }
      /** @type {any} */ (item).th = index;
    }
    previewData.images = images;
  }

  const html = renderPreview(previewData, assets);
  const bytes = Buffer.byteLength(html);
  mkdirSync(path.dirname(previewOut), { recursive: true });
  writeFileSync(previewOut, html);
  const thumbsNote = thumbs
    ? `${stats.embedded} thumbnails embedded, ${stats.droppedForBudget} dropped for size, ${stats.failed} failed`
    : 'no thumbnails (--no-thumbs)';
  log(`Preview: ${previewData.items.length} items, ${thumbsNote}, ${formatSize(bytes)} → ${previewOut}`);
  if (bytes > maxBytes) {
    throw new Error(`The preview file is ${formatSize(bytes)}, larger than the ${formatSize(maxBytes)} limit. Lower the number of items or raise --max-bytes.`);
  }
  return { file: previewOut, bytes, baseBytes, items: previewData.items.length, embedded: stats.embedded, skipped: stats.skipped, droppedForBudget: stats.droppedForBudget, failed: stats.failed };
}

/**
 * Build the hosted site, the preview, or both.
 * @param {BuildOptions} [options]
 * @returns {Promise<BuildResult>}
 * @throws {Error} plain-language message when a data file is unreadable or the preview is too large.
 */
export async function build(options = {}) {
  const target = options.target || DEFAULTS.target;
  if (target !== 'hosted' && target !== 'preview' && target !== 'all') {
    throw new Error(`Unknown target "${target}": use hosted, preview or all.`);
  }
  const dataDir = options.dataDir || DEFAULTS.dataDir;
  const outDir = options.outDir || DEFAULTS.outDir;
  const previewOut = options.previewOut || DEFAULTS.previewOut;
  const maxBytes = options.maxBytes || DEFAULTS.maxBytes;
  const thumbs = options.thumbs !== false;
  const thumbConcurrency = options.thumbConcurrency || DEFAULTS.thumbConcurrency;
  const thumbTimeoutMs = options.thumbTimeoutMs || DEFAULTS.thumbTimeoutMs;
  const cacheDir = options.cacheDir === undefined ? DEFAULTS.cacheDir : options.cacheDir;
  const log = options.log || console.log;
  const now = options.now || new Date();
  const fetch = options.fetch || globalThis.fetch;
  const download = options.download || ((url) => downloadThumbnail(url, { fetch, timeoutMs: thumbTimeoutMs, cacheDir: cacheDir || undefined }));

  const data = assembleFeedData(dataDir, { now });
  const assets = readAssets(options.siteDir || SITE_DIR);
  const knownSources = new Set(data.sources.map((source) => source.id));
  const orphans = listItemFiles(dataDir).filter((name) => !knownSources.has(name.replace(/\.json$/, '')));
  if (orphans.length) log(`Note: ${orphans.length} item file(s) belong to no source and were ignored: ${orphans.join(', ')}`);

  /** @type {BuildResult} */
  const result = { hosted: null, preview: null };
  if (target === 'hosted' || target === 'all') result.hosted = buildHosted(data, assets, outDir, log);
  if (target === 'preview' || target === 'all') {
    result.preview = await buildPreview(data, assets, { previewOut, maxBytes, thumbs, thumbConcurrency, download, log });
  }
  return result;
}

// ------------------------------------------------------------------ command line

/**
 * @param {string[]} argv
 * @returns {{target: 'hosted'|'preview'|'all', dataDir: string, outDir: string, previewOut: string, maxBytes: number, thumbs: boolean, thumbConcurrency: number, thumbTimeoutMs: number, cacheDir: string}}
 * @throws {Error} plain-language message for a bad flag value.
 */
export function parseBuildArgs(argv) {
  const { flags } = parseArgs(argv, { booleans: ['no-thumbs'] });
  const target = String(flags.target || DEFAULTS.target);
  if (target !== 'hosted' && target !== 'preview' && target !== 'all') {
    throw new Error(`--target must be hosted, preview or all (got "${target}").`);
  }
  const number = (name, fallback) => {
    const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flags[key] === undefined) return fallback;
    const value = Number(flags[key]);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} needs a positive number (got "${flags[key]}").`);
    return value;
  };
  return {
    target,
    dataDir: String(flags.data || DEFAULTS.dataDir),
    outDir: String(flags.out || DEFAULTS.outDir),
    previewOut: String(flags.previewOut || DEFAULTS.previewOut),
    maxBytes: number('max-bytes', DEFAULTS.maxBytes),
    thumbs: !flags.noThumbs,
    thumbConcurrency: number('thumb-concurrency', DEFAULTS.thumbConcurrency),
    thumbTimeoutMs: number('thumb-timeout', DEFAULTS.thumbTimeoutMs),
    cacheDir: String(flags.cache || DEFAULTS.cacheDir),
  };
}

async function main() {
  let options;
  try {
    options = parseBuildArgs(process.argv.slice(2));
  } catch (error) {
    console.error('Problem: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }
  try {
    await build(options);
  } catch (error) {
    console.error('Problem: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
