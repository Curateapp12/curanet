#!/usr/bin/env node
/**
 * Manage sources.
 *
 *   node scripts/source.js list [--status active] [--data data]
 *   node scripts/source.js show <id>
 *   node scripts/source.js remove <id>                 deletes the source and its items file
 *   node scripts/source.js pause <id>                  status → paused (items stay visible)
 *   node scripts/source.js resume <id>                 status → active (also un-blocks)
 *   node scripts/source.js edit <id> [--category "C / S"] [--country CC] [--language ll] [--name "Name"]
 *
 * <id> may also be the feed URL or (if unique) the display name.
 */
import { parseArgs, fail, pad, normalizeCountry, normalizeLanguage, formatTree } from '../src/lib/cli.js';
import { loadSources, saveSources, loadCategories, loadItems, deleteItems } from '../src/lib/store.js';
import { resolveCategoryPath, findCategory, findSubcategory, categoryName } from '../src/lib/categories.js';
import { normalizeLink } from '../src/lib/sanitize.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const dataDir = String(flags.data || 'data');
const [command, ref] = positional;
const sourcesDoc = loadSources(dataDir);
const categoriesDoc = loadCategories(dataDir);

/** @param {import('../src/lib/types.js').Source} s */
function place(s) {
  const cat = findCategory(categoriesDoc, s.category);
  const sub = cat ? findSubcategory(cat, s.subcategory) : null;
  return `${cat ? categoryName(cat) : s.category} / ${sub ? categoryName(sub) : s.subcategory}`;
}

/** @param {string|undefined} text */
function findSource(text) {
  if (!text) return { source: null, matches: [] };
  const needle = text.trim().toLowerCase();
  const exact = sourcesDoc.sources.find((s) => s.id === needle || normalizeLink(s.url) === normalizeLink(text));
  if (exact) return { source: exact, matches: [exact] };
  const matches = sourcesDoc.sources.filter((s) => s.name.toLowerCase() === needle || s.name.toLowerCase().includes(needle) || s.id.includes(needle));
  return { source: matches.length === 1 ? matches[0] : null, matches };
}

function list(filterStatus) {
  const rows = sourcesDoc.sources.filter((s) => !filterStatus || s.status === filterStatus);
  console.log(pad('id', 34) + pad('name', 26) + pad('type', 9) + pad('place', 34) + pad('cc', 3) + pad('ll', 3) + pad('status', 16) + pad('items', 6) + 'last success');
  for (const s of rows) {
    const count = loadItems(dataDir, s.id).items.length;
    console.log(pad(s.id, 34) + pad(s.name, 26) + pad(s.type === 'feed' ? 'feed' : 'youtube', 9) + pad(place(s), 34) + pad(s.country, 3) + pad(s.language, 3) + pad(s.status, 16) + pad(count, 6) + (s.fetch && s.fetch.lastSuccess ? s.fetch.lastSuccess.slice(0, 16).replace('T', ' ') : 'never'));
  }
  console.log(`${rows.length} source(s).`);
}

if (!command || command === 'list') {
  list(flags.status ? String(flags.status) : null);
  process.exit(0);
}

const { source, matches } = findSource(ref);
if (!source) {
  if (matches.length > 1) fail(`"${ref}" matches several sources: ${matches.map((m) => `${m.id} (${m.name})`).join(', ')}. Use the id.`);
  else fail(`no source matches "${ref}". Run "node scripts/source.js list" to see them.`);
  process.exit(1);
}

switch (command) {
  case 'show': {
    const count = loadItems(dataDir, source.id).items.length;
    console.log(JSON.stringify({ ...source, items: count, place: place(source) }, null, 2));
    break;
  }
  case 'remove': {
    const count = loadItems(dataDir, source.id).items.length;
    sourcesDoc.sources = sourcesDoc.sources.filter((s) => s.id !== source.id);
    saveSources(dataDir, sourcesDoc);
    deleteItems(dataDir, source.id);
    console.log(`Removed ${source.id} (${source.name}) and its ${count} item(s).`);
    break;
  }
  case 'pause': {
    if (source.status === 'paused') { console.log(`${source.id} is already paused.`); break; }
    const before = source.status;
    source.status = 'paused';
    saveSources(dataDir, sourcesDoc);
    console.log(`${source.id} (${source.name}): ${before} → paused. Its items stay on the site; it is no longer fetched.`);
    break;
  }
  case 'resume': {
    if (source.type === 'youtube_channel' && source.status === 'waiting_for_key') { fail(`${source.id} is a YouTube channel waiting for the API key; it becomes active on its own once the key is added and a fetch runs.`); break; }
    if (source.status === 'active') { console.log(`${source.id} is already active.`); break; }
    const before = source.status;
    source.status = 'active';
    if (source.fetch) { source.fetch.failures = 0; source.fetch.lastError = null; }
    saveSources(dataDir, sourcesDoc);
    console.log(`${source.id} (${source.name}): ${before} → active.` + (before === 'blocked' ? ' The next fetch tries once more; if the publisher refuses again it becomes blocked again.' : ''));
    break;
  }
  case 'edit': {
    const before = { name: source.name, place: place(source), country: source.country, language: source.language };
    if (flags.category) {
      const path = resolveCategoryPath(categoriesDoc, String(flags.category));
      if (!path || !path.category || !path.subcategory) {
        if (path && path.ambiguous) fail(`"${flags.category}" matches several places: ${path.ambiguous.join(', ')}.`);
        else fail(`--category must be "Category / Subcategory" from this tree:\n${formatTree(categoriesDoc)}`);
        process.exit(1);
      }
      source.category = path.category.id;
      source.subcategory = path.subcategory.id;
    }
    if (flags.country) {
      const country = normalizeCountry(flags.country);
      if (!country) { fail('--country must be a two-letter country code like CA.'); process.exit(1); }
      source.country = country;
    }
    if (flags.language) {
      const language = normalizeLanguage(flags.language);
      if (!language) { fail('--language must be a two-letter language code like en.'); process.exit(1); }
      source.language = language;
    }
    if (flags.name) source.name = String(flags.name).trim();
    if (!flags.category && !flags.country && !flags.language && !flags.name) { fail('nothing to change: pass --category, --country, --language or --name.'); process.exit(1); }
    saveSources(dataDir, sourcesDoc);
    const after = { name: source.name, place: place(source), country: source.country, language: source.language };
    console.log(`${source.id}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    console.log('All items from this source take the new values at the next build.');
    break;
  }
  default:
    fail(`unknown command "${command}". Use list, show, remove, pause, resume or edit.`);
}
