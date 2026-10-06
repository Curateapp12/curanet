#!/usr/bin/env node
/**
 * Add a feed or a YouTube channel to data/sources.json.
 *
 *   node scripts/add-source.js <url> --category "Local / Politics" --country CA --language en [--name "Name"] [--id slug] [--check-only] [--data data]
 *
 * For a feed: checks it, shows the name and latest titles, refuses duplicates, saves it, fetches it once.
 * For a YouTube channel (youtube.com/@handle or /channel/UC…): saves it with status waiting_for_key.
 * Exit code 1 on any problem, with a plain-language reason.
 */
import { parseArgs, fail, normalizeCountry, normalizeLanguage, formatTree } from '../src/lib/cli.js';
import { loadSources, saveSources, loadCategories } from '../src/lib/store.js';
import { resolveCategoryPath } from '../src/lib/categories.js';
import { fetchSource, runFetch } from '../src/lib/fetcher.js';
import { parseFeed, FeedParseError } from '../src/lib/feed.js';
import { channelHandleFromUrl, channelIdFromUrl } from '../src/lib/youtube.js';
import { normalizeLink, slugify } from '../src/lib/sanitize.js';

const { positional, flags } = parseArgs(process.argv.slice(2), { booleans: ['check-only', 'checkOnly', 'json'] });
const dataDir = String(flags.data || 'data');
const url = positional[0];

if (!url) { fail('give the feed or channel address as the first argument.'); process.exit(1); }
if (!/^https?:\/\//i.test(url)) { fail('the address must start with http:// or https://.'); process.exit(1); }
if (flags.id !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(flags.id))) { fail('--id may only contain lower-case letters, digits and dashes, like globe-and-mail-politics.'); process.exit(1); }

const categoriesDoc = loadCategories(dataDir);
const path = flags.category ? resolveCategoryPath(categoriesDoc, String(flags.category)) : null;
if (!path || !path.category || !path.subcategory) {
  if (path && path.ambiguous) fail(`"${flags.category}" matches several places: ${path.ambiguous.join(', ')}. Say which one.`);
  else fail(`--category must be "Category / Subcategory" from this tree:\n${formatTree(categoriesDoc)}`);
  process.exit(1);
}
const country = normalizeCountry(flags.country);
const language = normalizeLanguage(flags.language);
if (!country) { fail('--country must be a two-letter country code like CA or US.'); process.exit(1); }
if (!language) { fail('--language must be a two-letter language code like en or fr.'); process.exit(1); }

const sourcesDoc = loadSources(dataDir);
const now = new Date().toISOString();
const checkOnly = Boolean(flags.checkOnly);

/** @param {string} base */
function uniqueId(base) {
  let id = base;
  let n = 2;
  const ids = new Set(sourcesDoc.sources.map((s) => s.id));
  while (ids.has(id)) { id = `${base}-${n}`; n += 1; }
  return id;
}

const handle = channelHandleFromUrl(url);
const channelId = channelIdFromUrl(url);
if (handle || channelId) {
  const dup = sourcesDoc.sources.find((s) => s.type === 'youtube_channel' && ((handle && s.handle && s.handle.toLowerCase() === handle.toLowerCase()) || (channelId && s.channelId === channelId)));
  if (dup) { fail(`this channel is already a source: ${dup.id} (${dup.name}).`); process.exit(1); }
  const name = String(flags.name || (handle ? handle.slice(1) : channelId));
  const id = String(flags.id || uniqueId('yt-' + slugify(name)));
  console.log(`YouTube channel ${handle || channelId} → source "${id}" (${name}), ${path.category.name.en} / ${path.subcategory.name.en}, ${country} ${language}`);
  console.log('Channels are fetched only through the YouTube Data API. Until a key is added, the status is "waiting for key" and nothing is downloaded.');
  if (checkOnly) process.exit(0);
  sourcesDoc.sources.push({ id, type: 'youtube_channel', name, url, handle: handle || undefined, channelId: channelId || null, category: path.category.id, subcategory: path.subcategory.id, country, language, status: 'waiting_for_key', addedAt: now, fetch: null });
  saveSources(dataDir, sourcesDoc);
  console.log(`Saved ${id} with status waiting_for_key.`);
  process.exit(0);
}

const normalized = normalizeLink(url);
const dup = sourcesDoc.sources.find((s) => normalizeLink(s.url) === normalized);
if (dup) { fail(`this feed is already a source: ${dup.id} (${dup.name}).`); process.exit(1); }

const probe = { id: 'check', type: 'feed', name: 'check', url, category: path.category.id, subcategory: path.subcategory.id, country, language, status: 'active', addedAt: now, fetch: null };
const result = await fetchSource(/** @type {any} */ (probe));
if (result.result === 'blocked') { fail(`the publisher refused the request (HTTP ${result.status}). Per the rules this is not worked around.`); process.exit(1); }
if (result.result !== 'ok') { fail(`could not download the feed: ${'error' in result ? result.error : result.result}.`); process.exit(1); }

let feed;
try {
  feed = parseFeed(result.body, { baseUrl: result.finalUrl || url });
} catch (error) {
  const message = error instanceof FeedParseError ? error.message : String(error);
  const links = [...result.body.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)]
    .map((m) => (/href=["']([^"']+)["']/i.exec(m[0]) || [])[1])
    .filter(Boolean)
    .map((href) => { try { return new URL(href, result.finalUrl || url).toString(); } catch { return href; } });
  fail(`that address is not a feed (${message}).` + (links.length ? `\nFeeds found on that page:\n  ${[...new Set(links)].join('\n  ')}` : ''));
  process.exit(1);
}
if (feed.entries.length === 0) { fail('the feed has no items.'); process.exit(1); }

const host = new URL(result.finalUrl || url).hostname.replace(/^www\./, '');
const name = String(flags.name || feed.title || host).trim();
const siteUrl = feed.link || new URL(result.finalUrl || url).origin;
const id = String(flags.id || uniqueId(slugify(name)));

console.log(`Feed: ${feed.title || '(no title)'} — ${feed.kind.toUpperCase()}, ${feed.entries.length} items`);
console.log(`Will be saved as "${id}" (${name}), ${path.category.name.en} / ${path.subcategory.name.en}, ${country} ${language}, site ${siteUrl}`);
console.log('Latest titles:');
for (const entry of feed.entries.slice(0, 5)) console.log(`  - ${entry.published ? entry.published.slice(0, 10) + '  ' : ''}${entry.title}`);
const withThumb = feed.entries.filter((e) => e.thumbnail).length;
console.log(`${withThumb} of ${feed.entries.length} items have a thumbnail.`);
if (checkOnly) process.exit(0);

sourcesDoc.sources.push({ id, type: 'feed', name, url: result.finalUrl || url, siteUrl, category: path.category.id, subcategory: path.subcategory.id, country, language, status: 'active', addedAt: now, fetch: null });
saveSources(dataDir, sourcesDoc);
console.log(`Saved ${id}. Fetching it once…`);
const run = await runFetch({ dataDir, only: [id], log: () => {} });
const mine = run.sources.find((s) => s.id === id);
if (mine) console.log(`Fetch: ${mine.result}${mine.error ? ' — ' + mine.error : ''}, ${mine.added} item(s) added.`);
