import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, detectFeedKind, FeedParseError } from '../src/lib/feed.js';

const fixture = (name) => readFileSync(new URL('./fixtures/feeds/' + name, import.meta.url), 'utf8');

test('detectFeedKind sniffs rss, atom, rdf and nothing else', () => {
  assert.equal(detectFeedKind(fixture('rss2-media.xml')), 'rss');
  assert.equal(detectFeedKind(fixture('atom.xml')), 'atom');
  assert.equal(detectFeedKind(fixture('rdf.xml')), 'rdf');
  assert.equal(detectFeedKind('<html><body>no</body></html>'), null);
});

test('parseFeed reads RSS 2.0 with media, enclosures, relative links and bad dates', () => {
  const feed = parseFeed(fixture('rss2-media.xml'), { baseUrl: 'https://gazette.example/feed.xml' });
  assert.equal(feed.kind, 'rss');
  assert.equal(feed.title, 'Example Gazette & Times');
  assert.equal(feed.link, 'https://gazette.example/');
  assert.equal(feed.entries.length, 4, 'duplicate link and link-less item are skipped');

  const [first, second, third, fourth] = feed.entries;
  assert.equal(first.title, 'First story: bold & brave');
  assert.equal(first.link, 'https://gazette.example/news/first?utm_source=rss&id=1#top', 'parser keeps the raw link; the store normalises');
  assert.equal(first.guid, 'gazette-1');
  assert.equal(first.published, '2026-10-05T10:00:00.000Z');
  assert.equal(first.summary, 'Summary with link and image.');
  assert.equal(first.thumbnail, 'https://gazette.example/img/large.jpg', 'largest media:content wins');

  assert.equal(second.link, 'https://gazette.example/news/second', 'relative link resolved against the channel link');
  assert.equal(second.published, '2026-10-04T12:30:00.000Z');
  assert.equal(second.summary, 'Plain summary été.');
  assert.equal(second.thumbnail, 'https://gazette.example/img/enclosure.png');

  assert.equal(third.link, 'https://gazette.example/news/third', 'permalink guid used as link');
  assert.equal(third.thumbnail, 'https://gazette.example/img/content.jpg', 'tracking pixel skipped, relative image resolved');
  assert.equal(third.summary, 'Body');

  assert.equal(fourth.published, null);
  assert.equal(fourth.thumbnail, null, 'audio enclosure is not an image');
});

test('parseFeed reads Atom with alternate links, image enclosures and xhtml content', () => {
  const feed = parseFeed(fixture('atom.xml'), { baseUrl: 'https://atom.example/feed.xml' });
  assert.equal(feed.kind, 'atom');
  assert.equal(feed.title, 'Atom Example');
  assert.equal(feed.link, 'https://atom.example/');
  assert.equal(feed.entries.length, 3);
  const [one, two, three] = feed.entries;
  assert.equal(one.title, 'Entry one');
  assert.equal(one.link, 'https://atom.example/posts/one');
  assert.equal(one.guid, 'tag:atom.example,2026:one');
  assert.equal(one.published, '2026-10-05T11:00:00.000Z', 'published beats updated');
  assert.equal(one.summary, 'Summary one', 'summary beats content');
  assert.equal(one.thumbnail, 'https://atom.example/img/one.jpg');
  assert.equal(two.link, 'https://atom.example/posts/two');
  assert.equal(two.published, '2026-10-04T11:00:00.000Z');
  assert.equal(two.thumbnail, 'https://atom.example/img/two.jpg');
  assert.equal(two.summary, 'XHTML content');
  assert.equal(three.link, 'https://atom.example/posts/three');
});

test('parseFeed reads RSS 1.0 / RDF', () => {
  const feed = parseFeed(fixture('rdf.xml'));
  assert.equal(feed.kind, 'rdf');
  assert.equal(feed.entries.length, 2);
  assert.equal(feed.entries[0].link, 'https://rdf.example/a');
  assert.equal(feed.entries[0].published, '2026-10-05T08:00:00.000Z');
  assert.equal(feed.entries[1].summary, '');
});

test('parseFeed rejects HTML pages, empty bodies and broken XML', () => {
  assert.throws(() => parseFeed('<!DOCTYPE html><html><body>nope</body></html>'), FeedParseError);
  assert.throws(() => parseFeed(''), FeedParseError);
  assert.throws(() => parseFeed('<rss><channel><item><title>x</title></item></channel>'), FeedParseError);
  assert.throws(() => parseFeed('{"json": true}'), FeedParseError);
});

test('parseFeed output contains no HTML in titles or summaries', () => {
  const xml = `<rss version="2.0"><channel><title>T</title><link>https://x.example/</link>
    <item><title>&lt;script&gt;alert(1)&lt;/script&gt;Safe</title><link>https://x.example/1</link>
    <description><![CDATA[<img src=x onerror=alert(1)>Text <a href="javascript:alert(1)">here</a>]]></description></item>
    </channel></rss>`;
  const feed = parseFeed(xml);
  assert.equal(feed.entries[0].title, 'Safe');
  assert.equal(feed.entries[0].summary, 'Text here');
});
