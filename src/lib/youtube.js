/**
 * YouTube client: the Data API v3 (channels.list → uploads playlist → playlistItems.list) for
 * channels, and the oEmbed endpoint for single videos added by link.
 *
 * Rules (see CLAUDE.md): never call search.list, never read channel pages or the keyless
 * `/feeds/videos.xml`. The API key travels only in the query string and is redacted from every
 * error message. Every text that comes back from YouTube is HTML-stripped before it is returned.
 */
import { stripHtml, toIso, normalizeLink, itemIdFromLink } from './sanitize.js';
import { readBodyCapped } from './http.js';

/** Largest answer accepted from YouTube's endpoints. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

const USER_AGENT = 'Curanet/0.1 (+https://curanet.io)';
const API_BASE = 'https://www.googleapis.com/youtube/v3/';
const OEMBED_URL = 'https://www.youtube.com/oembed';
const DEFAULT_TIMEOUT_MS = 10000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE = /^@[A-Za-z0-9_.-]{3,30}$/;
const VIDEO_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v']);
const PLACEHOLDER_TITLES = new Set(['Private video', 'Deleted video']);

/**
 * @typedef {Object} ApiOptions
 * @property {string|null|undefined} apiKey         The Data API key (YOUTUBE_API_KEY). Sent only in the query string.
 * @property {typeof globalThis.fetch} [fetch]      Injected for tests; defaults to the global fetch.
 * @property {number} [timeoutMs]                   Per request, default 10 000.
 *
 * @typedef {Object} UploadsOptions
 * @property {string|null|undefined} apiKey
 * @property {typeof globalThis.fetch} [fetch]
 * @property {number} [timeoutMs]
 * @property {number} [maxResults]                  Items per page, 1–50 (default 50).
 * @property {number} [maxPages]                    Pages to follow through nextPageToken (default 1).
 * @property {Date} [now]                           Reference time for date sanity checks (tests).
 *
 * @typedef {Object} ChannelSource                  The part of a Source the client needs.
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [url]                         The channel page, e.g. https://www.youtube.com/@CBCNews
 * @property {string|null} [handle]                 "@CBCNews"
 * @property {string|null} [channelId]              "UC…" once known
 *
 * @typedef {Object} OEmbedInfo
 * @property {string} videoId
 * @property {string} url                           Canonical watch url.
 * @property {string} title                         As YouTube gave it (strip before storing; oembedToItem does).
 * @property {string} channel                       author_name
 * @property {string} channelUrl                    author_url
 * @property {string|null} thumbnail                thumbnail_url
 *
 * @typedef {Object} ResolvedChannel
 * @property {string} channelId
 * @property {string} uploadsPlaylistId
 * @property {string} title
 * @property {string|null} handle
 *
 * @typedef {import('./types.js').ParsedEntry & {videoId: string}} VideoEntry
 *
 * @typedef {Object} ChannelVideos
 * @property {string} channelId
 * @property {string} uploadsPlaylistId
 * @property {VideoEntry[]} entries
 */

/** A failed call to the YouTube Data API, with the HTTP status and Google's reason code when known. */
export class YouTubeApiError extends Error {
  /**
   * @param {string} message                                   Plain language, key already redacted.
   * @param {{status?: number|null, reason?: string|null}} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'YouTubeApiError';
    /** @type {number|null} HTTP status, or null when no answer came back (timeout, network, bad input). */
    this.status = details.status ?? null;
    /** @type {string|null} Google's reason ('quotaExceeded', 'keyInvalid', …) or Curanet's own ('timeout', 'network', 'missingKey', 'notFound'). */
    this.reason = details.reason ?? null;
  }
}

/** A failed oEmbed lookup for a single video. */
export class OEmbedError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number|null}} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'OEmbedError';
    /** @type {number|null} HTTP status (401 private/unavailable, 404 not found, 400 bad id) or null when no answer came back. */
    this.status = details.status ?? null;
  }
}

// ---------------------------------------------------------------------------------------------
// Links and ids

/** @param {string} hostname @returns {boolean} */
function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return host === 'youtube.com' || host.endsWith('.youtube.com')
    || host === 'youtu.be'
    || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
}

/**
 * Parse text as a YouTube http(s) URL; a missing scheme is tolerated ("youtu.be/…").
 * @param {string} raw
 * @returns {URL|null}
 */
function parseYouTubeUrl(raw) {
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isYouTubeHost(url.hostname)) return null;
  return url;
}

/** @param {string} text @returns {string} */
function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Extract the 11-character video id from a bare id or any common YouTube link
 * (watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/, on www., m., music. and youtube-nocookie).
 * Channel links, playlists without v=, other sites and random strings give null.
 * @param {unknown} input
 * @returns {string|null}
 */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (VIDEO_ID.test(raw)) return raw;
  const url = parseYouTubeUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate = null;
  if (host === 'youtu.be') candidate = segments[0] || null;
  else if (segments[0] === 'watch') candidate = url.searchParams.get('v');
  else if (VIDEO_PATH_PREFIXES.has(segments[0])) candidate = segments[1] || null;
  if (!candidate) return null;
  candidate = safeDecode(candidate).trim();
  return VIDEO_ID.test(candidate) ? candidate : null;
}

/**
 * The link stored for a video.
 * @param {string} videoId
 * @returns {string}
 */
export function canonicalVideoUrl(videoId) {
  return 'https://www.youtube.com/watch?v=' + videoId;
}

/**
 * The standard 480×360 thumbnail, which exists for every public video.
 * @param {string} videoId
 * @returns {string}
 */
export function thumbnailUrl(videoId) {
  return 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
}

/** @param {unknown} value @returns {string|null} '@Handle' when it looks like one */
function normaliseHandle(value) {
  if (typeof value !== 'string') return null;
  let handle = value.trim();
  if (!handle) return null;
  if (!handle.startsWith('@')) handle = '@' + handle;
  return HANDLE.test(handle) ? handle : null;
}

/**
 * The "@Handle" from a channel page link (https://www.youtube.com/@Handle[/videos]), or a bare
 * "@Handle". Legacy /c/Name, /user/Name and /channel/UC… links give null.
 * @param {unknown} url
 * @returns {string|null}
 */
export function channelHandleFromUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  if (raw.startsWith('@')) return normaliseHandle(raw);
  const parsed = parseYouTubeUrl(raw);
  if (!parsed) return null;
  const first = parsed.pathname.split('/').filter(Boolean)[0] || '';
  if (!first.startsWith('@')) return null;
  return normaliseHandle(safeDecode(first));
}

/**
 * The "UC…" channel id from a /channel/UC… link or a bare id; null for anything else.
 * @param {unknown} url
 * @returns {string|null}
 */
export function channelIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (CHANNEL_ID.test(raw)) return raw;
  const parsed = parseYouTubeUrl(raw);
  if (!parsed) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'channel' || !segments[1]) return null;
  return CHANNEL_ID.test(segments[1]) ? segments[1] : null;
}

/**
 * Every channel's uploads playlist id is its channel id with "UC" replaced by "UU".
 * @param {string} channelId
 * @returns {string}
 */
function uploadsPlaylistIdFor(channelId) {
  return 'UU' + channelId.slice(2);
}

/** @param {ChannelSource} source @returns {string|null} */
function pickChannelId(source) {
  return channelIdFromUrl(source.channelId) || channelIdFromUrl(source.url);
}

/** @param {ChannelSource} source @returns {string|null} */
function pickHandle(source) {
  return normaliseHandle(source.handle) || channelHandleFromUrl(source.url);
}

// ---------------------------------------------------------------------------------------------
// Transport

/** @param {number} ms @returns {string} "10 seconds" */
function describeDuration(ms) {
  if (ms < 1000) return ms + ' ms';
  const seconds = Math.round(ms / 1000);
  return seconds + (seconds === 1 ? ' second' : ' seconds');
}

/** @param {unknown} error @returns {boolean} */
function isAbort(error) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

/** @param {unknown} error @returns {string} the error's message, with the cause when Node gives one */
function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = /** @type {{cause?: unknown}} */ (error).cause;
  const causeText = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return causeText && !error.message.includes(causeText) ? error.message + ' (' + causeText + ')' : error.message;
}

/**
 * Remove the API key from any text that might be shown or logged: both "key=…" in urls and the
 * bare key value.
 * @param {string} text
 * @param {string|null|undefined} apiKey
 * @returns {string}
 */
function redactKey(text, apiKey) {
  let out = String(text).replace(/([?&]key=)[^&\s"'<>]+/gi, '$1[redacted]');
  if (apiKey) out = out.split(apiKey).join('[redacted]');
  return out;
}

/** @param {string} text @returns {unknown} the parsed JSON object, or undefined when it is not one */
function parseJsonObject(text) {
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * GET a url with the Curanet user agent and a hard time limit. Throws whatever fetch throws
 * (an AbortError after the limit); the caller turns that into its own error type.
 * @param {typeof globalThis.fetch} fetchFn
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{status: number, text: string}>}
 */
async function getWithTimeout(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    const bytes = await readBodyCapped(response, MAX_RESPONSE_BYTES);
    if (bytes === null) throw new Error('the answer was larger than 1 MB');
    return { status: response.status, text: new TextDecoder().decode(bytes) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// oEmbed (single videos added by link)

/** @param {number} status @param {string} videoId @returns {string} */
function describeOEmbedStatus(status, videoId) {
  if (status === 400) return `YouTube does not recognise "${videoId}" as a valid video id.`;
  if (status === 401) return `Video ${videoId} is unavailable: it is private, or its owner does not allow it to be shown outside YouTube.`;
  if (status === 403) return `YouTube refused to describe video ${videoId} (HTTP 403).`;
  if (status === 404) return `Video ${videoId} was not found on YouTube; it may have been removed.`;
  return `YouTube answered HTTP ${status} when asked about video ${videoId}.`;
}

/**
 * Keep an address only when it is an http(s) link on youtube.com; anything else (javascript:,
 * other hosts, HTML) is dropped.
 * @param {string} value @returns {string|null}
 */
function youtubeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** @param {unknown} value @returns {string} */
function textField(value) {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

/**
 * Look a video up through YouTube's oEmbed endpoint (no key needed). Confirms the video exists
 * and is public, and gives its title, channel and thumbnail. oEmbed gives no publication date.
 * @param {string} videoUrlOrId
 * @param {{fetch?: typeof globalThis.fetch, timeoutMs?: number}} [options]
 * @returns {Promise<OEmbedInfo>}
 * @throws {OEmbedError} when the input is not a video link, or YouTube does not answer 200.
 */
export async function fetchOEmbed(videoUrlOrId, { fetch: fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const videoId = parseVideoId(videoUrlOrId);
  if (!videoId) {
    const shown = String(videoUrlOrId ?? '').trim().slice(0, 200);
    throw new OEmbedError(`"${shown}" is not a YouTube video link. Paste the address of a video (youtube.com/watch?v=… or youtu.be/…).`);
  }
  const url = canonicalVideoUrl(videoId);
  const endpoint = OEMBED_URL + '?url=' + encodeURIComponent(url) + '&format=json';
  let result;
  try {
    result = await getWithTimeout(fetchFn, endpoint, timeoutMs);
  } catch (error) {
    if (isAbort(error)) throw new OEmbedError(`YouTube did not answer within ${describeDuration(timeoutMs)} when asked about video ${videoId}.`);
    throw new OEmbedError(`Could not reach YouTube to look up video ${videoId}: ${describeError(error)}`);
  }
  if (result.status !== 200) throw new OEmbedError(describeOEmbedStatus(result.status, videoId), { status: result.status });
  const data = /** @type {Record<string, unknown>|undefined} */ (parseJsonObject(result.text));
  if (!data) throw new OEmbedError(`YouTube's answer about video ${videoId} could not be read.`, { status: result.status });
  const channelUrl = youtubeHttpUrl(textField(data.author_url));
  const thumbnail = textField(data.thumbnail_url);
  return {
    videoId,
    url,
    title: stripHtml(textField(data.title)),
    channel: stripHtml(textField(data.author_name)),
    channelUrl: channelUrl || '',
    thumbnail: /^https:\/\/[a-z0-9.-]+\.(ytimg|youtube)\.com\//i.test(thumbnail) ? thumbnail : null,
  };
}

/**
 * Turn an oEmbed answer into a stored Item. The video has no known publication date, so both
 * `published` and `addedAt` are `now`.
 * @param {OEmbedInfo} oembed
 * @param {{now?: Date}} [options]
 * @returns {import('./types.js').Item}
 */
export function oembedToItem(oembed, { now = new Date() } = {}) {
  const videoId = oembed.videoId;
  const link = canonicalVideoUrl(videoId);
  const iso = now.toISOString();
  return {
    id: itemIdFromLink(normalizeLink(link)),
    guid: 'yt:' + videoId,
    link,
    title: stripHtml(oembed.title) || '(untitled)',
    excerpt: '',
    published: iso,
    thumbnail: oembed.thumbnail || thumbnailUrl(videoId),
    type: 'video',
    videoId,
    addedAt: iso,
  };
}

// ---------------------------------------------------------------------------------------------
// Data API v3

/**
 * Google's reason code for a failed call, normalised so the two shapes of "bad key" both read
 * 'keyInvalid' (the classic errors[].reason and the newer details[].reason API_KEY_INVALID).
 * @param {any} apiError   The `error` object of the response body.
 * @param {string} apiMessage
 * @returns {string|null}
 */
function reasonOf(apiError, apiMessage) {
  const listed = apiError && Array.isArray(apiError.errors) && apiError.errors[0] && typeof apiError.errors[0].reason === 'string'
    ? apiError.errors[0].reason
    : null;
  const details = apiError && Array.isArray(apiError.details) ? apiError.details.map((d) => (d && typeof d.reason === 'string' ? d.reason : '')) : [];
  if (listed === 'keyInvalid' || details.includes('API_KEY_INVALID') || /API key not valid/i.test(apiMessage)) return 'keyInvalid';
  if (listed === 'accessNotConfigured' || details.includes('SERVICE_DISABLED')) return 'accessNotConfigured';
  return listed;
}

/**
 * @param {number} status
 * @param {string|null} reason
 * @param {string} apiMessage  Already HTML-stripped and redacted.
 * @returns {string}
 */
function describeApiError(status, reason, apiMessage) {
  switch (reason) {
    case 'quotaExceeded':
      return "YouTube's daily request allowance for this API key is used up. It resets at midnight Pacific time; channels will be fetched again on the next run after that.";
    case 'keyInvalid':
      return 'The YouTube API key is not valid. Check the YOUTUBE_API_KEY secret: it must be the key exactly as Google shows it, with nothing else.';
    case 'accessNotConfigured':
      return 'The YouTube Data API v3 is not switched on for the Google project this key belongs to. Enable it in the Google Cloud console, then try again.';
    case 'playlistNotFound':
      return 'YouTube cannot find the uploads playlist for this channel. The channel may have no public videos yet, or its id is wrong.';
    case 'channelNotFound':
      return 'YouTube has no channel with that id or handle.';
    default:
      return `YouTube API error ${status}${reason ? ' (' + reason + ')' : ''}: ${apiMessage || 'no details given'}`;
  }
}

/**
 * @param {number} status
 * @param {unknown} data   Parsed body, if it was JSON.
 * @param {string} text    Raw body.
 * @param {string} apiKey
 * @returns {YouTubeApiError}
 */
function toApiError(status, data, text, apiKey) {
  const body = /** @type {{error?: any}|undefined} */ (data);
  const apiError = body && body.error && typeof body.error === 'object' ? body.error : null;
  const rawMessage = apiError && typeof apiError.message === 'string' ? apiError.message : text;
  const apiMessage = redactKey(stripHtml(rawMessage), apiKey).slice(0, 300);
  const reason = reasonOf(apiError, apiMessage);
  return new YouTubeApiError(redactKey(describeApiError(status, reason, apiMessage), apiKey), { status, reason });
}

/**
 * One GET to the Data API. The key goes in the query string only, and is redacted from errors.
 * @param {'channels'|'playlistItems'} endpoint
 * @param {Record<string, string>} params
 * @param {ApiOptions} options
 * @returns {Promise<any>} the parsed JSON body
 * @throws {YouTubeApiError}
 */
async function apiGet(endpoint, params, { apiKey, fetch: fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (/search/i.test(endpoint)) throw new YouTubeApiError('Curanet never uses the YouTube search call.', { reason: 'forbiddenEndpoint' });
  if (!apiKey) throw new YouTubeApiError('No YouTube API key is set. Add the YOUTUBE_API_KEY secret before fetching channels.', { reason: 'missingKey' });
  const url = new URL(API_BASE + endpoint);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('key', apiKey);
  let result;
  try {
    result = await getWithTimeout(fetchFn, url.toString(), timeoutMs);
  } catch (error) {
    if (isAbort(error)) throw new YouTubeApiError(`YouTube did not answer within ${describeDuration(timeoutMs)}.`, { reason: 'timeout' });
    throw new YouTubeApiError('Could not reach YouTube: ' + redactKey(describeError(error), apiKey), { reason: 'network' });
  }
  const data = parseJsonObject(result.text);
  if (result.status < 200 || result.status >= 300) throw toApiError(result.status, data, result.text, apiKey);
  if (!data) throw new YouTubeApiError("YouTube's answer could not be read (it was not JSON).", { status: result.status });
  return data;
}

/**
 * Find a channel's id, uploads playlist, title and handle with one channels.list call, by id
 * when the source has one and by handle otherwise.
 * @param {ChannelSource} source
 * @param {ApiOptions} options
 * @returns {Promise<ResolvedChannel>}
 * @throws {YouTubeApiError} 'channel not found' when YouTube returns no channel; API errors with status and reason.
 */
export async function resolveChannel(source, options) {
  const channelId = pickChannelId(source);
  const handle = pickHandle(source);
  if (!channelId && !handle) {
    const shown = source.url || source.name || source.id || '(no url)';
    throw new YouTubeApiError(`Cannot tell which YouTube channel "${shown}" is: the source needs a handle (like @CBCNews) or a channel id (starting with UC).`, { reason: 'badSource' });
  }
  /** @type {Record<string, string>} */
  const params = { part: 'contentDetails,snippet' };
  if (channelId) params.id = channelId;
  else params.forHandle = /** @type {string} */ (handle);
  const data = await apiGet('channels', params, options);
  const items = Array.isArray(data.items) ? data.items : [];
  const item = items[0];
  if (!item || typeof item.id !== 'string') {
    const what = channelId ? 'with id ' + channelId : 'called ' + handle;
    throw new YouTubeApiError(`channel not found: YouTube has no channel ${what}.`, { reason: 'notFound' });
  }
  const snippet = item.snippet && typeof item.snippet === 'object' ? item.snippet : {};
  const related = item.contentDetails && item.contentDetails.relatedPlaylists ? item.contentDetails.relatedPlaylists : {};
  return {
    channelId: item.id,
    uploadsPlaylistId: typeof related.uploads === 'string' && related.uploads ? related.uploads : uploadsPlaylistIdFor(item.id),
    title: stripHtml(snippet.title),
    handle: normaliseHandle(snippet.customUrl) || handle,
  };
}

/**
 * Best thumbnail from a playlist item's snippet, falling back to the standard address.
 * @param {any} thumbnails
 * @param {string} videoId
 * @returns {string}
 */
function pickThumbnail(thumbnails, videoId) {
  const sizes = thumbnails && typeof thumbnails === 'object' ? thumbnails : {};
  for (const size of ['high', 'medium', 'default']) {
    const url = sizes[size] && typeof sizes[size].url === 'string' ? sizes[size].url : '';
    if (/^https?:\/\//i.test(url)) return url;
  }
  return thumbnailUrl(videoId);
}

/**
 * One playlistItems.list entry as a feed-like entry, or null when it is not a public video.
 * @param {any} item
 * @param {Date} now
 * @returns {VideoEntry|null}
 */
function playlistItemToEntry(item, now) {
  if (!item || typeof item !== 'object') return null;
  const snippet = item.snippet && typeof item.snippet === 'object' ? item.snippet : {};
  const resource = snippet.resourceId && typeof snippet.resourceId === 'object' ? snippet.resourceId : {};
  if (resource.kind !== 'youtube#video') return null;
  const videoId = typeof resource.videoId === 'string' ? resource.videoId : '';
  if (!VIDEO_ID.test(videoId)) return null;
  const rawTitle = typeof snippet.title === 'string' ? snippet.title : '';
  if (PLACEHOLDER_TITLES.has(rawTitle.trim())) return null;
  const details = item.contentDetails && typeof item.contentDetails === 'object' ? item.contentDetails : {};
  return {
    videoId,
    title: stripHtml(rawTitle) || '(untitled)',
    link: canonicalVideoUrl(videoId),
    guid: 'yt:' + videoId,
    published: toIso(details.videoPublishedAt || snippet.publishedAt || null, now),
    summary: stripHtml(snippet.description),
    thumbnail: pickThumbnail(snippet.thumbnails, videoId),
  };
}

/**
 * List a channel's uploads playlist (newest first, as YouTube returns it), following
 * nextPageToken for up to maxPages pages. Private and deleted videos are skipped.
 * @param {string} uploadsPlaylistId   "UU…"
 * @param {UploadsOptions} options
 * @returns {Promise<VideoEntry[]>}
 * @throws {YouTubeApiError}
 */
export async function fetchUploads(uploadsPlaylistId, options) {
  const { maxResults = 50, maxPages = 1, now = new Date() } = options;
  const perPage = Math.min(50, Math.max(1, Math.floor(maxResults) || 50));
  const pages = Math.max(1, Math.floor(maxPages) || 1);
  /** @type {VideoEntry[]} */
  const entries = [];
  /** @type {string|null} */
  let pageToken = null;
  for (let page = 0; page < pages; page += 1) {
    /** @type {Record<string, string>} */
    const params = { part: 'snippet,contentDetails', maxResults: String(perPage), playlistId: uploadsPlaylistId };
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet('playlistItems', params, options);
    const items = Array.isArray(data.items) ? data.items : [];
    for (const item of items) {
      const entry = playlistItemToEntry(item, now);
      if (entry) entries.push(entry);
    }
    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null;
    if (!pageToken) break;
  }
  return entries;
}

/**
 * Everything the fetcher needs for one channel source: its id, uploads playlist and latest
 * videos. When the channel id is already known the uploads playlist is derived from it
 * ("UC…" → "UU…"), so only playlistItems.list is called; otherwise channels.list runs first.
 * @param {ChannelSource} source
 * @param {UploadsOptions} options
 * @returns {Promise<ChannelVideos>}
 * @throws {YouTubeApiError}
 */
export async function fetchChannelVideos(source, options) {
  const knownId = pickChannelId(source);
  const target = knownId
    ? { channelId: knownId, uploadsPlaylistId: uploadsPlaylistIdFor(knownId) }
    : await resolveChannel(source, options);
  const entries = await fetchUploads(target.uploadsPlaylistId, options);
  return { channelId: target.channelId, uploadsPlaylistId: target.uploadsPlaylistId, entries };
}
