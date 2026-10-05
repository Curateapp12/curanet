// Parses saved copies of real publisher feeds (fetched 2026-10-05) to make sure the parser copes
// with what publishers actually send: CDATA, media namespaces, odd dates, relative links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parseFeed } from '../src/lib/feed.js';

const dir = new URL('./fixtures/feeds/real/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.xml')).sort();

test('real fixtures exist', () => {
  assert.ok(files.length >= 8, 'expected at least 8 saved feeds, found ' + files.length);
});

for (const file of files) {
  test(`real feed ${file} parses into clean entries`, () => {
    const xml = readFileSync(new URL(file, dir), 'utf8');
    const feed = parseFeed(xml, { baseUrl: 'https://example.invalid/feed.xml' });
    assert.equal(typeof feed.title, 'string', 'feed title is a string (some publishers leave it empty)');
    assert.ok(feed.entries.length >= 5, `at least 5 entries (got ${feed.entries.length})`);
    const links = new Set();
    let dated = 0;
    for (const entry of feed.entries) {
      assert.ok(/^https?:\/\//.test(entry.link), 'absolute link: ' + entry.link);
      assert.ok(!links.has(entry.link), 'links unique within a feed');
      links.add(entry.link);
      assert.ok(!entry.link.includes('example.invalid'), 'no entry link fell back to the base URL');
      assert.ok(entry.title.length > 0, 'title present');
      assert.ok(!/<[a-zA-Z/!]/.test(entry.title), 'no HTML in title: ' + entry.title);
      assert.ok(!/<[a-zA-Z/!]/.test(entry.summary), 'no HTML in summary');
      assert.ok(!/&(amp|lt|gt|quot|#\d+);/.test(entry.title), 'entities decoded in title: ' + entry.title);
      if (entry.published) {
        dated += 1;
        assert.ok(!Number.isNaN(Date.parse(entry.published)), 'ISO date');
      }
      if (entry.thumbnail) assert.ok(/^https?:\/\//.test(entry.thumbnail), 'absolute thumbnail');
    }
    assert.ok(dated >= feed.entries.length * 0.8, `most entries dated (${dated}/${feed.entries.length})`);
  });
}
