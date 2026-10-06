#!/usr/bin/env node
/**
 * Hide one item by link or id: removes it from its source's file and records it in data/hidden.json
 * so later fetches skip it.
 *
 *   node scripts/hide-item.js <link or 16-char id> [--note "reason"] [--data data]
 */
import { parseArgs, fail } from '../src/lib/cli.js';
import { hideItemByLink, loadSources } from '../src/lib/store.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const dataDir = String(flags.data || 'data');
const ref = positional[0];
if (!ref) { fail('give the item link (or its id) as the first argument.'); process.exit(1); }

let hidden;
try {
  hidden = hideItemByLink(dataDir, ref, { note: flags.note ? String(flags.note) : undefined });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const { removed, sourceId } = hidden;
if (removed) {
  const source = loadSources(dataDir).sources.find((s) => s.id === sourceId);
  console.log(`Hidden: "${removed.title}" from ${source ? source.name : sourceId} (${removed.link}).`);
} else if (/^[0-9a-f]{16}$/.test(ref)) {
  fail(`no stored item has the id ${ref}; nothing was recorded. Give the item's link to keep it out of later fetches.`);
} else {
  console.log(`No stored item matched, but the link is now on the hidden list so it will never be added: ${ref}`);
}
