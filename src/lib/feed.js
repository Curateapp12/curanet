/**
 * Feed parsing: RSS 2.0 (and 0.9x), RSS 1.0 / RDF, and Atom 1.0 (and 0.3) into plain entries.
 * Output text is already HTML-stripped. Links and thumbnails are absolute URLs.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { stripHtml, toIso } from './sanitize.js';

export class FeedParseError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'FeedParseError';
  }
}

const ARRAY_TAGS = new Set(['item', 'entry', 'link', 'enclosure', 'media:content', 'media:thumbnail', 'media:group', 'category', 'author', 'image']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  removeNSPrefix: false,
  allowBooleanAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => ARRAY_TAGS.has(name),
  // HTML-bearing fields are kept as raw strings so mixed content keeps its order; stripHtml cleans them.
  stopNodes: ['*.title', '*.description', '*.summary', '*.content', '*.content:encoded', '*.media:description'],
});

/**
 * Quick sniff of the feed kind from the first bytes, without parsing.
 * @param {string} xml
 * @returns {'rss'|'atom'|'rdf'|null}
 */
export function detectFeedKind(xml) {
  const head = String(xml || '').slice(0, 4000);
  if (/<rss[\s>]/i.test(head)) return 'rss';
  if (/<feed[\s>]/i.test(head)) return 'atom';
  if (/<rdf:RDF[\s>]/i.test(head)) return 'rdf';
  return null;
}

/** @param {any} node @returns {string} */
function text(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).filter(Boolean).join(' ');
  if (typeof node === 'object') {
    // Leaf or mixed content: concatenate text, CDATA and child element text, ignoring attributes.
    return Object.keys(node)
      .filter((k) => !k.startsWith('@_'))
      .map((k) => text(node[k]))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

/** @param {any} node @param {string} name @returns {string} */
function attr(node, name) {
  if (!node || typeof node !== 'object') return '';
  const value = node['@_' + name];
  return value === undefined || value === null ? '' : String(value);
}

/** @param {any} value @returns {any[]} */
function arr(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** @param {string} url @param {string} [base] @returns {string} */
function absolute(url, base) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = base ? new URL(raw, base) : new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/** @param {string} html @param {string} [base] @returns {string|null} */
function firstImageInHtml(html, base) {
  const source = String(html || '');
  const re = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = re.exec(source))) {
    const tag = match[0];
    const src = match[1];
    if (/^data:/i.test(src)) continue;
    const width = /\swidth\s*=\s*["']?(\d+)/i.exec(tag);
    const height = /\sheight\s*=\s*["']?(\d+)/i.exec(tag);
    if ((width && Number(width[1]) <= 2) || (height && Number(height[1]) <= 2)) continue; // tracking pixel
    if (/pixel|tracker|beacon|\.gif(\?|$)/i.test(src) && !/\.(jpe?g|png|webp)/i.test(src)) continue;
    const abs = absolute(src, base);
    if (abs) return abs;
  }
  return null;
}

/**
 * Pick the best thumbnail from the media:* elements, enclosure, itunes:image, or the first image in
 * the HTML content. Largest declared width wins among media:* candidates.
 * @param {any} entry
 * @param {string} base
 * @param {string} htmlBody
 * @returns {string|null}
 */
function pickThumbnail(entry, base, htmlBody) {
  /** @type {{url: string, width: number}[]} */
  const candidates = [];
  const consider = (node, defaultWidth) => {
    const url = attr(node, 'url') || attr(node, 'href');
    const medium = attr(node, 'medium');
    const type = attr(node, 'type');
    if (!url) return;
    if (medium && medium !== 'image') return;
    if (type && !/^image\//i.test(type)) return;
    if (!medium && !type && !/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url) && !/image|img|photo|thumb|resizer|cdn/i.test(url)) return;
    const width = Number(attr(node, 'width')) || defaultWidth;
    const abs = absolute(url, base);
    if (abs) candidates.push({ url: abs, width });
  };
  const groups = [entry, ...arr(entry['media:group'])];
  for (const group of groups) {
    for (const node of arr(group['media:content'])) {
      consider(node, 500);
      for (const thumb of arr(node['media:thumbnail'])) consider(thumb, 300);
    }
    for (const node of arr(group['media:thumbnail'])) consider(node, 300);
  }
  for (const node of arr(entry.enclosure)) consider(node, 400);
  if (entry['itunes:image']) consider(entry['itunes:image'], 300);
  if (entry.image) {
    for (const node of arr(entry.image)) {
      const url = attr(node, 'url') || text(node.url) || text(node);
      const abs = absolute(url, base);
      if (abs) candidates.push({ url: abs, width: 200 });
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.width - a.width);
    return candidates[0].url;
  }
  return firstImageInHtml(htmlBody, base);
}

/** @param {any} entry @returns {string} */
function rawHtml(entry) {
  return text(entry['content:encoded']) || text(entry.content) || text(entry.description) || text(entry.summary) || '';
}

/**
 * @param {any} item RSS <item>
 * @param {string} base
 * @returns {import('./types.js').ParsedEntry|null}
 */
function rssEntry(item, base) {
  const guidNode = item.guid;
  const guidText = text(guidNode).trim();
  const isPermalink = guidNode && typeof guidNode === 'object' ? attr(guidNode, 'isPermaLink').toLowerCase() !== 'false' : true;
  let link = '';
  for (const node of arr(item.link)) {
    const candidate = typeof node === 'object' ? attr(node, 'href') || text(node) : String(node);
    if (candidate && candidate.trim()) { link = candidate.trim(); break; }
  }
  if (!link && isPermalink && /^https?:\/\//i.test(guidText)) link = guidText;
  if (!link) link = text(item['feedburner:origLink']).trim();
  link = absolute(link, base);
  if (!link) return null;
  const html = rawHtml(item);
  const summarySource = text(item.description) || text(item.summary) || text(item['content:encoded']) || text(item.content) || '';
  const published = toIso(text(item.pubDate) || text(item['dc:date']) || text(item.published) || text(item.updated) || text(item['atom:updated']) || null);
  return {
    title: stripHtml(text(item.title)) || stripHtml(summarySource).slice(0, 120) || '(untitled)',
    link,
    guid: guidText || null,
    published,
    summary: stripHtml(summarySource),
    thumbnail: pickThumbnail(item, base, html),
  };
}

/**
 * @param {any} entry Atom <entry>
 * @param {string} base
 * @returns {import('./types.js').ParsedEntry|null}
 */
function atomEntry(entry, base) {
  let link = '';
  const links = arr(entry.link);
  const alternate = links.find((l) => attr(l, 'rel') === 'alternate' && (!attr(l, 'type') || /html/i.test(attr(l, 'type'))))
    || links.find((l) => !attr(l, 'rel') || attr(l, 'rel') === 'alternate')
    || links[0];
  if (alternate) link = attr(alternate, 'href') || text(alternate);
  link = absolute(link, base);
  const idText = text(entry.id).trim();
  if (!link && /^https?:\/\//i.test(idText)) link = absolute(idText, base);
  if (!link) return null;
  const html = rawHtml(entry);
  const summarySource = text(entry.summary) || text(entry.content) || '';
  const published = toIso(text(entry.published) || text(entry.issued) || text(entry.updated) || text(entry.modified) || text(entry['dc:date']) || null);
  const enclosure = links.filter((l) => attr(l, 'rel') === 'enclosure' && /^image\//i.test(attr(l, 'type')));
  const synthetic = { ...entry, enclosure: [...arr(entry.enclosure), ...enclosure.map((l) => ({ '@_url': attr(l, 'href'), '@_type': attr(l, 'type') }))] };
  return {
    title: stripHtml(text(entry.title)) || stripHtml(summarySource).slice(0, 120) || '(untitled)',
    link,
    guid: idText || null,
    published,
    summary: stripHtml(summarySource),
    thumbnail: pickThumbnail(synthetic, base, html),
  };
}

/**
 * Parse a feed document.
 * @param {string} xml
 * @param {{baseUrl?: string}} [options]  baseUrl resolves relative links (usually the feed URL).
 * @returns {import('./types.js').ParsedFeed}
 * @throws {FeedParseError} when the document is not XML or not a feed.
 */
export function parseFeed(xml, options = {}) {
  const source = String(xml || '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new FeedParseError('empty document');
  if (/^<(!doctype\s+html|html)[\s>]/i.test(source)) throw new FeedParseError('document is an HTML page, not a feed');
  const kind = detectFeedKind(source);
  if (!kind) throw new FeedParseError('document is not an RSS or Atom feed');
  // The parser is deliberately lenient (real feeds are often slightly malformed), so the strict
  // validation result is only used when nothing usable comes out of the document.
  const validation = XMLValidator.validate(source);
  let doc;
  try {
    doc = parser.parse(source);
  } catch (error) {
    throw new FeedParseError('invalid XML: ' + (error instanceof Error ? error.message : String(error)));
  }
  const invalid = validation === true ? null : 'invalid XML: ' + (validation && validation.err ? validation.err.msg : 'unknown error');
  const base = options.baseUrl || '';
  /** @type {import('./types.js').ParsedEntry[]} */
  const entries = [];
  const seen = new Set();
  const push = (entry) => {
    if (!entry) return;
    if (seen.has(entry.link)) return;
    seen.add(entry.link);
    entries.push(entry);
  };

  if (kind === 'rss') {
    const channel = doc.rss && doc.rss.channel ? arr(doc.rss.channel)[0] : null;
    if (!channel) throw new FeedParseError('RSS document has no <channel>');
    const feedLink = absolute(arr(channel.link).map((l) => (typeof l === 'object' ? attr(l, 'href') || text(l) : String(l))).find((l) => l && !/\.(xml|rss)$/i.test(l)) || '', base) || null;
    const itemBase = feedLink || base;
    for (const item of arr(channel.item)) push(rssEntry(item, itemBase));
    if (invalid && entries.length === 0) throw new FeedParseError(invalid);
    return { kind, title: stripHtml(text(channel.title)), link: feedLink, entries };
  }
  if (kind === 'rdf') {
    const root = doc['rdf:RDF'] || {};
    const channel = arr(root.channel)[0] || {};
    const feedLink = absolute(text(channel.link), base) || null;
    for (const item of arr(root.item)) push(rssEntry(item, feedLink || base));
    if (invalid && entries.length === 0) throw new FeedParseError(invalid);
    return { kind, title: stripHtml(text(channel.title)), link: feedLink, entries };
  }
  const feed = doc.feed;
  if (!feed) throw new FeedParseError('Atom document has no <feed>');
  const links = arr(feed.link);
  const alt = links.find((l) => attr(l, 'rel') === 'alternate') || links.find((l) => !attr(l, 'rel'));
  const feedLink = alt ? absolute(attr(alt, 'href'), base) || null : null;
  const xmlBase = attr(feed, 'xml:base');
  for (const entry of arr(feed.entry)) push(atomEntry(entry, xmlBase || feedLink || base));
  if (invalid && entries.length === 0) throw new FeedParseError(invalid);
  return { kind, title: stripHtml(text(feed.title)), link: feedLink, entries };
}
