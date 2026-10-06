import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, stripHtml, truncate, normalizeLink, itemIdFromLink, toIso, slugify } from '../src/lib/sanitize.js';

test('stripHtml removes tags, scripts and comments and decodes entities', () => {
  const html = '<p>Hello <b>world</b> &amp; friends<script>alert(1)</script><!-- c --> &eacute;t&#233; &#x1F600;</p>';
  assert.equal(stripHtml(html), 'Hello world & friends été 😀');
});

test('stripHtml handles double-encoded HTML and CDATA', () => {
  assert.equal(stripHtml('&lt;p&gt;Hi &lt;i&gt;there&lt;/i&gt;&lt;/p&gt;'), 'Hi there');
  assert.equal(stripHtml('<![CDATA[<div>Inside <em>cdata</em></div>]]>'), 'Inside cdata');
});

test('stripHtml never leaves anything that looks like a tag', () => {
  const nasty = '<img src=x onerror=alert(1)><svg><script>1</script></svg><a href="javascript:x">link</a>';
  const out = stripHtml(nasty);
  assert.equal(out, 'link');
  assert.ok(!/[<>]/.test(out));
});

test('stripHtml collapses whitespace and strips control characters', () => {
  assert.equal(stripHtml('  a \n\n b\u0000\u0007 c  '), 'a b c');
  assert.equal(stripHtml(null), '');
  assert.equal(stripHtml(undefined), '');
});

test('decodeEntities keeps unknown named entities and drops invalid code points', () => {
  assert.equal(decodeEntities('&foo; &#0; &#1114112;'), '&foo;  ');
  assert.equal(decodeEntities('&#146;quoted&#146;'), '’quoted’');
});

test('truncate cuts at a word boundary with an ellipsis and never exceeds the limit', () => {
  const long = 'word '.repeat(100).trim();
  const out = truncate(long, 300);
  assert.ok(Array.from(out).length <= 300, 'length ' + out.length);
  assert.ok(out.endsWith('…'));
  assert.equal(truncate('short', 300), 'short');
  assert.equal(Array.from(truncate('😀'.repeat(400), 300)).length, 300);
});

test('normalizeLink removes tracking parameters, fragments and default ports, and sorts the rest', () => {
  const url = 'HTTPS://Example.com:443/a/b?utm_source=x&b=2&a=1&fbclid=zzz#section';
  assert.equal(normalizeLink(url), 'https://example.com/a/b?a=1&b=2');
  assert.equal(normalizeLink('https://example.com/path?utm_campaign=only'), 'https://example.com/path');
  assert.equal(normalizeLink('/relative/path', 'https://example.com/feed.xml'), 'https://example.com/relative/path');
  assert.equal(normalizeLink('not a url'), 'not a url');
  assert.equal(normalizeLink('mailto:x@y.z'), 'mailto:x@y.z');
});

test('itemIdFromLink is stable and 16 hex characters', () => {
  const id = itemIdFromLink('https://example.com/a');
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(id, itemIdFromLink('https://example.com/a'));
  assert.notEqual(id, itemIdFromLink('https://example.com/b'));
});

test('toIso reads RFC 822 and ISO dates and rejects nonsense', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(toIso('Mon, 05 Oct 2026 10:00:00 GMT', now), '2026-10-05T10:00:00.000Z');
  assert.equal(toIso('Mon, 05 Oct 2026 06:00:00 -0400', now), '2026-10-05T10:00:00.000Z');
  assert.equal(toIso('2026-10-05T10:00:00+00:00', now), '2026-10-05T10:00:00.000Z');
  assert.equal(toIso('2026-10-05 10:00:00', now), '2026-10-05T10:00:00.000Z');
  assert.equal(toIso('', now), null);
  assert.equal(toIso('yesterday', now), null);
  assert.equal(toIso('1980-01-01T00:00:00Z', now), null, 'too old');
  assert.equal(toIso('2030-01-01T00:00:00Z', now), null, 'in the future');
  assert.equal(toIso(null, now), null);
});

test('slugify makes safe ids', () => {
  assert.equal(slugify('Le Devoir — Économie!'), 'le-devoir-economie');
  assert.equal(slugify('   '), 'source');
});

test('stripHtml finishes quickly on hostile input and never leaves a tag start', () => {
  const hostile = ['<'.repeat(200_000), '<img '.repeat(40_000), '<!--'.repeat(50_000), '<script'.repeat(30_000), '<b 5% after the vote', 'Use &lt;b to bold', 'a &lt;/ b &lt;!-- c', '<p>ok</p><div'];
  for (const input of hostile) {
    const started = Date.now();
    const out = stripHtml(input);
    const ms = Date.now() - started;
    assert.ok(ms < 500, `took ${ms} ms on ${input.slice(0, 12)}…`);
    assert.ok(!/<[a-zA-Z/!]/.test(out), 'no tag start left in: ' + out.slice(0, 40));
  }
  assert.equal(stripHtml('Use &lt;b to bold'), 'Use b to bold');
  assert.equal(stripHtml('5 < 6 and 7 > 3'), '5 < 6 and 7 > 3', 'plain comparisons survive');
  assert.equal(stripHtml('<p>Hello <b>world</b></p><script>x</script>tail'), 'Hello world tail');
  assert.equal(stripHtml('<scripts>not a script</scripts>'), 'not a script');
});

test('toIso rejects absurdly long date strings quickly', () => {
  const started = Date.now();
  assert.equal(toIso(' ('.repeat(100_000)), null);
  assert.ok(Date.now() - started < 200);
});

test('stripHtml decodes XML-escaped entities even when no tag is present', () => {
  assert.equal(stripHtml('Tom &amp;amp; Jerry &amp;#8211; a review'), 'Tom & Jerry – a review');
  assert.equal(stripHtml('viruses &amp;mdash; now called'), 'viruses — now called');
});

test('toIso understands common zone abbreviations', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(toIso('Mon, 05 Oct 2026 10:00:00 CET', now), '2026-10-05T09:00:00.000Z');
  assert.equal(toIso('Mon, 05 Oct 2026 10:00:00 CEST', now), '2026-10-05T08:00:00.000Z');
  assert.equal(toIso('Mon, 05 Oct 2026 10:00:00 BST', now), '2026-10-05T09:00:00.000Z');
  assert.equal(toIso('Mon, 05 Oct 2026 10:00:00 AEST', now), '2026-10-05T00:00:00.000Z');
  assert.equal(toIso('Mon, 05 Oct 2026 10:00:00 EDT', now), '2026-10-05T14:00:00.000Z', 'North American names still work');
});
