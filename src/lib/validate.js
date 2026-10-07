/**
 * Validation of every data file. Each validator returns plain-language error strings (an empty
 * array when the data is fine) and never throws on a bad shape: a wrong type is something to
 * report, not a crash. Every message starts with the file and the place in it, so the owner can
 * open the file on GitHub and find the line.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** @typedef {import('./types.js').Source} Source */

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const EXCERPT_MAX = 300;
export const TITLE_MAX = 300;
export const URL_MAX = 2048;
const ITEM_ID_RE = /^[0-9a-f]{16}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const LANGUAGE_RE = /^[a-z]{2}$/;
const HANDLE_RE = /^@[\w.-]{3,}$/;
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
export const VIDEO_ID_RE = /^[\w-]{11}$/;
const HTML_START_RE = /<[a-zA-Z/!]/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const ISO_EXAMPLE = '2026-10-05T23:00:00.000Z';

const SOURCE_TYPES = ['feed', 'youtube_channel'];
const SOURCE_STATUSES = ['active', 'paused', 'blocked', 'waiting_for_key'];
const FETCH_RESULTS = ['ok', 'unchanged', 'blocked', 'error', 'skipped'];
const ITEM_TYPES = ['article', 'video'];
const SOURCE_FIELDS = ['id', 'type', 'name', 'url', 'siteUrl', 'handle', 'channelId', 'category', 'subcategory', 'country', 'language', 'status', 'addedAt', 'fetch', 'notes'];
const FETCH_FIELDS = ['etag', 'lastModified', 'lastAttempt', 'lastSuccess', 'lastResult', 'lastError', 'failures'];
const ITEM_FIELDS = ['title', 'excerpt', 'link', 'published', 'thumbnail', 'type', 'videoId', 'addedAt', 'guid', 'id'];
const RUN_TOTALS = ['sources', 'fetched', 'unchanged', 'added', 'pruned', 'blocked', 'errors', 'skipped'];

// ------------------------------------------------------------------ small helpers

/**
 * "1st", "2nd", "3rd", "11th", "22nd".
 * @param {number} n
 * @returns {string}
 */
export function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  return `${n}${mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'}`;
}

/**
 * A value as it would appear in the file, shortened for a message.
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (value === undefined) return 'nothing';
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * A list as "a, b or c".
 * @param {string[]} values
 * @returns {string}
 */
function oneOf(values) {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`;
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is string} */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** @param {unknown} value @returns {boolean} */
function isStringOrNull(value) {
  return value === null || typeof value === 'string';
}

/** @param {unknown} value @returns {boolean} */
function isCount(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/** @param {unknown} value @returns {boolean} */
function isIso(value) {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** @param {unknown} value @returns {URL|null} */
function parseUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * True for an absolute http:// or https:// address (parsed, so "javascript:" and the like fail).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}

/** @param {unknown} value @returns {boolean} */
function isYoutubeUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:') return false;
  return url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
}

/**
 * Label for an entry of a list: 'source "cbc" (3rd)' or 'the 3rd source' when it has no id.
 * @param {string} noun
 * @param {unknown} entry
 * @param {number} index
 * @returns {string}
 */
function entryLabel(noun, entry, index) {
  const id = isObject(entry) ? entry.id : undefined;
  return isNonEmptyString(id) ? `${noun} "${id}" (${ordinal(index + 1)})` : `the ${ordinal(index + 1)} ${noun}`;
}

/**
 * Shared check of the file envelope: an object with version 1 and a list under `listField`.
 * @param {unknown} doc
 * @param {string} file
 * @param {string} listField
 * @returns {string[]}
 */
function checkEnvelope(doc, file, listField) {
  if (!isObject(doc)) return [`${file}: the file must contain a JSON object with "version" and "${listField}"`];
  const errors = [];
  if (doc.version !== 1) errors.push(`${file}: has version ${show(doc.version)} — it must be 1`);
  if (!Array.isArray(doc[listField])) errors.push(`${file}: "${listField}" must be a list (an array) — found ${show(doc[listField])}`);
  return errors;
}

// ------------------------------------------------------------------ JSON parsing with positions

/**
 * Index of the first character where `text` stops being valid JSON, or -1 when this scanner finds
 * nothing wrong. Used only after JSON.parse has already failed, because the engine's own message
 * does not always say where the problem is.
 * @param {string} text
 * @returns {number}
 */
function findJsonErrorIndex(text) {
  let i = 0;
  const NUMBER_RE = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
  const skip = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i += 1;
  };
  /** @param {string} word */
  const word = (word) => {
    if (!text.startsWith(word, i)) throw i;
    i += word.length;
  };
  const string = () => {
    i += 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i += 1;
        return;
      }
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) throw i + 2;
          i += 6;
        } else {
          if (next === undefined || !'"\\/bfnrt'.includes(next)) throw i + 1;
          i += 2;
        }
        continue;
      }
      if (ch < ' ') throw i;
      i += 1;
    }
    throw text.length;
  };
  const number = () => {
    NUMBER_RE.lastIndex = i;
    const match = NUMBER_RE.exec(text);
    if (!match || match.index !== i) throw i;
    i += match[0].length;
  };
  /** @type {() => void} */
  const value = () => {
    skip();
    if (i >= text.length) throw i;
    const ch = text[i];
    if (ch === '{') return object();
    if (ch === '[') return array();
    if (ch === '"') return string();
    if (ch === 't') return word('true');
    if (ch === 'f') return word('false');
    if (ch === 'n') return word('null');
    if (ch === '-' || (ch >= '0' && ch <= '9')) return number();
    throw i;
  };
  const object = () => {
    i += 1;
    skip();
    if (text[i] === '}') {
      i += 1;
      return;
    }
    for (;;) {
      skip();
      if (text[i] !== '"') throw i;
      string();
      skip();
      if (text[i] !== ':') throw i;
      i += 1;
      value();
      skip();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return;
      }
      throw i;
    }
  };
  const array = () => {
    i += 1;
    skip();
    if (text[i] === ']') {
      i += 1;
      return;
    }
    for (;;) {
      value();
      skip();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return;
      }
      throw i;
    }
  };
  try {
    value();
    skip();
    if (i < text.length) throw i;
    return -1;
  } catch (at) {
    return typeof at === 'number' ? Math.min(at, text.length) : -1;
  }
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {{line: number, column: number}}
 */
function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: index - lastBreak };
}

/**
 * Parse JSON text, returning the document or a plain-language error that names the file and the
 * line and column of the first problem.
 * @param {string} text
 * @param {string} file   Label used in the error message.
 * @returns {{ok: true, doc: any} | {ok: false, error: string}}
 */
export function parseJson(text, file) {
  const source = String(text).replace(/^\uFEFF/, '');
  try {
    return { ok: true, doc: JSON.parse(source) };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const reason = raw
      .replace(/,\s*"[\s\S]*"(\.\.\.)? is not valid JSON$/, '')
      .replace(/ in JSON at position \d+( \(line \d+ column \d+\))?$/, '')
      .trim();
    let index = findJsonErrorIndex(source);
    if (index < 0) {
      const fromEngine = / at position (\d+)/.exec(raw);
      index = fromEngine ? Number(fromEngine[1]) : -1;
    }
    if (index < 0) return { ok: false, error: `${file}: not valid JSON — ${reason}` };
    const { line, column } = lineAndColumn(source, index);
    return { ok: false, error: `${file}: not valid JSON at line ${line}, column ${column} — ${reason}` };
  }
}

// ------------------------------------------------------------------ categories

/**
 * Check a category or subcategory: id (slug, unique within `seen`) and names.
 * @param {Record<string, any>} node
 * @param {string} where
 * @param {string} file
 * @param {string} noun
 * @param {Map<string, number>} seen   id → index of the first node with that id.
 * @param {number} index
 * @returns {string[]}
 */
function checkNamedNode(node, where, file, noun, seen, index) {
  const errors = [];
  if (!isNonEmptyString(node.id)) {
    errors.push(`${file}: ${where} has no id`);
  } else if (!SLUG_RE.test(node.id)) {
    errors.push(`${file}: ${where} has id ${show(node.id)} — ids use lower-case letters, digits and single dashes, like "top-stories"`);
  } else if (seen.has(node.id)) {
    errors.push(`${file}: ${where} has the same id as the ${ordinal(/** @type {number} */ (seen.get(node.id)) + 1)} ${noun} — ids must be unique`);
  } else {
    seen.set(node.id, index);
  }
  if (!isObject(node.name)) {
    errors.push(`${file}: ${where} has no "name" object — it needs at least { "en": "..." }`);
    return errors;
  }
  if (!isNonEmptyString(node.name.en)) errors.push(`${file}: ${where} has no English name (name.en)`);
  if (node.name.fr !== undefined && typeof node.name.fr !== 'string') errors.push(`${file}: ${where} has a French name that is not text — found ${show(node.name.fr)}`);
  return errors;
}

/**
 * Validate the parsed categories.json.
 * @param {unknown} doc
 * @param {{file?: string}} [options]   `file` is the label used in messages.
 * @returns {string[]}  Plain-language errors; empty when valid.
 */
export function validateCategories(doc, options = {}) {
  const file = options.file || 'categories.json';
  const errors = checkEnvelope(doc, file, 'categories');
  if (!isObject(doc) || !Array.isArray(doc.categories)) return errors;
  if (doc.categories.length === 0) errors.push(`${file}: the category list is empty — at least one category is needed`);
  /** @type {Map<string, number>} */
  const seen = new Map();
  doc.categories.forEach((category, index) => {
    const where = entryLabel('category', category, index);
    if (!isObject(category)) {
      errors.push(`${file}: ${where} is not an object`);
      return;
    }
    errors.push(...checkNamedNode(category, where, file, 'category', seen, index));
    if (!Array.isArray(category.subcategories)) {
      errors.push(`${file}: ${where} has no "subcategories" list — use [] when there are none`);
      return;
    }
    /** @type {Map<string, number>} */
    const subSeen = new Map();
    category.subcategories.forEach((sub, subIndex) => {
      const subWhere = `${entryLabel('subcategory', sub, subIndex)} of ${where}`;
      if (!isObject(sub)) {
        errors.push(`${file}: ${subWhere} is not an object`);
        return;
      }
      errors.push(...checkNamedNode(sub, subWhere, file, 'subcategory', subSeen, subIndex));
    });
  });
  return errors;
}

// ------------------------------------------------------------------ sources

/**
 * Category id → set of subcategory ids, from a (possibly imperfect) categories document.
 * @param {unknown} categoriesDoc
 * @returns {Map<string, Set<string>>|null}  null when no usable tree was given.
 */
function categoryTree(categoriesDoc) {
  if (!isObject(categoriesDoc) || !Array.isArray(categoriesDoc.categories)) return null;
  /** @type {Map<string, Set<string>>} */
  const tree = new Map();
  for (const category of categoriesDoc.categories) {
    if (!isObject(category) || !isNonEmptyString(category.id)) continue;
    const subs = Array.isArray(category.subcategories) ? category.subcategories : [];
    tree.set(category.id, new Set(subs.filter((s) => isObject(s) && isNonEmptyString(s.id)).map((s) => s.id)));
  }
  return tree;
}

/**
 * @param {Record<string, any>} fetch
 * @param {(text: string) => void} say
 */
function checkFetchState(fetch, say) {
  for (const field of ['etag', 'lastModified', 'lastAttempt', 'lastSuccess', 'lastError']) {
    if (!isStringOrNull(fetch[field])) say(`has fetch.${field} ${show(fetch[field])} — it must be text or null`);
  }
  if (fetch.lastResult !== null && !FETCH_RESULTS.includes(fetch.lastResult)) {
    say(`has fetch.lastResult ${show(fetch.lastResult)} — it must be ${oneOf(FETCH_RESULTS)} or null`);
  }
  if (!isCount(fetch.failures)) say(`has fetch.failures ${show(fetch.failures)} — it must be a whole number, 0 or more`);
}

/**
 * @param {Record<string, any>} source
 * @param {(text: string) => void} say
 */
function checkChannelIdentity(source, say) {
  const hasHandle = source.handle !== undefined && source.handle !== null;
  const hasChannelId = source.channelId !== undefined && source.channelId !== null;
  if (hasHandle && !(typeof source.handle === 'string' && HANDLE_RE.test(source.handle))) {
    say(`has handle ${show(source.handle)} — a YouTube handle starts with @ and has at least 3 characters, like "@CBCNews"`);
  }
  if (hasChannelId && !(typeof source.channelId === 'string' && CHANNEL_ID_RE.test(source.channelId))) {
    say(`has channelId ${show(source.channelId)} — a YouTube channel id starts with UC and has 24 characters`);
  }
  if (!hasHandle && !hasChannelId) say('is a YouTube channel without a handle or a channelId — one of them is needed');
}

/**
 * @param {Record<string, any>} source
 * @param {Map<string, Set<string>>|null} tree
 * @param {(text: string) => void} say
 */
function checkSourceCategory(source, tree, say) {
  if (!tree) return;
  if (!isNonEmptyString(source.category)) {
    say(`has no category — it must be a category id from categories.json`);
    return;
  }
  const subs = tree.get(source.category);
  if (!subs) {
    say(`has category ${show(source.category)} — no such category exists in categories.json`);
    return;
  }
  if (!isNonEmptyString(source.subcategory)) {
    say(`has no subcategory — it must be a subcategory id of category "${source.category}"`);
    return;
  }
  if (!subs.has(source.subcategory)) say(`has subcategory ${show(source.subcategory)} — category "${source.category}" has no such subcategory`);
}

/**
 * Validate the parsed sources.json against the category tree.
 * @param {unknown} doc
 * @param {unknown} categoriesDoc   The parsed categories.json; pass null to skip the category check
 *   (for example when categories.json itself could not be read).
 * @param {{file?: string, warnings?: string[]}} [options]   `warnings` receives non-fatal notes
 *   (unknown fields); `file` is the label used in messages.
 * @returns {string[]}  Plain-language errors; empty when valid.
 */
export function validateSources(doc, categoriesDoc, options = {}) {
  const file = options.file || 'sources.json';
  const warnings = options.warnings || [];
  const errors = checkEnvelope(doc, file, 'sources');
  if (!isObject(doc) || !Array.isArray(doc.sources)) return errors;
  const tree = categoryTree(categoriesDoc);
  /** @type {Map<string, number>} */
  const seen = new Map();
  doc.sources.forEach((source, index) => {
    const where = entryLabel('source', source, index);
    if (!isObject(source)) {
      errors.push(`${file}: ${where} is not an object`);
      return;
    }
    /** @param {string} text */
    const say = (text) => errors.push(`${file}: ${where} ${text}`);
    /** @param {string} text */
    const warn = (text) => warnings.push(`${file}: ${where} ${text}`);
    const isChannel = source.type === 'youtube_channel';
    const isFeed = source.type === 'feed';

    if (!isNonEmptyString(source.id)) {
      say('has no id');
    } else if (!SLUG_RE.test(source.id)) {
      say(`has id ${show(source.id)} — ids use lower-case letters, digits and single dashes, like "globe-and-mail"`);
    } else if (seen.has(source.id)) {
      say(`has the same id as the ${ordinal(/** @type {number} */ (seen.get(source.id)) + 1)} source — ids must be unique`);
    } else {
      seen.set(source.id, index);
      if (isChannel && !source.id.startsWith('yt-')) say('is a YouTube channel but its id does not start with "yt-"');
    }
    if (!SOURCE_TYPES.includes(source.type)) say(`has type ${show(source.type)} — it must be ${oneOf(SOURCE_TYPES)}`);
    if (!isNonEmptyString(source.name)) say('has no name — a short display name like "BBC" is needed');
    if (isFeed && !isHttpUrl(source.url)) say(`has url ${show(source.url)} — a feed url must start with http:// or https://`);
    if (isChannel && !isYoutubeUrl(source.url)) say(`has url ${show(source.url)} — a channel url must be on youtube.com, like https://www.youtube.com/@CBCNews`);
    if (source.siteUrl !== undefined && source.siteUrl !== null && !isHttpUrl(source.siteUrl)) say(`has siteUrl ${show(source.siteUrl)} — it must start with http:// or https://`);
    checkSourceCategory(source, tree, say);
    if (!(typeof source.country === 'string' && COUNTRY_RE.test(source.country))) say(`has country ${show(source.country)} — it must be two upper-case letters like CA`);
    if (!(typeof source.language === 'string' && LANGUAGE_RE.test(source.language))) say(`has language ${show(source.language)} — it must be two lower-case letters like en`);
    if (!SOURCE_STATUSES.includes(source.status)) {
      say(`has status ${show(source.status)} — it must be ${oneOf(SOURCE_STATUSES)}`);
    } else if (isFeed && source.status === 'waiting_for_key') {
      say('is a feed with status waiting_for_key — only YouTube channels wait for a key');
    }
    if (!isIso(source.addedAt)) say(`has addedAt ${show(source.addedAt)} — it must be a full date and time like ${ISO_EXAMPLE}`);
    if (source.fetch === null) {
      // Not fetched yet.
    } else if (!isObject(source.fetch)) {
      say(`has fetch ${show(source.fetch)} — it must be null or the object written by the fetcher`);
    } else {
      const missing = FETCH_FIELDS.filter((field) => !(field in source.fetch));
      if (missing.length) say(`has a fetch object without ${oneOf(missing.map((f) => `"${f}"`))} — it must have all of ${FETCH_FIELDS.join(', ')}`);
      else checkFetchState(source.fetch, say);
    }
    if (isChannel) checkChannelIdentity(source, say);
    if (isFeed) {
      for (const field of ['handle', 'channelId']) {
        if (source[field] !== undefined && source[field] !== null) warn(`has a ${field} — only YouTube channels use it, so it is ignored`);
      }
    }
    if (source.notes !== undefined && typeof source.notes !== 'string') say(`has notes ${show(source.notes)} — notes must be text`);
    for (const field of Object.keys(source)) {
      if (!SOURCE_FIELDS.includes(field)) warn(`has an unknown field "${field}" — it is ignored`);
    }
  });
  return errors;
}

// ------------------------------------------------------------------ items

/**
 * @param {unknown} sources   A list of sources, or the whole sources.json document.
 * @returns {unknown[]|null}
 */
function sourceList(sources) {
  if (Array.isArray(sources)) return sources;
  if (isObject(sources) && Array.isArray(sources.sources)) return sources.sources;
  return null;
}

/**
 * @param {Record<string, any>} item
 * @param {(text: string) => void} say
 */
function checkItemFields(item, say) {
  if (!(typeof item.id === 'string' && ITEM_ID_RE.test(item.id))) say(`has id ${show(item.id)} — an item id is 16 hexadecimal characters`);
  if (!isHttpUrl(item.link)) say(`has link ${show(item.link)} — it must start with http:// or https://`);
  if (!isNonEmptyString(item.title)) say(`has title ${show(item.title)} — a title is needed`);
  else if (HTML_START_RE.test(item.title)) say('has HTML in its title — titles must be plain text');
  else if (Array.from(item.title).length > TITLE_MAX) say(`has a title of ${Array.from(item.title).length} characters — the limit is ${TITLE_MAX}`);
  for (const field of ['link', 'guid', 'thumbnail']) {
    if (typeof item[field] === 'string' && item[field].length > URL_MAX) say(`has a ${field} of ${item[field].length} characters — the limit is ${URL_MAX}`);
  }
  if (typeof item.excerpt !== 'string') {
    say(`has excerpt ${show(item.excerpt)} — it must be text (use "" when there is none)`);
  } else {
    const length = Array.from(item.excerpt).length;
    if (length > EXCERPT_MAX) say(`has an excerpt of ${length} characters — the limit is ${EXCERPT_MAX}`);
    else if (HTML_START_RE.test(item.excerpt)) say('has HTML in its excerpt — excerpts must be plain text');
  }
  if (!isIso(item.published)) say(`has published ${show(item.published)} — it must be a full date and time like ${ISO_EXAMPLE}`);
  if (item.thumbnail !== null && !isHttpUrl(item.thumbnail)) say(`has thumbnail ${show(item.thumbnail)} — it must be null or start with http:// or https://`);
  if (!ITEM_TYPES.includes(item.type)) {
    say(`has type ${show(item.type)} — it must be ${oneOf(ITEM_TYPES)}`);
  } else if (item.type === 'video') {
    if (item.videoId === undefined || item.videoId === null) say('is a video without a videoId');
    else if (!(typeof item.videoId === 'string' && VIDEO_ID_RE.test(item.videoId))) say(`has videoId ${show(item.videoId)} — a YouTube video id is 11 characters`);
  } else if (item.videoId !== undefined) {
    say('is an article but has a videoId — only videos have one');
  }
  if (!isIso(item.addedAt)) say(`has addedAt ${show(item.addedAt)} — it must be a full date and time like ${ISO_EXAMPLE}`);
  if (item.guid === undefined) say('has no guid — use null when the feed gives none');
  else if (!isStringOrNull(item.guid)) say(`has guid ${show(item.guid)} — it must be text or null`);
  for (const field of Object.keys(item)) {
    if (!ITEM_FIELDS.includes(field)) say(`has an unexpected field "${field}" — only ${ITEM_FIELDS.join(', ')} are stored`);
  }
}

/**
 * @param {Record<string, any>[]} items
 * @param {string} file
 * @returns {string|null}
 */
function findSortingError(items, file) {
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1];
    const current = items[i];
    if (!isObject(previous) || !isObject(current) || !isIso(previous.published) || !isIso(current.published)) continue;
    if (Date.parse(current.published) > Date.parse(previous.published)) {
      return `${file}: items are not sorted newest first — item ${i + 1} (${current.published}) is newer than item ${i} (${previous.published})`;
    }
  }
  return null;
}

/**
 * Validate one parsed items file (data/items/<sourceId>.json).
 * @param {unknown} doc
 * @param {{sourceId?: string, sources?: unknown, file?: string}} options
 *   `sourceId` is the file name without ".json" and must equal the document's sourceId;
 *   `sources` is the list from sources.json (or the whole document) used to detect orphan files,
 *   skipped when not given; `file` is the label used in messages.
 * @returns {string[]}  Plain-language errors; empty when valid.
 */
export function validateItems(doc, options = {}) {
  const { sourceId, sources } = options;
  const file = options.file || `items/${sourceId || 'unknown'}.json`;
  const errors = checkEnvelope(doc, file, 'items');
  if (!isObject(doc)) return errors;
  if (!isNonEmptyString(doc.sourceId)) {
    errors.push(`${file}: has no "sourceId" — it must be the source's id, the same as the file name`);
  } else {
    if (sourceId !== undefined && doc.sourceId !== sourceId) errors.push(`${file}: has sourceId "${doc.sourceId}" but the file is named ${sourceId}.json — they must match`);
    const list = sourceList(sources);
    if (list && !list.some((source) => isObject(source) && source.id === doc.sourceId)) {
      errors.push(`${file}: orphan items file — no source with the id "${doc.sourceId}" exists in sources.json`);
    }
  }
  if (!Array.isArray(doc.items)) return errors;
  /** @type {Map<string, number>} */
  const ids = new Map();
  /** @type {Map<string, number>} */
  const links = new Map();
  doc.items.forEach((item, index) => {
    const number = index + 1;
    if (!isObject(item)) {
      errors.push(`${file}: item ${number} is not an object`);
      return;
    }
    const title = isNonEmptyString(item.title) ? ` (${show(item.title.length > 40 ? `${item.title.slice(0, 39)}…` : item.title)})` : '';
    /** @param {string} text */
    const say = (text) => errors.push(`${file}: item ${number}${title} ${text}`);
    checkItemFields(item, say);
    if (typeof item.id === 'string') {
      const first = ids.get(item.id);
      if (first !== undefined) say(`has the same id as item ${first} — ids must be unique in the file`);
      else ids.set(item.id, number);
    }
    if (typeof item.link === 'string') {
      const first = links.get(item.link);
      if (first !== undefined) say(`has the same link as item ${first} — links must be unique in the file`);
      else links.set(item.link, number);
    }
  });
  const sorting = findSortingError(doc.items, file);
  if (sorting) errors.push(sorting);
  return errors;
}

// ------------------------------------------------------------------ hidden

/**
 * Validate the parsed hidden.json.
 * @param {unknown} doc
 * @param {{file?: string}} [options]
 * @returns {string[]}  Plain-language errors; empty when valid.
 */
export function validateHidden(doc, options = {}) {
  const file = options.file || 'hidden.json';
  const errors = checkEnvelope(doc, file, 'hidden');
  if (!isObject(doc) || !Array.isArray(doc.hidden)) return errors;
  doc.hidden.forEach((entry, index) => {
    const where = `hidden item ${index + 1}`;
    if (!isObject(entry)) {
      errors.push(`${file}: ${where} is not an object`);
      return;
    }
    /** @param {string} text */
    const say = (text) => errors.push(`${file}: ${where} ${text}`);
    if (!isHttpUrl(entry.link)) say(`has link ${show(entry.link)} — it must start with http:// or https://`);
    if (!isIso(entry.hiddenAt)) say(`has hiddenAt ${show(entry.hiddenAt)} — it must be a full date and time like ${ISO_EXAMPLE}`);
    for (const field of ['guid', 'sourceId']) {
      if (entry[field] !== undefined && !isStringOrNull(entry[field])) say(`has ${field} ${show(entry[field])} — it must be text or null`);
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') say(`has note ${show(entry.note)} — a note must be text`);
  });
  return errors;
}

// ------------------------------------------------------------------ runs

/**
 * Validate one parsed run log (data/runs/<time>.json).
 * @param {unknown} doc
 * @param {{file?: string}} [options]
 * @returns {string[]}  Plain-language errors; empty when valid.
 */
export function validateRun(doc, options = {}) {
  const file = options.file || 'run log';
  const errors = checkEnvelope(doc, file, 'sources');
  if (!isObject(doc)) return errors;
  for (const field of ['startedAt', 'finishedAt']) {
    if (!isIso(doc[field])) errors.push(`${file}: has ${field} ${show(doc[field])} — it must be a full date and time like ${ISO_EXAMPLE}`);
  }
  if (!isObject(doc.totals)) {
    errors.push(`${file}: has totals ${show(doc.totals)} — it must be an object with ${RUN_TOTALS.join(', ')}`);
  } else {
    for (const field of RUN_TOTALS) {
      if (!isCount(doc.totals[field])) errors.push(`${file}: has totals.${field} ${show(doc.totals[field])} — it must be a whole number, 0 or more`);
    }
  }
  if (!Array.isArray(doc.sources)) return errors;
  doc.sources.forEach((entry, index) => {
    const where = entryLabel('source', entry, index);
    if (!isObject(entry)) {
      errors.push(`${file}: ${where} is not an object`);
      return;
    }
    /** @param {string} text */
    const say = (text) => errors.push(`${file}: ${where} ${text}`);
    if (!isNonEmptyString(entry.id)) say('has no id');
    if (!FETCH_RESULTS.includes(entry.result)) say(`has result ${show(entry.result)} — it must be ${oneOf(FETCH_RESULTS)}`);
    for (const field of ['added', 'pruned', 'ms']) {
      if (!isCount(entry[field])) say(`has ${field} ${show(entry[field])} — it must be a whole number, 0 or more`);
    }
    if (!isStringOrNull(entry.error)) say(`has error ${show(entry.error)} — it must be text or null`);
  });
  return errors;
}

// ------------------------------------------------------------------ the whole data directory

/**
 * @typedef {Object} ValidationReport
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {{categories: number, sources: number, items: number, hidden: number, runs: number}} counts
 */

/**
 * Path as the owner would read it: relative to the working directory when inside it.
 * @param {string} filePath
 * @returns {string}
 */
function displayPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.split(path.sep).join('/');
  return filePath;
}

/**
 * Read and parse one JSON file.
 * @param {string} filePath
 * @param {string} label
 * @returns {{ok: true, doc: any} | {ok: false, error: string, missing: boolean}}
 */
function readJsonFile(filePath, label) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = error && typeof error === 'object' ? /** @type {any} */ (error).code : '';
    if (code === 'ENOENT') return { ok: false, error: `${label}: the file does not exist`, missing: true };
    if (code === 'EISDIR') return { ok: false, error: `${label}: this is a folder, not a file`, missing: false };
    return { ok: false, error: `${label}: cannot be read — ${error instanceof Error ? error.message : String(error)}`, missing: false };
  }
  const parsed = parseJson(text, label);
  return parsed.ok ? parsed : { ok: false, error: parsed.error, missing: false };
}

/**
 * Names of the .json files in a directory, sorted; empty when the directory does not exist.
 * @param {string} dir
 * @returns {string[]}
 */
function listJsonFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && statSync(path.join(dir, name)).isFile())
    .sort();
}

/**
 * Validate every file under a data directory: categories.json, sources.json (treated as an empty
 * list when missing), hidden.json, items/*.json and runs/*.json. Syntax errors, missing required
 * files and cross-file problems (orphan items files, two items files for one source) are reported
 * as errors, never thrown.
 * @param {string} dataDir
 * @returns {ValidationReport}
 */
export function validateAll(dataDir) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const counts = { categories: 0, sources: 0, items: 0, hidden: 0, runs: 0 };
  /** @param {...string} parts */
  const label = (...parts) => displayPath(path.join(dataDir, ...parts));

  if (!existsSync(dataDir) || !statSync(dataDir).isDirectory()) {
    errors.push(`${displayPath(dataDir)}: the data folder does not exist`);
    return { errors, warnings, counts };
  }

  const categories = readJsonFile(path.join(dataDir, 'categories.json'), label('categories.json'));
  /** @type {unknown} */
  let categoriesDoc = null;
  if (categories.ok) {
    errors.push(...validateCategories(categories.doc, { file: label('categories.json') }));
    if (isObject(categories.doc) && Array.isArray(categories.doc.categories)) {
      categoriesDoc = categories.doc;
      counts.categories = categories.doc.categories.length;
    }
  } else {
    errors.push(categories.error);
  }

  const sourcesPath = path.join(dataDir, 'sources.json');
  const sources = readJsonFile(sourcesPath, label('sources.json'));
  /** @type {unknown[]|null} */
  let sourceEntries = null;
  if (sources.ok) {
    errors.push(...validateSources(sources.doc, categoriesDoc, { file: label('sources.json'), warnings }));
    if (isObject(sources.doc) && Array.isArray(sources.doc.sources)) {
      sourceEntries = sources.doc.sources;
      counts.sources = sources.doc.sources.length;
    }
  } else if (sources.missing) {
    sourceEntries = [];
  } else {
    errors.push(sources.error);
  }

  const hidden = readJsonFile(path.join(dataDir, 'hidden.json'), label('hidden.json'));
  if (hidden.ok) {
    errors.push(...validateHidden(hidden.doc, { file: label('hidden.json') }));
    if (isObject(hidden.doc) && Array.isArray(hidden.doc.hidden)) counts.hidden = hidden.doc.hidden.length;
  } else {
    errors.push(hidden.error);
  }

  const itemsDir = path.join(dataDir, 'items');
  /** @type {Map<string, string>} */
  const itemFilesBySource = new Map();
  for (const name of listJsonFiles(itemsDir)) {
    const fileLabel = label('items', name);
    const read = readJsonFile(path.join(itemsDir, name), fileLabel);
    if (!read.ok) {
      errors.push(read.error);
      continue;
    }
    const sourceId = name.slice(0, -'.json'.length);
    errors.push(...validateItems(read.doc, { sourceId, sources: sourceEntries || undefined, file: fileLabel }));
    if (isObject(read.doc)) {
      if (Array.isArray(read.doc.items)) counts.items += read.doc.items.length;
      if (isNonEmptyString(read.doc.sourceId)) {
        const first = itemFilesBySource.get(read.doc.sourceId);
        if (first) errors.push(`${fileLabel}: a second items file for source "${read.doc.sourceId}" — ${first} already holds its items`);
        else itemFilesBySource.set(read.doc.sourceId, fileLabel);
      }
    }
  }

  const runsDir = path.join(dataDir, 'runs');
  for (const name of listJsonFiles(runsDir)) {
    const fileLabel = label('runs', name);
    const read = readJsonFile(path.join(runsDir, name), fileLabel);
    if (!read.ok) {
      errors.push(read.error);
      continue;
    }
    errors.push(...validateRun(read.doc, { file: fileLabel }));
    counts.runs += 1;
  }

  return { errors, warnings, counts };
}
