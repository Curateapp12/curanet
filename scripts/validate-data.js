#!/usr/bin/env node
/**
 * Check every data file and report problems in plain language.
 *
 *   node scripts/validate-data.js            checks ./data
 *   node scripts/validate-data.js --data dir checks another folder
 *
 * Prints the counts, then warnings, then errors (one per line), and ends with "Data OK" or
 * "N problems found". Exits with code 1 when there are errors.
 */
import process from 'node:process';
import { validateAll } from '../src/lib/validate.js';

const USAGE = 'Usage: node scripts/validate-data.js [--data <folder>]';

/**
 * @param {string[]} argv
 * @returns {{dataDir: string}|{error: string}}
 */
function parseArgs(argv) {
  let dataDir = 'data';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) return { error: `--data needs a folder after it.\n${USAGE}` };
      dataDir = value;
      i += 1;
    } else if (arg.startsWith('--data=')) {
      dataDir = arg.slice('--data='.length);
      if (!dataDir) return { error: `--data needs a folder after it.\n${USAGE}` };
    } else if (arg === '--help' || arg === '-h') {
      return { error: USAGE };
    } else {
      return { error: `Unknown option "${arg}".\n${USAGE}` };
    }
  }
  return { dataDir };
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural]
 * @returns {string}
 */
function plural(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const args = parseArgs(process.argv.slice(2));
if ('error' in args) {
  console.log(args.error);
  process.exitCode = 1;
} else {
  const { errors, warnings, counts } = validateAll(args.dataDir);
  console.log(
    `Checked ${args.dataDir}: ${plural(counts.categories, 'category', 'categories')}, ${plural(counts.sources, 'source')}, `
      + `${plural(counts.items, 'item')}, ${counts.hidden} hidden, ${plural(counts.runs, 'run')}`,
  );
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  for (const error of errors) console.log(`Error: ${error}`);
  if (errors.length === 0) {
    console.log('Data OK');
  } else {
    console.log(`${plural(errors.length, 'problem')} found`);
    process.exitCode = 1;
  }
}
