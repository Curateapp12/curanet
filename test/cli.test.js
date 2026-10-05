// End-to-end tests of the command-line helpers behind the skills, against a temporary data
// directory and a local HTTP server standing in for publishers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const run = promisify(execFile);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const fixture = (name) => readFileSync(path.join(ROOT, 'test/fixtures/feeds', name), 'utf8');

let dataDir;
let server;
let base;

/** @param {string} script @param {string[]} args */
async function cli(script, args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [path.join(ROOT, 'scripts', script), ...args, '--data', dataDir], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

const readJson = (rel) => JSON.parse(readFileSync(path.join(dataDir, rel), 'utf8'));

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'curanet-cli-'));
  mkdirSync(path.join(dataDir, 'items'));
  mkdirSync(path.join(dataDir, 'runs'));
  cpSync(path.join(ROOT, 'data/categories.json'), path.join(dataDir, 'categories.json'));
  writeFileSync(path.join(dataDir, 'hidden.json'), JSON.stringify({ version: 1, hidden: [] }));
  writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify({ version: 1, sources: [] }));
  server = http.createServer((req, res) => {
    if (req.url === '/feed.xml') { res.setHeader('content-type', 'application/rss+xml'); res.end(fixture('rss2-media.xml')); return; }
    if (req.url === '/atom.xml') { res.setHeader('content-type', 'application/atom+xml'); res.end(fixture('atom.xml')); return; }
    if (req.url === '/page') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>hi</body></html>'); return; }
    if (req.url === '/forbidden') { res.statusCode = 403; res.end('no'); return; }
    res.statusCode = 404; res.end('nope');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('add-source --check-only shows the feed and saves nothing', async () => {
  const r = await cli('add-source.js', [`${base}/feed.xml`, '--category', 'News / Politics', '--country', 'ca', '--language', 'EN', '--check-only']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Latest titles/);
  assert.match(r.stdout, /First story: bold & brave/);
  assert.equal(readJson('sources.json').sources.length, 0);
});

test('add-source refuses a web page but lists the feeds it advertises', async () => {
  const r = await cli('add-source.js', [`${base}/page`, '--category', 'News / Politics', '--country', 'CA', '--language', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not a feed/);
  assert.match(r.stderr, /\/feed\.xml/);
});

test('add-source reports a publisher refusal and does not save', async () => {
  const r = await cli('add-source.js', [`${base}/forbidden`, '--category', 'News / Politics', '--country', 'CA', '--language', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /refused/);
  assert.equal(readJson('sources.json').sources.length, 0);
});

test('add-source rejects a bad category, country or language with a helpful message', async () => {
  let r = await cli('add-source.js', [`${base}/feed.xml`, '--category', 'Nonsense / Nope', '--country', 'CA', '--language', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /News/);
  r = await cli('add-source.js', [`${base}/feed.xml`, '--category', 'News / Politics', '--country', 'Canada', '--language', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /two-letter country/);
  r = await cli('add-source.js', [`${base}/feed.xml`, '--category', 'News / Politics', '--country', 'CA', '--language', 'english']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /two-letter language/);
});

test('add-source saves the source and fetches it once', async () => {
  const r = await cli('add-source.js', [`${base}/feed.xml`, '--category', 'News / Politics', '--country', 'CA', '--language', 'en', '--name', 'Gazette']);
  assert.equal(r.code, 0, r.stderr);
  const sources = readJson('sources.json').sources;
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'gazette');
  assert.equal(sources[0].name, 'Gazette');
  assert.equal(sources[0].category, 'news');
  assert.equal(sources[0].subcategory, 'politics');
  assert.equal(sources[0].status, 'active');
  assert.equal(sources[0].fetch.lastResult, 'ok');
  const items = readJson('items/gazette.json').items;
  assert.equal(items.length, 4);
  assert.match(r.stdout, /4 item\(s\) added/);
});

test('add-source refuses a duplicate feed', async () => {
  const r = await cli('add-source.js', [`${base}/feed.xml?utm_source=x`, '--category', 'News / World', '--country', 'CA', '--language', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /already a source: gazette/);
});

test('add-source saves a YouTube channel as waiting_for_key without fetching', async () => {
  const r = await cli('add-source.js', ['https://www.youtube.com/@ExampleNews', '--category', 'News / Top Stories', '--country', 'CA', '--language', 'en']);
  assert.equal(r.code, 0, r.stderr);
  const yt = readJson('sources.json').sources.find((s) => s.type === 'youtube_channel');
  assert.ok(yt);
  assert.equal(yt.id, 'yt-examplenews');
  assert.equal(yt.handle, '@ExampleNews');
  assert.equal(yt.status, 'waiting_for_key');
  assert.ok(!existsSync(path.join(dataDir, 'items/yt-examplenews.json')));
  const dup = await cli('add-source.js', ['https://www.youtube.com/@examplenews', '--category', 'News / Top Stories', '--country', 'CA', '--language', 'en']);
  assert.equal(dup.code, 1);
  assert.match(dup.stderr, /already a source/);
});

test('add-video rejects links that are not videos', async () => {
  const r = await cli('add-video.js', ['https://www.youtube.com/@ExampleNews', '--category', 'News / Politics', '--country', 'CA', '--language', 'en']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /does not look like a YouTube video link/);
});

test('source.js list, pause, resume, edit and show', async () => {
  let r = await cli('source.js', ['list']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /gazette/);
  assert.match(r.stdout, /2 source\(s\)/);

  r = await cli('source.js', ['pause', 'gazette']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readJson('sources.json').sources.find((s) => s.id === 'gazette').status, 'paused');

  r = await cli('source.js', ['resume', 'Gazette']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readJson('sources.json').sources.find((s) => s.id === 'gazette').status, 'active');

  r = await cli('source.js', ['resume', 'yt-examplenews']);
  assert.equal(r.code, 1, 'a channel waiting for the key cannot be resumed');

  r = await cli('source.js', ['edit', 'gazette', '--category', 'Business / Economy', '--country', 'us', '--language', 'FR', '--name', 'The Gazette']);
  assert.equal(r.code, 0, r.stderr);
  const edited = readJson('sources.json').sources.find((s) => s.id === 'gazette');
  assert.equal(edited.category, 'business');
  assert.equal(edited.subcategory, 'economy');
  assert.equal(edited.country, 'US');
  assert.equal(edited.language, 'fr');
  assert.equal(edited.name, 'The Gazette');

  r = await cli('source.js', ['edit', 'gazette']);
  assert.equal(r.code, 1, 'edit with nothing to change fails');

  r = await cli('source.js', ['show', 'gazette']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /"items": 4/);

  r = await cli('source.js', ['pause', 'nothing-like-this']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /no source matches/);
});

test('hide-item removes the item and records it; the next fetch skips it', async () => {
  const items = readJson('items/gazette.json').items;
  const target = items[0];
  let r = await cli('hide-item.js', [target.link, '--note', 'test']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, new RegExp('Hidden: "' + target.title.slice(0, 10)));
  assert.equal(readJson('items/gazette.json').items.length, 3);
  const hidden = readJson('hidden.json').hidden;
  assert.equal(hidden.length, 1);
  assert.equal(hidden[0].link, target.link);
  assert.equal(hidden[0].sourceId, 'gazette');

  r = await cli('hide-item.js', ['https://nowhere.example/unknown']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /No stored item matched/);
  assert.equal(readJson('hidden.json').hidden.length, 2);

  // Fetch again: the hidden item must not come back.
  const sources = readJson('sources.json');
  const gazette = sources.sources.find((s) => s.id === 'gazette');
  gazette.fetch = null; // force a full download instead of a conditional request
  writeFileSync(path.join(dataDir, 'sources.json'), JSON.stringify(sources));
  const { stdout } = await run(process.execPath, [path.join(ROOT, 'scripts/fetch.js'), '--data', dataDir, '--source', 'gazette'], { cwd: ROOT });
  assert.match(stdout, /gazette/);
  assert.equal(readJson('items/gazette.json').items.length, 3);
});

test('category.js list, add and rename', async () => {
  let r = await cli('category.js', ['list']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /News \(news\)/);

  r = await cli('category.js', ['add', 'Robotics', '--parent', 'Technology', '--fr', 'Robotique']);
  assert.equal(r.code, 0, r.stderr);
  const tech = readJson('categories.json').categories.find((c) => c.id === 'technology');
  const robotics = tech.subcategories.find((s) => s.id === 'robotics');
  assert.deepEqual(robotics.name, { en: 'Robotics', fr: 'Robotique' });

  r = await cli('category.js', ['add', 'Robotics', '--parent', 'Technology']);
  assert.equal(r.code, 1, 'duplicate refused');

  r = await cli('category.js', ['add', 'Science & Nature']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(readJson('categories.json').categories.some((c) => c.id === 'science-nature'));

  r = await cli('category.js', ['rename', 'Life', '--name', 'Lifestyle']);
  assert.equal(r.code, 0, r.stderr);
  const life = readJson('categories.json').categories.find((c) => c.id === 'life');
  assert.equal(life.name.en, 'Lifestyle');

  r = await cli('category.js', ['rename', 'Technology / Robotics', '--fr', 'Robots']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readJson('categories.json').categories.find((c) => c.id === 'technology').subcategories.find((s) => s.id === 'robotics').name.fr, 'Robots');
});

test('source.js remove deletes the source and its items', async () => {
  const r = await cli('source.js', ['remove', 'gazette']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Removed gazette/);
  assert.ok(!readJson('sources.json').sources.some((s) => s.id === 'gazette'));
  assert.ok(!existsSync(path.join(dataDir, 'items/gazette.json')));
});
