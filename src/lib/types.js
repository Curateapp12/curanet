/**
 * Shared JSDoc types for Curanet. This file has no runtime code.
 *
 * @typedef {Object} FetchState
 * @property {string|null} etag            Value of the last ETag header, sent back as If-None-Match.
 * @property {string|null} lastModified    Value of the last Last-Modified header, sent back as If-Modified-Since.
 * @property {string|null} lastAttempt     ISO time of the last attempt.
 * @property {string|null} lastSuccess     ISO time of the last run that returned 200 or 304.
 * @property {'ok'|'unchanged'|'blocked'|'error'|'skipped'|null} lastResult
 * @property {string|null} lastError       Human-readable reason of the last failure.
 * @property {number} failures             Consecutive failures (reset to 0 on success).
 *
 * @typedef {Object} Source
 * @property {string} id                   Slug, unique, also the item file name.
 * @property {'feed'|'youtube_channel'} type
 * @property {string} name                 Short display name ("BBC").
 * @property {string} url                  Feed URL, or the YouTube channel page.
 * @property {string} [siteUrl]            Publisher homepage.
 * @property {string} [handle]             YouTube handle ("@CBCNews").
 * @property {string|null} [channelId]     YouTube channel id, filled by the first API fetch.
 * @property {string} category             Category id from categories.json.
 * @property {string} subcategory          Subcategory id within that category.
 * @property {string} country              ISO 3166-1 alpha-2, upper case.
 * @property {string} language             ISO 639-1, lower case.
 * @property {'active'|'paused'|'blocked'|'waiting_for_key'} status
 * @property {string} addedAt              ISO time.
 * @property {FetchState|null} fetch
 *
 * @typedef {Object} Item
 * @property {string} id                   First 16 hex chars of SHA-1 of the normalised link.
 * @property {string|null} guid            The feed's own identifier, if any.
 * @property {string} link                 Normalised absolute link to the original.
 * @property {string} title                Plain text, HTML stripped.
 * @property {string} excerpt              Plain text, at most 300 characters.
 * @property {string} published            ISO time.
 * @property {string|null} thumbnail       Absolute image URL from the feed, or null.
 * @property {'article'|'video'} type
 * @property {string} [videoId]            YouTube video id (videos only).
 * @property {string} addedAt              ISO time the item was stored.
 *
 * @typedef {Object} ParsedEntry           One entry as returned by parseFeed (already plain text).
 * @property {string} title
 * @property {string} link                 Absolute URL (not yet normalised).
 * @property {string|null} guid
 * @property {string|null} published       ISO time or null when the feed gave none.
 * @property {string} summary              Plain text, untruncated.
 * @property {string|null} thumbnail       Absolute image URL or null.
 *
 * @typedef {Object} ParsedFeed
 * @property {'rss'|'atom'|'rdf'} kind
 * @property {string} title
 * @property {string|null} link
 * @property {ParsedEntry[]} entries
 *
 * @typedef {Object} Category
 * @property {string} id
 * @property {{en: string, fr?: string}} name
 * @property {Subcategory[]} subcategories
 *
 * @typedef {Object} Subcategory
 * @property {string} id
 * @property {{en: string, fr?: string}} name
 *
 * @typedef {Object} HiddenEntry
 * @property {string} link
 * @property {string|null} [guid]
 * @property {string|null} [sourceId]
 * @property {string} hiddenAt
 * @property {string} [note]
 *
 * @typedef {Object} RunSourceResult
 * @property {string} id
 * @property {'ok'|'unchanged'|'blocked'|'error'|'skipped'} result
 * @property {number} added
 * @property {number} pruned
 * @property {number} ms
 * @property {string|null} error
 *
 * @typedef {Object} RunLog
 * @property {number} version
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {{sources: number, fetched: number, unchanged: number, added: number, pruned: number, blocked: number, errors: number, skipped: number}} totals
 * @property {RunSourceResult[]} sources
 */
export {};
