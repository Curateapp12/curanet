/**
 * Text and link hygiene. Everything that comes from a feed passes through here before it is
 * stored, so nothing from a publisher can run on the site.
 */
import { createHash } from 'node:crypto';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û',
  ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', Eacute: 'É', Egrave: 'È', Agrave: 'À', Ccedil: 'Ç',
  ouml: 'ö', auml: 'ä', uuml: 'ü', Ouml: 'Ö', Auml: 'Ä', Uuml: 'Ü', szlig: 'ß', ntilde: 'ñ', Ntilde: 'Ñ',
  iexcl: '¡', iquest: '¿', euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', middot: '·', bull: '•',
  times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', para: '¶', sect: '§',
  oelig: 'œ', OElig: 'Œ', aelig: 'æ', AElig: 'Æ', thinsp: ' ', ensp: ' ', emsp: ' ', zwj: '‍', zwnj: '‌',
};

/**
 * Decode HTML entities (named, decimal and hexadecimal). Unknown named entities are left as is.
 * @param {string} text
 * @returns {string}
 */
export function decodeEntities(text) {
  if (!text) return '';
  return String(text).replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
      // Windows-1252 leftovers that some feeds emit as numeric entities.
      if (code >= 0x80 && code <= 0x9f) {
        const cp1252 = { 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0x85: '…', 0x80: '€', 0x95: '•' };
        return cp1252[code] || '';
      }
      try { return String.fromCodePoint(code); } catch { return ''; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
  });
}

/**
 * Remove every HTML tag, comment, script and style block, decode entities (twice, for
 * double-encoded feeds), and collapse whitespace. The result is plain text that is safe to put in
 * a text node. It is NOT safe to put into innerHTML without escaping; the site always escapes.
 * @param {unknown} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (html === null || html === undefined) return '';
  let text = removeMarkup(String(html));
  text = decodeEntities(text);
  // Some feeds encode their HTML twice; a second pass removes tags that appeared after decoding.
  if (/<[a-zA-Z/!][^>]*>/.test(text)) {
    text = decodeEntities(removeMarkup(text));
  }
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** @param {string} text @returns {string} */
function removeMarkup(text) {
  let out = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  out = out.replace(/<(script|style|noscript|iframe|object|embed|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|blockquote|figcaption|section|article|header|footer)\b[^>]*>/gi, ' ');
  out = out.replace(/<[^>]*>/g, '');
  return out;
}

/**
 * Shorten plain text to at most `max` characters, cutting at a word boundary and adding an
 * ellipsis when something was removed. Counts Unicode code points, not UTF-16 units.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncate(text, max = 300) {
  const chars = Array.from(text || '');
  if (chars.length <= max) return chars.join('');
  const limit = Math.max(1, max - 1);
  let cut = chars.slice(0, limit).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > limit * 0.6) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s,;:.!?…-]+$/u, '') + '…';
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_ga|_gl|ref|ref_src|cmpid|cmp|ns_mchannel|ns_source|ns_campaign|ns_linkname|ns_fee|at_medium|at_campaign|at_custom[0-9]*|xtor|oc|smid|smtyp|partner|ocid|sh|guccounter|guce_referrer|guce_referrer_sig|taid|CMP|cmpid|__twitter_impression|source|src)$/i;

/**
 * Make a link canonical enough for duplicate detection: absolute, lower-case scheme and host,
 * no fragment, no tracking parameters, no default port, no trailing "?" and remaining parameters
 * sorted. Returns the input trimmed when it cannot be parsed.
 * @param {string} url
 * @param {string} [base]   Base URL used to resolve relative links.
 * @returns {string}
 */
export function normalizeLink(url, base) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return raw;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return raw;
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  const keep = [];
  for (const [key, value] of parsed.searchParams) {
    if (!TRACKING_PARAMS.test(key)) keep.push([key, value]);
  }
  keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  parsed.search = '';
  for (const [key, value] of keep) parsed.searchParams.append(key, value);
  let out = parsed.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  return out;
}

/**
 * Stable item id: first 16 hex characters of the SHA-1 of the normalised link.
 * @param {string} normalizedLink
 * @returns {string}
 */
export function itemIdFromLink(normalizedLink) {
  return createHash('sha1').update(String(normalizedLink)).digest('hex').slice(0, 16);
}

/**
 * Turn a feed date (RFC 822, ISO 8601, and the usual sloppy variants) into an ISO string.
 * Returns null when it cannot be read or is absurd (before 1995 or more than two days ahead).
 * @param {unknown} value
 * @param {Date} [now]
 * @returns {string|null}
 */
export function toIso(value, now = new Date()) {
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (!text) return null;
  // Common fixes: "GMT+0000 (UTC)" suffixes, double spaces, trailing "Z" after offset, "UT" zone.
  text = text.replace(/\s+/g, ' ').replace(/\s\(.*\)$/, '').replace(/ UT$/, ' UTC');
  let date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    // "2026-10-05 22:51:40" (space instead of T) and "2026-10-05T22:51:40 +0000"
    const alt = text.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2').replace(/ ([+-]\d{4})$/, '$1');
    date = new Date(alt);
  }
  if (Number.isNaN(date.getTime())) return null;
  const min = Date.UTC(1995, 0, 1);
  const max = now.getTime() + 2 * 24 * 3600 * 1000;
  if (date.getTime() < min || date.getTime() > max) return null;
  return date.toISOString();
}

/**
 * Lower-case slug from any text: letters, digits and dashes only.
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'source';
}
