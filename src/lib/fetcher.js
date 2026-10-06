/**
 * The fetcher: downloads one source with the Curanet user agent, conditional headers and a time
 * limit, classifies the outcome (ok / unchanged / blocked / error), stores the new items, and runs
 * every source a few at a time.
 *
 * Rules (see CLAUDE.md): a refusal (HTTP 401, 403, 451) marks the source `blocked` and is never
 * worked around; any other failure counts as an error and the source stays active; one failing
 * source never stops the run; items older than 90 days are pruned on every run; the YouTube API
 * key never appears in a message, a run log or sources.json.
 */
import fs from 'node:fs';
import { readBodyCapped } from './http.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed, FeedParseError } from './feed.js';
import {
  entryToItem, loadItems, saveItems, mergeItems, pruneItems, listItemFiles,
  loadSources, saveSources, loadCategories, loadHidden, saveRun, pruneRuns,
} from './store.js';

/**
 * @typedef {import('./types.js').Source} Source
 * @typedef {import('./types.js').FetchState} FetchState
 * @typedef {import('./types.js').HiddenEntry} HiddenEntry
 * @typedef {import('./types.js').RunSourceResult} RunSourceResult
 * @typedef {import('./types.js').RunLog} RunLog
 * @typedef {import('./types.js').ParsedEntry & {videoId: string}} VideoEntry
 *
 * @typedef {{result: 'ok', status: number, body: string, etag: string|null, lastModified: string|null, finalUrl: string, contentType: string|null}} FetchOk
 * @typedef {{result: 'unchanged', status: 304}} FetchUnchanged
 * @typedef {{result: 'blocked', status: number, error: string}} FetchBlocked
 * @typedef {{result: 'error', status: number|null, error: string}} FetchFailed
 * @typedef {FetchOk|FetchUnchanged|FetchBlocked|FetchFailed} FetchOutcome
 *
 * @typedef {Object} YouTubeClient
 * @property {(source: Source, options: {apiKey: string, fetch?: typeof globalThis.fetch, timeoutMs?: number, maxPages?: number}) => Promise<{channelId: string, uploadsPlaylistId: string, entries: VideoEntry[]}>} fetchChannelVideos
 *
 * @typedef {Object} SourceContext
 * @property {string} dataDir
 * @property {Date} [now]                          The run's clock: addedAt, lastAttempt and pruning use it.
 * @property {typeof globalThis.fetch} [fetch]
 * @property {number} [timeoutMs]
 * @property {HiddenEntry[]} [hidden]
 * @property {(line: string) => void} [log]
 * @property {boolean} [dryRun]                    When true nothing is written to disk.
 * @property {string|null} [apiKey]                YouTube Data API key; null or missing means "no key".
 * @property {YouTubeClient} [youtube]             Injected YouTube client; defaults to ./youtube.js.
 * @property {Set<string>} [knownLinks]            Links already stored by ANY source; shared and extended during the run.
 *
 * @typedef {{source: Source, result: RunSourceResult}} SourceOutcome
 *
 * @typedef {Object} RunOptions
 * @property {string} [dataDir]
 * @property {number} [concurrency]                Sources downloaded at the same time (default 4).
 * @property {string[]|null} [only]                Restrict the run to these source ids.
 * @property {Date} [now]
 * @property {typeof globalThis.fetch} [fetch]
 * @property {number} [timeoutMs]
 * @property {string|null} [apiKey]                Defaults to process.env.YOUTUBE_API_KEY; pass null for "no key".
 * @property {boolean} [dryRun]
 * @property {(line: string) => void} [log]        Receives one formatted line per source.
 * @property {YouTubeClient} [youtube]
 */

/** The version Curanet announces: major.minor from package.json, or 0.1 when it cannot be read. */
function readVersion() {
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const match = /^(\d+)\.(\d+)/.exec(String(JSON.parse(fs.readFileSync(file, 'utf8')).version || ''));
    if (match) return `${match[1]}.${match[2]}`;
  } catch {
    // fall through to the default
  }
  return '0.1';
}

export const USER_AGENT = `Curanet/${readVersion()} (+https://curanet.io)`;
export const ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_CONCURRENCY = 4;

// ------------------------------------------------------------------ one request

/**
 * @param {number} status
 * @returns {'ok'|'unchanged'|'blocked'|'error'}
 */
export function classifyHttpStatus(status) {
  // 202/204/205 carry no feed body; publishers' bot checks answer this way, so it counts as a refusal.
  if (status === 202 || status === 204 || status === 205) return 'blocked';
  if (status >= 200 && status <= 299) return 'ok';
  if (status === 304) return 'unchanged';
  if (status === 401 || status === 403 || status === 451) return 'blocked';
  return 'error';
}

/** @param {unknown} error @returns {string} */
function describeError(error) {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** @param {unknown} error @returns {boolean} */
function isAbortError(error) {
  const name = typeof error === 'object' && error !== null ? /** @type {any} */ (error).name : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * "fetch failed: getaddrinfo ENOTFOUND host (ENOTFOUND)" style text from a network error.
 * @param {unknown} error
 * @returns {string}
 */
function describeNetworkError(error) {
  let text = describeError(error);
  const cause = error instanceof Error ? /** @type {any} */ (error).cause : null;
  if (cause) {
    const causeMessage = describeError(cause);
    if (causeMessage && causeMessage !== text && !text.includes(causeMessage)) text += ': ' + causeMessage;
    if (typeof cause.code === 'string' && !text.includes(cause.code)) text += ` (${cause.code})`;
  }
  return text;
}

/** @param {number} maxBytes @returns {string} */
function tooLargeMessage(maxBytes) {
  if (maxBytes >= 1024 * 1024) return `feed larger than ${Math.round(maxBytes / (1024 * 1024))} MB`;
  if (maxBytes >= 1024) return `feed larger than ${Math.round(maxBytes / 1024)} KB`;
  return `feed larger than ${maxBytes} bytes`;
}

const readBody = readBodyCapped;

/**
 * Decode bytes using the charset from the Content-Type header, else the XML declaration, else UTF-8.
 * @param {Uint8Array} bytes
 * @param {string|null} contentType
 * @returns {string}
 */
function decodeBody(bytes, contentType) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  const fromHeader = /charset=["']?([\w.:-]+)/i.exec(contentType || '');
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  const fromXml = /^\s*<\?xml[^>]*encoding=["']([\w.:-]+)["']/i.exec(head);
  const label = (fromHeader && fromHeader[1]) || (fromXml && fromXml[1]) || 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** @param {Response} response */
function discardBody(response) {
  if (response.body && typeof response.body.cancel === 'function') response.body.cancel().catch(() => {});
}

/**
 * Download one source. Never throws: every failure is returned as a result.
 * @param {Source} source
 * @param {{fetch?: typeof globalThis.fetch, timeoutMs?: number, maxBytes?: number}} [options]
 * @returns {Promise<FetchOutcome>}
 */
export async function fetchSource(source, { fetch: fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!/^https?:\/\//i.test(String(source.url || ''))) {
    return { result: 'error', status: 0, error: 'the address must start with http:// or https://' };
  }
  /** @type {Record<string, string>} */
  const headers = { 'user-agent': USER_AGENT, accept: ACCEPT };
  if (source.fetch && source.fetch.etag) headers['if-none-match'] = source.fetch.etag;
  if (source.fetch && source.fetch.lastModified) headers['if-modified-since'] = source.fetch.lastModified;
  // A ref'd timer (unlike AbortSignal.timeout) keeps the process alive while a slow feed is awaited.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException(`timeout after ${timeoutMs} ms`, 'TimeoutError')), timeoutMs);
  try {
    return await fetchWithSignal(source, controller.signal, { fetchFn, timeoutMs, maxBytes, headers });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Source} source
 * @param {AbortSignal} signal
 * @param {{fetchFn: typeof globalThis.fetch, timeoutMs: number, maxBytes: number, headers: Record<string, string>}} options
 * @returns {Promise<FetchOutcome>}
 */
async function fetchWithSignal(source, signal, { fetchFn, timeoutMs, maxBytes, headers }) {
  /** @returns {FetchFailed} */
  const timedOut = () => ({ result: 'error', status: null, error: `timeout after ${timeoutMs} ms` });

  let response;
  try {
    response = await fetchFn(source.url, { headers, signal, redirect: 'follow' });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return timedOut();
    return { result: 'error', status: null, error: describeNetworkError(error) };
  }
  if (!response || typeof response.status !== 'number') return { result: 'error', status: null, error: 'no response was received' };

  const status = response.status;
  const kind = classifyHttpStatus(status);
  if (kind === 'unchanged') {
    discardBody(response);
    return { result: 'unchanged', status: 304 };
  }
  if (kind === 'blocked') {
    discardBody(response);
    const reason = status === 202 || status === 204 || status === 205 ? `HTTP ${status} (answered without content — usually a bot check)` : `HTTP ${status}`;
    return { result: 'blocked', status, error: reason };
  }
  if (kind === 'error') {
    discardBody(response);
    return { result: 'error', status, error: `HTTP ${status}${response.statusText ? ' ' + response.statusText : ''}` };
  }

  const declaredLength = Number(response.headers.get('content-length'));
  if (declaredLength > maxBytes) {
    discardBody(response);
    return { result: 'error', status, error: tooLargeMessage(maxBytes) };
  }
  let bytes;
  try {
    bytes = await readBody(response, maxBytes);
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return timedOut();
    return { result: 'error', status, error: 'could not read the response: ' + describeNetworkError(error) };
  }
  if (bytes === null) return { result: 'error', status, error: tooLargeMessage(maxBytes) };
  const contentType = response.headers.get('content-type');
  return {
    result: 'ok',
    status,
    body: decodeBody(bytes, contentType),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    finalUrl: response.url || source.url,
    contentType,
  };
}

// ------------------------------------------------------------------ one source

/** @returns {FetchState} */
function emptyFetchState() {
  return { etag: null, lastModified: null, lastAttempt: null, lastSuccess: null, lastResult: null, lastError: null, failures: 0 };
}

/**
 * The source's fetch state with this attempt recorded.
 * @param {Source} source
 * @param {string} nowIso
 * @returns {FetchState}
 */
function attemptState(source, nowIso) {
  const state = { ...emptyFetchState(), ...(source.fetch || {}), lastAttempt: nowIso };
  state.failures = Number(state.failures) || 0;
  return state;
}

/** @param {number} started @returns {number} whole milliseconds since `started` */
function elapsed(started) {
  return Math.max(0, Math.round(Date.now() - started));
}

/**
 * @param {string} id
 * @param {RunSourceResult['result']} result
 * @param {{added?: number, pruned?: number, ms?: number, error?: string|null}} [details]
 * @returns {RunSourceResult}
 */
function sourceResult(id, result, { added = 0, pruned = 0, ms = 0, error = null } = {}) {
  return { id, result, added, pruned, ms, error };
}

/**
 * Why a source is not fetched, or null when it is active.
 * @param {Source} source
 * @returns {string|null}
 */
function skipReason(source) {
  switch (source.status) {
    case 'active': return null;
    case 'paused': return 'paused';
    case 'blocked': return source.fetch && source.fetch.lastAttempt ? `blocked since ${source.fetch.lastAttempt}` : 'blocked';
    case 'waiting_for_key': return 'waiting for key';
    default: return `status "${source.status}" is not fetched`;
  }
}

/** @param {Source} source @param {string} reason @returns {SourceOutcome} */
function skipped(source, reason) {
  return { source, result: sourceResult(source.id, 'skipped', { error: reason }) };
}

/**
 * @param {Source} source
 * @param {FetchState} state
 * @param {string} message
 * @param {number} started
 * @returns {SourceOutcome}
 */
function failed(source, state, message, started) {
  return {
    source: { ...source, fetch: { ...state, lastResult: 'error', lastError: message, failures: state.failures + 1 } },
    result: sourceResult(source.id, 'error', { ms: elapsed(started), error: message }),
  };
}

/**
 * Merge new items into the source's file, prune old ones and write the file when anything changed.
 * @param {string} sourceId
 * @param {(import('./types.js').Item|null)[]} incoming
 * @param {SourceContext} ctx
 * @returns {{added: number, pruned: number}}
 */
function storeItems(sourceId, incoming, { dataDir, now = new Date(), hidden = [], dryRun = false, knownLinks }) {
  const stored = loadItems(dataDir, sourceId);
  const present = incoming.filter((item) => item !== null && item !== undefined);
  // Entries the feed still carries but that are already older than 90 days are never added, so
  // they are neither counted as new nor re-pruned on every run.
  const fresh = pruneItems(present, { now }).items;
  const merged = mergeItems(stored.items, fresh, { hidden, sourceId, now, knownLinks });
  // An item the feed gave no date (published = addedAt) stays as long as the feed still lists it;
  // otherwise it would come back as "new" 90 days after it was first seen.
  const listed = new Set(present.map((item) => item.link));
  const pruned = pruneItems(merged.items, { now, keep: (item) => item.published === item.addedAt && listed.has(item.link) });
  if (!dryRun && (merged.added > 0 || pruned.pruned > 0)) saveItems(dataDir, { ...stored, items: pruned.items });
  return { added: merged.added, pruned: pruned.pruned };
}

/**
 * Fetch one RSS/Atom source and store what is new. Returns an updated copy of the source (the one
 * given is never changed) and the line for the run log.
 * @param {Source} source
 * @param {SourceContext} ctx
 * @returns {Promise<SourceOutcome>}
 */
export async function processFeedSource(source, ctx) {
  const reason = skipReason(source);
  if (reason) return skipped(source, reason);
  const now = ctx.now || new Date();
  const nowIso = now.toISOString();
  const started = Date.now();
  const fetched = await fetchSource(source, { fetch: ctx.fetch, timeoutMs: ctx.timeoutMs });
  const state = attemptState(source, nowIso);

  if (fetched.result === 'blocked') {
    return {
      source: { ...source, status: 'blocked', fetch: { ...state, lastResult: 'blocked', lastError: fetched.error, failures: state.failures + 1 } },
      result: sourceResult(source.id, 'blocked', { ms: elapsed(started), error: fetched.error }),
    };
  }
  if (fetched.result === 'error') return failed(source, state, fetched.error, started);
  if (fetched.result === 'unchanged') {
    const { pruned } = storeItems(source.id, [], ctx);
    return {
      source: { ...source, fetch: { ...state, lastSuccess: nowIso, lastResult: 'unchanged', lastError: null, failures: 0 } },
      result: sourceResult(source.id, 'unchanged', { pruned, ms: elapsed(started) }),
    };
  }

  let parsed;
  try {
    parsed = parseFeed(fetched.body, { baseUrl: fetched.finalUrl || source.url });
  } catch (error) {
    const message = error instanceof FeedParseError ? error.message : 'could not read the feed: ' + describeError(error);
    return failed(source, state, message, started);
  }
  const items = parsed.entries.map((entry) => entryToItem(entry, { now }));
  const { added, pruned } = storeItems(source.id, items, ctx);
  const fetch = { etag: fetched.etag, lastModified: fetched.lastModified, lastAttempt: nowIso, lastSuccess: nowIso, lastResult: /** @type {'ok'} */ ('ok'), lastError: null, failures: 0 };
  return { source: { ...source, fetch }, result: sourceResult(source.id, 'ok', { added, pruned, ms: elapsed(started) }) };
}

/**
 * Remove every trace of the API key from a message (plain and URL-encoded).
 * @param {string} text
 * @param {string|null|undefined} apiKey
 * @returns {string}
 */
function redactKey(text, apiKey) {
  if (!apiKey) return text;
  return text.split(apiKey).join('[key hidden]').split(encodeURIComponent(apiKey)).join('[key hidden]');
}

/**
 * The message for a failed YouTube call, with Google's reason code when the client gave one.
 * @param {unknown} error
 * @returns {string}
 */
function describeApiError(error) {
  const message = describeError(error);
  const reason = typeof error === 'object' && error !== null && typeof (/** @type {any} */ (error)).reason === 'string' ? /** @type {any} */ (error).reason : null;
  return reason && !message.includes(reason) ? `${message} (${reason})` : message;
}

/** @returns {Promise<YouTubeClient>} */
async function defaultYouTubeClient() {
  return import('./youtube.js');
}

/**
 * Fetch one YouTube channel through the Data API and store its latest uploads as videos.
 * Without an API key the channel is skipped and keeps waiting. API failures (quota, bad key,
 * forbidden) are errors, never blocks, and the key never appears in any message.
 * @param {Source} source
 * @param {SourceContext} ctx
 * @returns {Promise<SourceOutcome>}
 */
export async function processYouTubeSource(source, ctx) {
  if (source.status === 'paused' || source.status === 'blocked') return skipped(source, /** @type {string} */ (skipReason(source)));
  const apiKey = ctx.apiKey || null;
  if (!apiKey) return skipped(source, 'waiting for key');
  const now = ctx.now || new Date();
  const nowIso = now.toISOString();
  const started = Date.now();
  const state = attemptState(source, nowIso);
  const client = ctx.youtube || await defaultYouTubeClient();

  let videos;
  try {
    videos = await client.fetchChannelVideos(source, { apiKey, fetch: ctx.fetch, timeoutMs: ctx.timeoutMs, maxPages: 1 });
  } catch (error) {
    return failed(source, state, redactKey(describeApiError(error), apiKey), started);
  }
  const items = videos.entries.map((entry) => entryToItem(entry, { now, type: 'video', videoId: entry.videoId }));
  const { added, pruned } = storeItems(source.id, items, ctx);
  /** @type {Source} */
  const updated = {
    ...source,
    status: 'active',
    fetch: { etag: null, lastModified: null, lastAttempt: nowIso, lastSuccess: nowIso, lastResult: 'ok', lastError: null, failures: 0 },
  };
  if (!source.channelId && videos.channelId) updated.channelId = videos.channelId;
  return { source: updated, result: sourceResult(source.id, 'ok', { added, pruned, ms: elapsed(started) }) };
}

/**
 * Process one source of either type; an unexpected exception becomes an error result so the run
 * goes on.
 * @param {Source} source
 * @param {SourceContext} ctx
 * @returns {Promise<SourceOutcome>}
 */
async function processSourceSafely(source, ctx) {
  const started = Date.now();
  try {
    return source.type === 'youtube_channel' ? await processYouTubeSource(source, ctx) : await processFeedSource(source, ctx);
  } catch (error) {
    const message = redactKey('unexpected problem: ' + describeError(error), ctx.apiKey);
    return failed(source, attemptState(source, (ctx.now || new Date()).toISOString()), message, started);
  }
}

// ------------------------------------------------------------------ the run

/**
 * Run `worker` over `items` with at most `limit` in flight; results keep the input order.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
async function mapWithPool(items, limit, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  const size = Math.max(1, Math.min(items.length, Math.floor(limit) || 1));
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: size }, lane));
  return results;
}

/**
 * @param {RunSourceResult[]} results
 * @returns {RunLog['totals']}
 */
function totalsOf(results) {
  const totals = { sources: results.length, fetched: 0, unchanged: 0, added: 0, pruned: 0, blocked: 0, errors: 0, skipped: 0 };
  for (const entry of results) {
    totals.added += entry.added;
    totals.pruned += entry.pruned;
    if (entry.result === 'ok' || entry.result === 'unchanged') totals.fetched += 1;
    if (entry.result === 'unchanged') totals.unchanged += 1;
    if (entry.result === 'blocked') totals.blocked += 1;
    if (entry.result === 'error') totals.errors += 1;
    if (entry.result === 'skipped') totals.skipped += 1;
  }
  return totals;
}

/**
 * One terminal line for a source result, e.g. "ok        globe-and-mail-canada  +12  (812 ms)".
 * @param {RunSourceResult} result
 * @param {{idWidth?: number}} [options]  Pad ids to this width so columns line up.
 * @returns {string}
 */
export function formatSourceLine(result, { idWidth = 0 } = {}) {
  const label = (result.result === 'blocked' ? 'BLOCKED' : result.result).padEnd(9);
  const id = result.id.padEnd(idWidth);
  if (result.result === 'ok' || result.result === 'unchanged') {
    const counts = `+${result.added}` + (result.pruned > 0 ? ` -${result.pruned}` : '');
    return `${label} ${id}  ${counts}  (${result.ms} ms)`;
  }
  return `${label} ${id}  ${result.error || ''}`.trimEnd();
}

/**
 * The totals line, e.g. "5 sources: 1 fetched (0 unchanged), 3 added, 0 pruned, 1 blocked, 1 error, 2 skipped".
 * @param {RunLog['totals']} totals
 * @returns {string}
 */
export function formatTotals(totals) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `${plural(totals.sources, 'source')}: ${totals.fetched} fetched (${totals.unchanged} unchanged), ${totals.added} added, ${totals.pruned} pruned, ${totals.blocked} blocked, ${plural(totals.errors, 'error')}, ${totals.skipped} skipped`;
}

/**
 * The whole run: load the data files (the only step that can throw), process every selected
 * source a few at a time, then write sources.json, the run log and prune old run logs.
 * @param {RunOptions} [options]
 * @returns {Promise<RunLog>}
 * @throws {Error} when sources.json, categories.json or hidden.json is missing or invalid; nothing has been written then.
 */
export async function runFetch({
  dataDir = 'data',
  concurrency = DEFAULT_CONCURRENCY,
  only = null,
  now = new Date(),
  fetch: fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiKey = process.env.YOUTUBE_API_KEY,
  dryRun = false,
  log = () => {},
  youtube,
} = {}) {
  const startedMs = Date.now();
  const startedAt = now.toISOString();
  const sourcesDoc = loadSources(dataDir);
  loadCategories(dataDir);
  const hidden = loadHidden(dataDir).hidden;

  const wanted = only ? new Set(only) : null;
  const selected = sourcesDoc.sources.filter((source) => !wanted || wanted.has(source.id));
  if (wanted) {
    for (const id of wanted) {
      if (!sourcesDoc.sources.some((source) => source.id === id)) log(`No source has the id "${id}"; it was left out.`);
    }
  }
  const idWidth = selected.reduce((width, source) => Math.max(width, source.id.length), 0);
  // Every link already stored by any source, so the same story is never kept twice across sources.
  const knownLinks = new Set();
  for (const id of listItemFiles(dataDir)) {
    for (const item of loadItems(dataDir, id).items) knownLinks.add(item.link);
  }
  /** @type {SourceContext} */
  const ctx = { dataDir, now, fetch: fetchFn, timeoutMs, hidden, log, dryRun, apiKey: apiKey || null, youtube, knownLinks };

  const outcomes = await mapWithPool(selected, concurrency, async (source) => {
    const outcome = await processSourceSafely(source, ctx);
    log(formatSourceLine(outcome.result, { idWidth }));
    return outcome;
  });

  const updatedById = new Map(outcomes.map((outcome) => [outcome.source.id, outcome.source]));
  const sources = sourcesDoc.sources.map((source) => updatedById.get(source.id) || source);
  const results = outcomes.map((outcome) => outcome.result);
  /** @type {RunLog} */
  const runLog = {
    version: 1,
    startedAt,
    finishedAt: new Date(now.getTime() + (Date.now() - startedMs)).toISOString(),
    totals: totalsOf(results),
    sources: results,
  };
  if (!dryRun) {
    saveSources(dataDir, { ...sourcesDoc, sources });
    saveRun(dataDir, runLog);
    pruneRuns(dataDir, { now });
  }
  return runLog;
}
