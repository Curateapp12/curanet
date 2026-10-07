/**
 * Assembles the data the site needs from the files under data/: every source with its tags, every
 * stored item tagged with its source and shrunk to the few fields the browser uses, newest first.
 * The data directory is read directly here (a few lines of fs) so the build has no other
 * dependency. Missing files count as empty, so an empty data directory still builds a site.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { truncate } from './sanitize.js';
import { isHttpUrl, URL_MAX, VIDEO_ID_RE } from './validate.js';

/** @typedef {import('./types.js').Source} Source */
/** @typedef {import('./types.js').Item} Item */
/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').HiddenEntry} HiddenEntry */

/**
 * @typedef {Object} FeedCategory
 * @property {string} id
 * @property {{en: string, fr?: string}} name
 * @property {{id: string, name: {en: string, fr?: string}}[]} subcategories
 *
 * @typedef {Object} FeedSource
 * @property {string} id
 * @property {string} name
 * @property {'feed'|'youtube_channel'} type
 * @property {string} url
 * @property {string|null} siteUrl
 * @property {string} category
 * @property {string} subcategory
 * @property {string} country
 * @property {string} language
 * @property {'active'|'paused'|'blocked'|'waiting_for_key'} status
 * @property {string|null} lastSuccess
 * @property {string|null} lastResult
 *
 * @typedef {Object} FeedItem   Compact item as embedded in the page.
 * @property {string} id
 * @property {string} s          Source id.
 * @property {string} t          Title.
 * @property {string} l          Link to the original.
 * @property {string} p          Published, ISO.
 * @property {string|null} th    Thumbnail address (hosted) or data URI (preview), or null.
 * @property {'a'|'v'} ty        Article or video.
 * @property {string} [v]        YouTube video id (videos only).
 * @property {string} x          Excerpt, at most 300 characters, used only for search.
 *
 * @typedef {Object} FeedData
 * @property {string} generatedAt
 * @property {FeedCategory[]} categories
 * @property {FeedSource[]} sources
 * @property {FeedItem[]} items
 * @property {string[]} languages   Sorted, only languages of sources that have items.
 * @property {string[]} countries   Sorted, only countries of sources that have items.
 */

export const EXCERPT_MAX = 300;

/**
 * Read and parse one JSON file. A missing file gives `fallback`; a broken one throws a message
 * that names the file.
 * @param {string} file
 * @param {any} fallback
 * @returns {any}
 */
function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * @param {unknown} doc
 * @param {string} key
 * @returns {any[]}
 */
function listOf(doc, key) {
  if (!doc || typeof doc !== 'object') return [];
  const list = /** @type {any} */ (doc)[key];
  return Array.isArray(list) ? list.filter((entry) => entry && typeof entry === 'object') : [];
}

/**
 * @param {Category} category
 * @returns {FeedCategory}
 */
function compactCategory(category) {
  return {
    id: category.id,
    name: compactName(category.name),
    subcategories: listOf(category, 'subcategories').map((sub) => ({ id: sub.id, name: compactName(sub.name) })),
  };
}

/**
 * @param {{en?: string, fr?: string}|undefined} name
 * @returns {{en: string, fr?: string}}
 */
function compactName(name) {
  const en = name && typeof name.en === 'string' ? name.en : '';
  return name && typeof name.fr === 'string' && name.fr ? { en, fr: name.fr } : { en };
}

/**
 * @param {unknown} value
 * @returns {string|null} the address when it is an http(s) URL within the stored-field limit, else null.
 */
function safeUrl(value) {
  return typeof value === 'string' && value.length <= URL_MAX && isHttpUrl(value) ? value : null;
}

/**
 * @param {Source} source
 * @returns {FeedSource}
 */
function compactSource(source) {
  const fetch = source.fetch && typeof source.fetch === 'object' ? source.fetch : null;
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    // Addresses become links on the Sources page: anything but http(s) is dropped here, whatever
    // the data check says, so nothing from a data file can run on the site.
    url: safeUrl(source.url) || '',
    siteUrl: safeUrl(source.siteUrl),
    category: source.category,
    subcategory: source.subcategory,
    country: source.country,
    language: source.language,
    status: source.status,
    lastSuccess: fetch && typeof fetch.lastSuccess === 'string' ? fetch.lastSuccess : null,
    lastResult: fetch && typeof fetch.lastResult === 'string' ? fetch.lastResult : null,
  };
}

/**
 * Shrink a stored item to what the browser needs. Nothing else from the item is kept.
 * @param {Item} item
 * @param {string} sourceId
 * @returns {FeedItem}
 */
export function compactItem(item, sourceId) {
  const isVideo = item.type === 'video';
  /** @type {FeedItem} */
  const compact = {
    id: item.id,
    s: sourceId,
    t: typeof item.title === 'string' ? item.title : '',
    l: item.link,
    p: typeof item.published === 'string' && item.published ? item.published : item.addedAt,
    th: safeUrl(item.thumbnail),
    ty: isVideo ? 'v' : 'a',
    x: truncate(typeof item.excerpt === 'string' ? item.excerpt : '', EXCERPT_MAX),
  };
  if (isVideo && typeof item.videoId === 'string' && VIDEO_ID_RE.test(item.videoId)) compact.v = item.videoId;
  return compact;
}

/**
 * @param {HiddenEntry[]} hidden
 * @returns {(item: Item, sourceId: string) => boolean}
 */
function hiddenMatcher(hidden) {
  const links = new Set();
  const guids = new Set();
  for (const entry of hidden) {
    if (typeof entry.link === 'string' && entry.link) links.add(entry.link);
    if (typeof entry.guid === 'string' && entry.guid && typeof entry.sourceId === 'string') guids.add(entry.sourceId + '\n' + entry.guid);
  }
  return (item, sourceId) => links.has(item.link) || (typeof item.guid === 'string' && guids.has(sourceId + '\n' + item.guid));
}

/**
 * Read `data/items/<sourceId>.json` and return its items (empty when the file is missing).
 * @param {string} dataDir
 * @param {string} sourceId
 * @returns {Item[]}
 */
function readItems(dataDir, sourceId) {
  const file = path.join(dataDir, 'items', sourceId + '.json');
  const doc = readJson(file, null);
  // Only items whose link is an http(s) address reach the page: the link becomes an href.
  return listOf(doc, 'items').filter((item) => typeof item.id === 'string' && safeUrl(item.link) !== null);
}

/**
 * Assemble everything the site shows from a data directory. Items of every listed source are
 * included whatever the source's status (a paused or blocked source keeps its items visible);
 * item files whose source is no longer in sources.json are ignored, and items listed in
 * hidden.json are dropped. Items are sorted newest first by `published` (falling back to `addedAt`).
 * @param {string} dataDir
 * @param {{now?: Date}} [options]
 * @returns {FeedData}
 */
export function assembleFeedData(dataDir, { now = new Date() } = {}) {
  const categoriesDoc = readJson(path.join(dataDir, 'categories.json'), { categories: [] });
  const sourcesDoc = readJson(path.join(dataDir, 'sources.json'), { sources: [] });
  const hiddenDoc = readJson(path.join(dataDir, 'hidden.json'), { hidden: [] });

  const categories = listOf(categoriesDoc, 'categories').map(compactCategory);
  /** @type {Source[]} */
  const sources = listOf(sourcesDoc, 'sources').filter((source) => typeof source.id === 'string' && source.id);
  const isHidden = hiddenMatcher(listOf(hiddenDoc, 'hidden'));

  /** @type {FeedItem[]} */
  const items = [];
  const languages = new Set();
  const countries = new Set();
  for (const source of sources) {
    const stored = readItems(dataDir, source.id).filter((item) => !isHidden(item, source.id));
    if (stored.length === 0) continue;
    if (typeof source.language === 'string' && source.language) languages.add(source.language);
    if (typeof source.country === 'string' && source.country) countries.add(source.country);
    for (const item of stored) items.push(compactItem(item, source.id));
  }
  items.sort((a, b) => (a.p < b.p ? 1 : a.p > b.p ? -1 : 0));

  return {
    generatedAt: now.toISOString(),
    categories,
    sources: sources.map(compactSource),
    items,
    languages: Array.from(languages).sort(),
    countries: Array.from(countries).sort(),
  };
}

/**
 * Names of the item files present in the data directory, for a summary line.
 * @param {string} dataDir
 * @returns {string[]}
 */
export function listItemFiles(dataDir) {
  const dir = path.join(dataDir, 'items');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
}
