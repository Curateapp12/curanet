/**
 * The store: everything that reads or writes the files under `data/`.
 *
 * - JSON files are read with plain-language errors (file name, line and column) and written
 *   atomically (temp file, then rename) with a 2-space indent and a trailing newline.
 * - Items are deduplicated against the stored and hidden lists (same link, or same guid within the
 *   same source), pruned after 90 days and kept newest first.
 * - Items on disk never carry category, country or language; `attachSourceFields` adds them at
 *   build time from the item's source.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeLink, itemIdFromLink, truncate } from './sanitize.js';

/**
 * @typedef {import('./types.js').Item} Item
 * @typedef {import('./types.js').Source} Source
 * @typedef {import('./types.js').Category} Category
 * @typedef {import('./types.js').HiddenEntry} HiddenEntry
 * @typedef {import('./types.js').ParsedEntry} ParsedEntry
 * @typedef {import('./types.js').RunLog} RunLog
 *
 * @typedef {{version: number, sources: Source[]}} SourcesDoc
 * @typedef {{version: number, categories: Category[]}} CategoriesDoc
 * @typedef {{version: number, hidden: HiddenEntry[]}} HiddenDoc
 * @typedef {{version: number, sourceId: string, items: Item[]}} ItemsDoc
 * @typedef {Item & {sourceId: string, sourceName: string, category: string, subcategory: string, country: string, language: string}} TaggedItem
 *
 * @typedef {Object} DataPaths
 * @property {string} root
 * @property {string} sources
 * @property {string} categories
 * @property {string} hidden
 * @property {string} itemsDir
 * @property {string} runsDir
 * @property {(sourceId: string) => string} itemsFile
 */

const DAY_MS = 24 * 3600 * 1000;
const EXCERPT_MAX = 300;
const ITEM_ID_RE = /^[0-9a-f]{16}$/;
const RUN_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json$/;

// ------------------------------------------------------------------ paths and JSON files

/**
 * Where every data file lives under a data directory.
 * @param {string} dataDir
 * @returns {DataPaths}
 */
const SOURCE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Longest link, guid or thumbnail address stored; longer ones are refused. */
export const URL_MAX = 2048;
/** Longest title stored, in code points. */
export const TITLE_MAX = 300;

export function dataPaths(dataDir) {
  const itemsDir = path.join(dataDir, 'items');
  return {
    root: dataDir,
    sources: path.join(dataDir, 'sources.json'),
    categories: path.join(dataDir, 'categories.json'),
    hidden: path.join(dataDir, 'hidden.json'),
    itemsDir,
    runsDir: path.join(dataDir, 'runs'),
    itemsFile: (sourceId) => {
      if (!SOURCE_ID_RE.test(String(sourceId))) throw new Error(`"${sourceId}" is not a valid source id (lower-case letters, digits and dashes only)`);
      return path.join(itemsDir, `${sourceId}.json`);
    },
  };
}

/**
 * The file as the owner would name it: relative to the working directory when it is inside it.
 * @param {string} filePath
 * @returns {string}
 */
function describeFile(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

/** @param {unknown} error @returns {boolean} */
function isMissingFile(error) {
  return typeof error === 'object' && error !== null && /** @type {any} */ (error).code === 'ENOENT';
}

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Index of the first character where a JSON text stops being valid, or -1 when it is valid.
 * JSON.parse's own messages do not always say where the problem is, so this small scanner finds it.
 * @param {string} text
 * @returns {number}
 */
function jsonErrorIndex(text) {
  const length = text.length;
  let i = 0;
  let errorAt = -1;
  const fail = () => { errorAt = Math.min(i, length); return false; };
  const skipSpace = () => { while (i < length && ' \t\n\r'.includes(text[i])) i += 1; };
  /** @returns {boolean} */
  const readString = () => {
    i += 1;
    while (i < length) {
      const c = text[i];
      if (c === '"') { i += 1; return true; }
      if (c < ' ') return fail();
      if (c === '\\') {
        const next = text[i + 1];
        if (next === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { i += 1; return fail(); }
          i += 6;
        } else if (next !== undefined && '"\\/bfnrt'.includes(next)) {
          i += 2;
        } else {
          i += 1;
          return fail();
        }
        continue;
      }
      i += 1;
    }
    return fail();
  };
  /** @returns {boolean} */
  const readValue = () => {
    skipSpace();
    if (i >= length) return fail();
    const c = text[i];
    if (c === '{') return readObject();
    if (c === '[') return readArray();
    if (c === '"') return readString();
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (number && number[0]) { i += number[0].length; return true; }
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) { i += word.length; return true; }
    }
    return fail();
  };
  /** @returns {boolean} */
  const readObject = () => {
    i += 1;
    skipSpace();
    if (text[i] === '}') { i += 1; return true; }
    for (;;) {
      skipSpace();
      if (text[i] !== '"') return fail();
      if (!readString()) return false;
      skipSpace();
      if (text[i] !== ':') return fail();
      i += 1;
      if (!readValue()) return false;
      skipSpace();
      if (text[i] === ',') { i += 1; continue; }
      if (text[i] === '}') { i += 1; return true; }
      return fail();
    }
  };
  /** @returns {boolean} */
  const readArray = () => {
    i += 1;
    skipSpace();
    if (text[i] === ']') { i += 1; return true; }
    for (;;) {
      if (!readValue()) return false;
      skipSpace();
      if (text[i] === ',') { i += 1; continue; }
      if (text[i] === ']') { i += 1; return true; }
      return fail();
    }
  };
  if (!readValue()) return errorAt;
  skipSpace();
  return i < length ? i : -1;
}

/**
 * @param {string} text
 * @param {number} index
 * @returns {{line: number, column: number}} 1-based
 */
function lineAndColumn(text, index) {
  const before = text.slice(0, Math.max(0, index));
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, column: index - lastBreak };
}

/**
 * Read and parse a JSON file.
 * @param {string} filePath
 * @param {any} [fallback]   Returned when the file does not exist. Without one, a missing file is an error.
 * @returns {any}
 * @throws {Error} A plain-language message naming the file, and the line and column of a syntax error.
 */
export function readJson(filePath, fallback) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      if (fallback !== undefined) return fallback;
      throw new Error(`Cannot find the file ${describeFile(filePath)}.`, { cause: error });
    }
    throw new Error(`Cannot read the file ${describeFile(filePath)}: ${errorMessage(error)}`, { cause: error });
  }
  const source = text.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(source);
  } catch (error) {
    const index = jsonErrorIndex(source);
    const where = index >= 0 ? lineAndColumn(source, index) : null;
    const position = where ? ` at line ${where.line}, column ${where.column}` : '';
    throw new Error(`The file ${describeFile(filePath)} is not valid JSON${position}: ${errorMessage(error)}. Look for a missing comma, quote or bracket near that spot.`, { cause: error });
  }
}

/**
 * Write a value as pretty JSON (2-space indent, trailing newline). The file is written to a
 * temporary name first and then renamed, so a crash never leaves a half-written file. Parent
 * directories are created as needed.
 * @param {string} filePath
 * @param {unknown} value
 */
export function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const temp = path.join(dir, `.${path.basename(filePath)}.${unique}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
    fs.renameSync(temp, filePath);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

/**
 * Names (without ".json") of the JSON files in a directory, sorted; empty when it does not exist.
 * @param {string} dir
 * @returns {string[]}
 */
function listJsonNames(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  return names.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort();
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {string} file
 * @param {unknown} doc
 * @param {string} listName
 * @returns {Record<string, any>}
 */
function requireList(file, doc, listName) {
  if (!isObject(doc) || !Array.isArray(doc[listName])) {
    throw new Error(`The file ${describeFile(file)} should contain a "${listName}" list, like { "version": 1, "${listName}": [ ... ] }.`);
  }
  return doc;
}

// ------------------------------------------------------------------ documents

/**
 * @param {string} dataDir
 * @returns {SourcesDoc}
 * @throws {Error} when sources.json is missing or not a sources document.
 */
export function loadSources(dataDir) {
  const file = dataPaths(dataDir).sources;
  return /** @type {SourcesDoc} */ (requireList(file, readJson(file), 'sources'));
}

/**
 * @param {string} dataDir
 * @param {SourcesDoc} doc
 */
export function saveSources(dataDir, doc) {
  writeJson(dataPaths(dataDir).sources, { version: doc.version ?? 1, sources: doc.sources });
}

/**
 * @param {string} dataDir
 * @returns {CategoriesDoc}
 * @throws {Error} when categories.json is missing or not a categories document.
 */
export function loadCategories(dataDir) {
  const file = dataPaths(dataDir).categories;
  return /** @type {CategoriesDoc} */ (requireList(file, readJson(file), 'categories'));
}

/**
 * @param {string} dataDir
 * @returns {HiddenDoc}
 * @throws {Error} when hidden.json is missing or not a hidden document.
 */
export function loadHidden(dataDir) {
  const file = dataPaths(dataDir).hidden;
  return /** @type {HiddenDoc} */ (requireList(file, readJson(file), 'hidden'));
}

/**
 * @param {string} dataDir
 * @param {HiddenDoc} doc
 */
export function saveHidden(dataDir, doc) {
  writeJson(dataPaths(dataDir).hidden, { version: doc.version ?? 1, hidden: doc.hidden });
}

/**
 * The items of one source; an empty document when the source has no file yet.
 * @param {string} dataDir
 * @param {string} sourceId
 * @returns {ItemsDoc}
 */
export function loadItems(dataDir, sourceId) {
  const file = dataPaths(dataDir).itemsFile(sourceId);
  const doc = readJson(file, null);
  if (doc === null) return { version: 1, sourceId, items: [] };
  requireList(file, doc, 'items');
  return { version: typeof doc.version === 'number' ? doc.version : 1, sourceId: typeof doc.sourceId === 'string' ? doc.sourceId : sourceId, items: doc.items };
}

/**
 * Write a source's items file, newest first.
 * @param {string} dataDir
 * @param {ItemsDoc} doc
 * @returns {string} the file written
 */
export function saveItems(dataDir, doc) {
  const file = dataPaths(dataDir).itemsFile(doc.sourceId);
  writeJson(file, { version: doc.version ?? 1, sourceId: doc.sourceId, items: sortItems(doc.items) });
  return file;
}

/**
 * Delete a source's items file.
 * @param {string} dataDir
 * @param {string} sourceId
 * @returns {boolean} whether a file existed
 */
export function deleteItems(dataDir, sourceId) {
  const file = dataPaths(dataDir).itemsFile(sourceId);
  const existed = fs.existsSync(file);
  fs.rmSync(file, { force: true });
  return existed;
}

/**
 * The source ids that have an items file, sorted.
 * @param {string} dataDir
 * @returns {string[]}
 */
export function listItemFiles(dataDir) {
  return listJsonNames(dataPaths(dataDir).itemsDir);
}

// ------------------------------------------------------------------ items

/**
 * Turn a parsed feed entry (or a YouTube video entry) into a stored item.
 * @param {ParsedEntry & {videoId?: string}} entry
 * @param {{now?: Date, type?: 'article'|'video', videoId?: string}} [options]
 * @returns {Item|null} null when the entry has no usable link or title (or is a video without an id).
 */
export function entryToItem(entry, { now = new Date(), type = 'article', videoId } = {}) {
  if (!entry) return null;
  const link = normalizeLink(entry.link || '');
  const title = truncate(String(entry.title || '').trim(), TITLE_MAX);
  if (!link || !title || link.length > URL_MAX || !/^https?:\/\//.test(link)) return null;
  if (entry.guid && String(entry.guid).length > URL_MAX) return null;
  const thumbnail = entry.thumbnail && String(entry.thumbnail).length <= URL_MAX && /^https?:\/\//.test(String(entry.thumbnail)) ? entry.thumbnail : null;
  const resolvedVideoId = type === 'video' ? videoId || entry.videoId || null : null;
  if (type === 'video' && !resolvedVideoId) return null;
  const nowIso = now.toISOString();
  return {
    id: itemIdFromLink(link),
    guid: entry.guid ? String(entry.guid) : null,
    link,
    title,
    excerpt: truncate(String(entry.summary || ''), EXCERPT_MAX),
    published: entry.published || nowIso,
    thumbnail,
    type,
    ...(resolvedVideoId ? { videoId: resolvedVideoId } : {}),
    addedAt: nowIso,
  };
}

/**
 * @typedef {{links: Set<string>, guids: Set<string>, hiddenLinks: Set<string>, hiddenGuids: Set<string>}} DuplicateIndex
 */

/**
 * @param {Item[]} existing
 * @param {HiddenEntry[]} hidden
 * @param {string|undefined} sourceId
 * @returns {DuplicateIndex}
 */
function buildDuplicateIndex(existing, hidden, sourceId) {
  /** @type {DuplicateIndex} */
  const index = { links: new Set(), guids: new Set(), hiddenLinks: new Set(), hiddenGuids: new Set() };
  for (const item of existing) addToDuplicateIndex(index, item);
  for (const entry of hidden) {
    if (entry.link) {
      index.hiddenLinks.add(entry.link);
      index.hiddenLinks.add(normalizeLink(entry.link));
    }
    if (entry.guid && sourceId && entry.sourceId === sourceId) index.hiddenGuids.add(entry.guid);
  }
  return index;
}

/** @param {DuplicateIndex} index @param {Item} item */
function addToDuplicateIndex(index, item) {
  index.links.add(item.link);
  if (item.guid) index.guids.add(item.guid);
}

/** @param {DuplicateIndex} index @param {Item} item @returns {boolean} */
function inDuplicateIndex(index, item) {
  if (index.links.has(item.link) || index.hiddenLinks.has(item.link)) return true;
  return Boolean(item.guid) && (index.guids.has(/** @type {string} */ (item.guid)) || index.hiddenGuids.has(/** @type {string} */ (item.guid)));
}

/**
 * Whether an item is already stored or hidden: same link anywhere, or same guid within the source
 * (`existing` holds the items of that source; hidden guids count only with the same sourceId).
 * @param {Item} item
 * @param {{existing?: Item[], hidden?: HiddenEntry[], sourceId?: string}} context
 * @returns {boolean}
 */
export function isDuplicate(item, { existing = [], hidden = [], sourceId } = {}) {
  return inDuplicateIndex(buildDuplicateIndex(existing, hidden, sourceId), item);
}

/**
 * Add the incoming items that are not duplicates (of stored items, hidden items or each other).
 * Stored items are never changed: the first stored copy wins, even when the feed changed a title.
 * @param {Item[]} existing
 * @param {(Item|null)[]} incoming
 * @param {{hidden?: HiddenEntry[], sourceId?: string, now?: Date}} [options]
 * @returns {{items: Item[], added: number}} items sorted newest first
 */
export function mergeItems(existing, incoming, { hidden = [], sourceId, now } = {}) {
  const index = buildDuplicateIndex(existing, hidden, sourceId);
  const nowIso = (now || new Date()).toISOString();
  /** @type {Item[]} */
  const accepted = [];
  for (const item of incoming) {
    if (!item || inDuplicateIndex(index, item)) continue;
    accepted.push(item.addedAt ? item : { ...item, addedAt: nowIso });
    addToDuplicateIndex(index, item);
  }
  return { items: sortItems([...existing, ...accepted]), added: accepted.length };
}

/**
 * The time an item counts from: its published date, else when it was added.
 * @param {Item} item
 * @returns {number} milliseconds, Infinity when neither date can be read (such items are kept)
 */
function itemTime(item) {
  const published = Date.parse(item.published);
  if (!Number.isNaN(published)) return published;
  const added = Date.parse(item.addedAt);
  return Number.isNaN(added) ? Infinity : added;
}

/**
 * Drop items published strictly more than `maxAgeDays` before `now`.
 * @param {Item[]} items
 * @param {{now?: Date, maxAgeDays?: number}} [options]
 * @returns {{items: Item[], pruned: number}}
 */
export function pruneItems(items, { now = new Date(), maxAgeDays = 90 } = {}) {
  const cutoff = now.getTime() - maxAgeDays * DAY_MS;
  const kept = items.filter((item) => itemTime(item) >= cutoff);
  return { items: kept, pruned: items.length - kept.length };
}

/** @param {string|undefined} a @param {string|undefined} b @returns {number} newer first */
function compareTimesDesc(a, b) {
  const ta = Date.parse(a || '');
  const tb = Date.parse(b || '');
  if (Number.isNaN(ta) || Number.isNaN(tb)) return String(b || '').localeCompare(String(a || ''));
  return tb - ta;
}

/**
 * A new array, newest first by published date, then by addedAt, then by id so the order is stable.
 * @param {Item[]} items
 * @returns {Item[]}
 */
export function sortItems(items) {
  return [...items].sort((a, b) => compareTimesDesc(a.published, b.published)
    || compareTimesDesc(a.addedAt, b.addedAt)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The item with the fields the site needs from its source. Used by the build only; items on disk
 * never carry these.
 * @param {Item} item
 * @param {Source} source
 * @returns {TaggedItem}
 */
export function attachSourceFields(item, source) {
  return {
    ...item,
    sourceId: source.id,
    sourceName: source.name,
    category: source.category,
    subcategory: source.subcategory,
    country: source.country,
    language: source.language,
  };
}

/**
 * Hide an item: remove it from whichever items file holds it and remember its link in hidden.json
 * so no later fetch adds it back. The link is normalised first; a 16-character item id also works.
 * When nothing stored matches a link, the link is still recorded (with no guid or source).
 * @param {string} dataDir
 * @param {string} linkOrId
 * @param {{now?: Date, note?: string}} [options]
 * @returns {{removed: Item|null, sourceId: string|null}}
 */
export function hideItemByLink(dataDir, linkOrId, { now = new Date(), note } = {}) {
  const raw = String(linkOrId || '').trim();
  const byId = ITEM_ID_RE.test(raw);
  const link = byId ? null : normalizeLink(raw);
  if (!byId && !/^https?:\/\//.test(link || '')) throw new Error(`"${raw.slice(0, 80)}" is not a web address (http:// or https://) or a 16-character item id`);
  const id = byId ? raw : itemIdFromLink(/** @type {string} */ (link));
  /** @type {Item|null} */
  let removed = null;
  /** @type {string|null} */
  let sourceId = null;
  for (const candidate of listItemFiles(dataDir)) {
    const doc = loadItems(dataDir, candidate);
    const matches = doc.items.filter((item) => item.id === id || (link !== null && item.link === link));
    if (matches.length === 0) continue;
    if (!removed) {
      removed = matches[0];
      sourceId = candidate;
    }
    saveItems(dataDir, { ...doc, items: doc.items.filter((item) => !matches.includes(item)) });
  }
  const hiddenLink = removed ? removed.link : link;
  if (!hiddenLink) return { removed, sourceId };
  const hiddenDoc = loadHidden(dataDir);
  if (!hiddenDoc.hidden.some((entry) => entry.link === hiddenLink)) {
    /** @type {HiddenEntry} */
    const entry = { link: hiddenLink, guid: removed ? removed.guid : null, sourceId, hiddenAt: now.toISOString() };
    if (note) entry.note = note;
    hiddenDoc.hidden.push(entry);
    saveHidden(dataDir, hiddenDoc);
  }
  return { removed, sourceId };
}

// ------------------------------------------------------------------ run logs

/**
 * The run log file for a run that started at `startedAt`: data/runs/YYYY-MM-DDTHH-MM-SSZ.json.
 * @param {string} dataDir
 * @param {string} startedAt   ISO time
 * @returns {string}
 */
export function runFilePath(dataDir, startedAt) {
  const time = new Date(startedAt);
  if (Number.isNaN(time.getTime())) throw new Error(`Cannot name the run log: "${startedAt}" is not a date.`);
  return path.join(dataPaths(dataDir).runsDir, time.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z.json');
}

/**
 * @param {string} dataDir
 * @param {RunLog} runLog
 * @returns {string} the file written
 */
export function saveRun(dataDir, runLog) {
  const file = runFilePath(dataDir, runLog.startedAt);
  writeJson(file, runLog);
  return file;
}

/**
 * Paths of the run logs, newest first.
 * @param {string} dataDir
 * @returns {string[]}
 */
export function listRuns(dataDir) {
  const dir = dataPaths(dataDir).runsDir;
  return listJsonNames(dir)
    .map((name) => `${name}.json`)
    .filter((name) => RUN_FILE_RE.test(name))
    .sort()
    .reverse()
    .map((name) => path.join(dir, name));
}

/** @param {string} name @returns {number|null} the run time encoded in a run file name */
function runFileTime(name) {
  const match = RUN_FILE_RE.exec(name);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

/**
 * Delete run logs older than `maxAgeDays`.
 * @param {string} dataDir
 * @param {{now?: Date, maxAgeDays?: number}} [options]
 * @returns {number} how many were deleted
 */
export function pruneRuns(dataDir, { now = new Date(), maxAgeDays = 90 } = {}) {
  const cutoff = now.getTime() - maxAgeDays * DAY_MS;
  let deleted = 0;
  for (const file of listRuns(dataDir)) {
    const time = runFileTime(path.basename(file));
    if (time === null || time >= cutoff) continue;
    fs.rmSync(file, { force: true });
    deleted += 1;
  }
  return deleted;
}
