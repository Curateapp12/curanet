#!/usr/bin/env node
/**
 * The fetch run from the command line: `npm run fetch` (all sources) or `npm run fetch -- --source <id>`.
 *
 *   --source <id>       Fetch only this source (repeat the flag, or separate ids with commas).
 *   --concurrency <n>   How many sources to download at the same time (default 4).
 *   --timeout <ms>      Time limit per source (default 10000).
 *   --dry-run           Fetch and report, but write nothing.
 *   --data <dir>        Data directory (default "data").
 *   --quiet             Print only the totals and the run log path.
 *
 * Prints one line per source, the totals and the run log path. The exit code is 0 even when
 * sources fail; it is 1 only when the data files cannot be read (or a flag is wrong).
 * The YouTube API key is taken from the YOUTUBE_API_KEY environment variable and never printed.
 */
import path from 'node:path';
import { runFetch, formatTotals } from '../src/lib/fetcher.js';
import { runFilePath } from '../src/lib/store.js';

const USAGE = `Usage: node scripts/fetch.js [--source <id>] [--concurrency <n>] [--timeout <ms>] [--dry-run] [--data <dir>] [--quiet]`;

/**
 * @typedef {Object} CliOptions
 * @property {string[]|null} sources
 * @property {number} concurrency
 * @property {number} timeout
 * @property {boolean} dryRun
 * @property {string} data
 * @property {boolean} quiet
 * @property {boolean} help
 * @property {string[]} problems
 */

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = { sources: null, concurrency: 4, timeout: 10000, dryRun: false, data: 'data', quiet: false, help: false, problems: [] };
  /** @param {string} flag @param {number} index @returns {string|null} */
  const valueOf = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      options.problems.push(`${flag} needs a value.`);
      return null;
    }
    return value;
  };
  /** @param {string} flag @param {string|null} value @param {number} min */
  const wholeNumber = (flag, value, min) => {
    const number = Number(value);
    if (value === null) return null;
    if (!Number.isInteger(number) || number < min) {
      options.problems.push(`${flag} must be a whole number of at least ${min}, not "${value}".`);
      return null;
    }
    return number;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith('--') && eq > 0 ? arg.slice(eq + 1) : null;
    /** @returns {string|null} */
    const next = () => {
      if (inline !== null) return inline;
      const value = valueOf(flag, i);
      if (value !== null) i += 1;
      return value;
    };
    switch (flag) {
      case '--source': {
        const value = next();
        if (value !== null) options.sources = [...(options.sources || []), ...value.split(',').map((s) => s.trim()).filter(Boolean)];
        break;
      }
      case '--concurrency': {
        const value = wholeNumber(flag, next(), 1);
        if (value !== null) options.concurrency = value;
        break;
      }
      case '--timeout': {
        const value = wholeNumber(flag, next(), 1);
        if (value !== null) options.timeout = value;
        break;
      }
      case '--data': {
        const value = next();
        if (value !== null) options.data = value;
        break;
      }
      case '--dry-run': options.dryRun = true; break;
      case '--quiet': options.quiet = true; break;
      case '--help': case '-h': options.help = true; break;
      default: options.problems.push(`Unknown option "${arg}".`);
    }
  }
  if (options.sources && options.sources.length === 0) options.problems.push('--source needs at least one source id.');
  return options;
}

/**
 * A path as the owner would type it: relative when it is inside the working directory.
 * @param {string} file
 * @returns {string}
 */
function showPath(file) {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (options.problems.length > 0) {
    for (const problem of options.problems) console.error('Problem: ' + problem);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const log = options.quiet ? () => {} : (/** @type {string} */ line) => console.log(line);
  let runLog;
  try {
    runLog = await runFetch({
      dataDir: options.data,
      concurrency: options.concurrency,
      only: options.sources,
      timeoutMs: options.timeout,
      dryRun: options.dryRun,
      log,
    });
  } catch (error) {
    console.error('Problem: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }
  console.log(formatTotals(runLog.totals));
  if (options.dryRun) {
    console.log('Dry run: nothing was written.');
  } else {
    console.log('Run log: ' + showPath(runFilePath(options.data, runLog.startedAt)));
  }
}

await main(process.argv.slice(2));
