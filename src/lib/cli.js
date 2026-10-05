/**
 * Tiny command-line helpers shared by the scripts in scripts/. No dependencies.
 */

/**
 * Parse argv into positional arguments and --flags.
 * `--name value` and `--name=value` set a string; a flag listed in `booleans` takes no value.
 * Repeated flags become arrays.
 * @param {string[]} argv
 * @param {{booleans?: string[]}} [options]
 * @returns {{positional: string[], flags: Record<string, any>}}
 */
export function parseArgs(argv, options = {}) {
  const booleans = new Set(options.booleans || []);
  /** @type {string[]} */
  const positional = [];
  /** @type {Record<string, any>} */
  const flags = {};
  const set = (key, value) => {
    if (key in flags) flags[key] = [].concat(flags[key], value);
    else flags[key] = value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = (eq > 0 ? arg.slice(2, eq) : arg.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (eq > 0) { set(key, arg.slice(eq + 1)); continue; }
      if (booleans.has(key) || booleans.has(arg.slice(2))) { set(key, true); continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { set(key, true); continue; }
      set(key, next);
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/**
 * Print a plain-language failure and mark the process as failed without exiting abruptly.
 * @param {string} message
 */
export function fail(message) {
  console.error('Problem: ' + message);
  process.exitCode = 1;
}

/**
 * Pad text for simple tables.
 * @param {unknown} value
 * @param {number} width
 */
export function pad(value, width) {
  const text = String(value === null || value === undefined ? '' : value);
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * Validate a country code (ISO 3166-1 alpha-2, upper case).
 * @param {unknown} value
 * @returns {string|null} the normalised code or null
 */
export function normalizeCountry(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

/**
 * Validate a language code (ISO 639-1, lower case).
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeLanguage(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(text) ? text : null;
}

/**
 * Format a category tree for the terminal.
 * @param {{categories: import('./types.js').Category[]}} doc
 */
export function formatTree(doc) {
  return doc.categories
    .map((c) => `${c.name.en} (${c.id})` + (c.subcategories.length ? '\n' + c.subcategories.map((s) => `    ${c.name.en} / ${s.name.en} (${c.id}/${s.id})`).join('\n') : ''))
    .join('\n');
}
