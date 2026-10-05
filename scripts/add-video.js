#!/usr/bin/env node
/**
 * Add one YouTube video by link.
 *
 *   node scripts/add-video.js <video url> --category "News / Politics" --country CA --language en [--data data]
 *
 * Confirms the video through oEmbed, finds or creates the channel's source (waiting_for_key) and adds the video.
 */
import { parseArgs, fail, normalizeCountry, normalizeLanguage, formatTree } from '../src/lib/cli.js';
import { loadSources, saveSources, loadCategories, loadHidden, loadItems, saveItems, mergeItems } from '../src/lib/store.js';
import { resolveCategoryPath, categoryName, findCategory, findSubcategory } from '../src/lib/categories.js';
import { parseVideoId, fetchOEmbed, oembedToItem, channelHandleFromUrl, OEmbedError } from '../src/lib/youtube.js';
import { slugify } from '../src/lib/sanitize.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const dataDir = String(flags.data || 'data');
const url = positional[0];
if (!url) { fail('give the video link as the first argument.'); process.exit(1); }
const videoId = parseVideoId(url);
if (!videoId) { fail(`"${url}" does not look like a YouTube video link (expected youtube.com/watch?v=… or youtu.be/…).`); process.exit(1); }

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

let oembed;
try {
  oembed = await fetchOEmbed(videoId);
} catch (error) {
  const reason = error instanceof OEmbedError ? error.message : String(error instanceof Error ? error.message : error);
  fail(`YouTube could not confirm this video: ${reason}`);
  process.exit(1);
}

const now = new Date();
const sourcesDoc = loadSources(dataDir);
const handle = channelHandleFromUrl(oembed.channelUrl);
let source = sourcesDoc.sources.find((s) => s.type === 'youtube_channel' && ((handle && s.handle && s.handle.toLowerCase() === handle.toLowerCase()) || s.name === oembed.channel));
let createdSource = false;
if (!source) {
  const ids = new Set(sourcesDoc.sources.map((s) => s.id));
  let id = 'yt-' + slugify(oembed.channel);
  let n = 2;
  while (ids.has(id)) { id = `yt-${slugify(oembed.channel)}-${n}`; n += 1; }
  source = { id, type: 'youtube_channel', name: oembed.channel, url: oembed.channelUrl, handle: handle || undefined, channelId: null, category: path.category.id, subcategory: path.subcategory.id, country, language, status: 'waiting_for_key', addedAt: now.toISOString(), fetch: null };
  sourcesDoc.sources.push(source);
  createdSource = true;
} else if (source.category !== path.category.id || source.subcategory !== path.subcategory.id || source.country !== country || source.language !== language) {
  const cat = findCategory(categoriesDoc, source.category);
  const sub = cat ? findSubcategory(cat, source.subcategory) : null;
  console.log(`Note: the channel "${source.name}" already exists as ${source.id} in ${cat ? categoryName(cat) : source.category} / ${sub ? categoryName(sub) : source.subcategory}, ${source.country} ${source.language}. Items follow their source, so the video takes those values. Use /edit-source to move the channel.`);
}

const item = oembedToItem(oembed, { now });
const itemsDoc = loadItems(dataDir, source.id);
const hidden = loadHidden(dataDir).hidden;
const merged = mergeItems(itemsDoc.items, [item], { hidden, sourceId: source.id, now });
if (merged.added === 0) {
  const isHidden = hidden.some((h) => h.link === item.link);
  console.log(isHidden ? `This video is on the hidden list (data/hidden.json), so it was not added.` : `This video is already in the feed (${source.id}).`);
  if (createdSource) saveSources(dataDir, sourcesDoc);
  process.exit(0);
}
saveItems(dataDir, { ...itemsDoc, items: merged.items });
if (createdSource) saveSources(dataDir, sourcesDoc);
console.log(`Added "${item.title}" by ${oembed.channel} to ${source.id}${createdSource ? ' (new channel source, waiting for key)' : ''}.`);
console.log(`Published date set to now (${item.published}) because oEmbed gives none.`);
