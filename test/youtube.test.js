import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  YouTubeApiError,
  OEmbedError,
  parseVideoId,
  canonicalVideoUrl,
  thumbnailUrl,
  fetchOEmbed,
  oembedToItem,
  channelHandleFromUrl,
  channelIdFromUrl,
  resolveChannel,
  fetchUploads,
  fetchChannelVideos,
} from '../src/lib/youtube.js';
import { itemIdFromLink, normalizeLink } from '../src/lib/sanitize.js';

const fixture = (name) => JSON.parse(readFileSync(new URL('./fixtures/youtube/' + name, import.meta.url), 'utf8'));

const USER_AGENT = 'Curanet/0.1 (+https://curanet.io)';
const KEY = 'AIzaSySECRETKEYSECRETKEYSECRETKEYSECRE';
const CHANNEL_ID = 'UCuFFtHWoLl5fauMMD5Ww2jA';
const UPLOADS_ID = 'UUuFFtHWoLl5fauMMD5Ww2jA';

/** Every URL any fake fetch in this file was asked for. Checked at the end: none may be a search call. */
const everyRequestedUrl = [];

/**
 * A fake fetch that records calls and answers through `respond(url, init)`, which returns
 * `{ status, body }` (body is an object, serialised as JSON, or a string), or `null` for 404.
 */
function recorder(respond) {
  const calls = [];
  const fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    everyRequestedUrl.push(url);
    const out = respond(new URL(url), init);
    if (!out) return new Response('Not Found', { status: 404 });
    const body = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    return new Response(body, { status: out.status || 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

/** A fake fetch for the Data API that serves fixtures by endpoint and page token. */
function apiRecorder(overrides = {}) {
  return recorder((url) => {
    if (overrides.any) return overrides.any(url);
    if (url.pathname === '/youtube/v3/channels') {
      if (overrides.channels) return overrides.channels(url);
      return { status: 200, body: fixture('channels-by-handle.json') };
    }
    if (url.pathname === '/youtube/v3/playlistItems') {
      if (overrides.playlistItems) return overrides.playlistItems(url);
      const token = url.searchParams.get('pageToken');
      if (!token) return { status: 200, body: fixture('playlist-page1.json') };
      if (token === 'CAMQAA') return { status: 200, body: fixture('playlist-page2.json') };
      return { status: 400, body: { error: { code: 400, message: 'bad page token', errors: [{ reason: 'invalidPageToken' }] } } };
    }
    return null;
  });
}

const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

// ---------------------------------------------------------------------------------------------
// parseVideoId and friends

test('parseVideoId accepts bare ids and every common YouTube link shape', () => {
  const id = 'dQw4w9WgXcQ';
  const accepted = [
    id,
    '  dQw4w9WgXcQ  ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123&index=2',
    'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=abcDEF123&t=10',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0',
    'https://www.youtube.com/live/dQw4w9WgXcQ?feature=share',
    'https://www.youtube.com/v/dQw4w9WgXcQ',
    'www.youtube.com/watch?v=dQw4w9WgXcQ',
    'youtu.be/dQw4w9WgXcQ',
  ];
  for (const input of accepted) assert.equal(parseVideoId(input), id, 'should accept ' + JSON.stringify(input));
  assert.equal(parseVideoId('https://youtu.be/u_4Vm-9TzKo'), 'u_4Vm-9TzKo', 'underscore and dash are valid id characters');
});

test('parseVideoId rejects channels, playlists, other sites and random strings', () => {
  const rejected = [
    '',
    '   ',
    null,
    undefined,
    42,
    'hello',
    'not a video at all',
    'dQw4w9WgXc', // 10 characters
    'dQw4w9WgXcQQ', // 12 characters
    'dQw4w9WgXc!', // invalid character
    'https://www.youtube.com/@CBCNews',
    'https://www.youtube.com/channel/UCuFFtHWoLl5fauMMD5Ww2jA',
    'https://www.youtube.com/c/CBCNews',
    'https://www.youtube.com/user/CBCNews',
    'https://www.youtube.com/playlist?list=PLx8K1mWd9bQ',
    'https://www.youtube.com/watch?list=PLx8K1mWd9bQ',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=',
    'https://www.youtube.com/',
    'https://www.youtube.com/feed/subscriptions',
    'https://www.youtube.com/results?search_query=dQw4w9WgXcQ',
    'https://vimeo.com/123456789',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'ftp://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'javascript:alert(1)',
    'https://www.youtube.com/embed/',
    'https://www.youtube.com/shorts/tooShortId',
  ];
  for (const input of rejected) assert.equal(parseVideoId(input), null, 'should reject ' + JSON.stringify(input));
});

test('canonicalVideoUrl and thumbnailUrl build the expected addresses', () => {
  assert.equal(canonicalVideoUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(thumbnailUrl('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

// ---------------------------------------------------------------------------------------------
// oEmbed

test('fetchOEmbed asks the oEmbed endpoint for the canonical url with the Curanet user agent', async () => {
  const { fetch, calls } = recorder((url) => (url.pathname === '/oembed' ? { status: 200, body: fixture('oembed-ok.json') } : null));
  const info = await fetchOEmbed('https://youtu.be/k7Rm2pXqW3c?si=xyz', { fetch });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dk7Rm2pXqW3c&format=json');
  assert.equal(new Headers(calls[0].init.headers).get('user-agent'), USER_AGENT);
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'request carries an abort signal for the timeout');

  assert.deepEqual(info, {
    videoId: 'k7Rm2pXqW3c',
    url: 'https://www.youtube.com/watch?v=k7Rm2pXqW3c',
    title: 'Ottawa unveils fall economic statement as deficit forecast widens | CBC News',
    channel: 'CBC News',
    channelUrl: 'https://www.youtube.com/@CBCNews',
    thumbnail: 'https://i.ytimg.com/vi/k7Rm2pXqW3c/hqdefault.jpg',
  });
});

test('fetchOEmbed accepts a bare id and the same canonical url is requested', async () => {
  const { fetch, calls } = recorder(() => ({ status: 200, body: fixture('oembed-ok.json') }));
  const info = await fetchOEmbed('k7Rm2pXqW3c', { fetch });
  assert.equal(calls[0].url, 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dk7Rm2pXqW3c&format=json');
  assert.equal(info.videoId, 'k7Rm2pXqW3c');
});

test('fetchOEmbed throws OEmbedError with the status and a plain-language message on 401, 404 and 400', async () => {
  for (const [status, pattern] of [[401, /private|unavailable/i], [404, /not found|no video|does not exist/i], [400, /not a valid|invalid|recognis/i]]) {
    const { fetch } = recorder(() => ({ status, body: status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Bad Request' }));
    const error = await fetchOEmbed('dQw4w9WgXcQ', { fetch }).then(() => null, (e) => e);
    assert.ok(error instanceof OEmbedError, 'status ' + status + ' should be an OEmbedError');
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'OEmbedError');
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    assert.match(error.message, /dQw4w9WgXcQ/, 'message names the video');
  }
});

test('fetchOEmbed rejects input that is not a video link without touching the network', async () => {
  const { fetch, calls } = recorder(() => ({ status: 200, body: fixture('oembed-ok.json') }));
  const error = await fetchOEmbed('https://www.youtube.com/@CBCNews', { fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof OEmbedError);
  assert.equal(error.status, null);
  assert.match(error.message, /not a YouTube video link/i);
  assert.equal(calls.length, 0);
});

test('fetchOEmbed turns an unreadable answer into an OEmbedError', async () => {
  const { fetch } = recorder(() => ({ status: 200, body: '<html>nope</html>' }));
  const error = await fetchOEmbed('dQw4w9WgXcQ', { fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof OEmbedError);
  assert.equal(error.status, 200);
  assert.match(error.message, /could not be read/i);
});

test('fetchOEmbed reports a timeout in plain language when the request is aborted', async () => {
  const { fetch } = recorder(() => { throw abortError(); });
  const error = await fetchOEmbed('dQw4w9WgXcQ', { fetch, timeoutMs: 3000 }).then(() => null, (e) => e);
  assert.ok(error instanceof OEmbedError);
  assert.equal(error.status, null);
  assert.match(error.message, /did not answer within 3 seconds/i);
});

test('oembedToItem maps the oEmbed answer onto an Item dated now', () => {
  const now = new Date('2026-10-05T23:00:00.000Z');
  const oembed = {
    videoId: 'k7Rm2pXqW3c',
    url: 'https://www.youtube.com/watch?v=k7Rm2pXqW3c',
    title: '  Ottawa &amp; the <b>deficit</b> | CBC News ',
    channel: 'CBC News',
    channelUrl: 'https://www.youtube.com/@CBCNews',
    thumbnail: 'https://i.ytimg.com/vi/k7Rm2pXqW3c/maxresdefault.jpg',
  };
  const item = oembedToItem(oembed, { now });
  assert.deepEqual(item, {
    id: itemIdFromLink(normalizeLink('https://www.youtube.com/watch?v=k7Rm2pXqW3c')),
    guid: 'yt:k7Rm2pXqW3c',
    link: 'https://www.youtube.com/watch?v=k7Rm2pXqW3c',
    title: 'Ottawa & the deficit | CBC News',
    excerpt: '',
    published: '2026-10-05T23:00:00.000Z',
    thumbnail: 'https://i.ytimg.com/vi/k7Rm2pXqW3c/maxresdefault.jpg',
    type: 'video',
    videoId: 'k7Rm2pXqW3c',
    addedAt: '2026-10-05T23:00:00.000Z',
  });
  assert.equal(item.published, now.toISOString());
  assert.equal(item.addedAt, item.published);
});

test('oembedToItem falls back to the standard thumbnail and defaults now to the current time', () => {
  const before = Date.now();
  const item = oembedToItem({ videoId: 'dQw4w9WgXcQ', url: canonicalVideoUrl('dQw4w9WgXcQ'), title: 'Never gonna', channel: 'x', channelUrl: 'y', thumbnail: null });
  assert.equal(item.thumbnail, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.ok(Date.parse(item.published) >= before && Date.parse(item.published) <= Date.now() + 1000);
  assert.equal(item.id.length, 16);
  assert.match(item.id, /^[0-9a-f]{16}$/);
});

// ---------------------------------------------------------------------------------------------
// Channel url helpers

test('channelHandleFromUrl reads @handles and nothing else', () => {
  assert.equal(channelHandleFromUrl('https://www.youtube.com/@CBCNews'), '@CBCNews');
  assert.equal(channelHandleFromUrl('https://youtube.com/@CBCNews/videos'), '@CBCNews');
  assert.equal(channelHandleFromUrl('https://m.youtube.com/@Radio-Canada.Info?si=1'), '@Radio-Canada.Info');
  assert.equal(channelHandleFromUrl('@CBCNews'), '@CBCNews', 'a bare handle is accepted as is');
  assert.equal(channelHandleFromUrl('https://www.youtube.com/c/CBCNews'), null);
  assert.equal(channelHandleFromUrl('https://www.youtube.com/channel/UCuFFtHWoLl5fauMMD5Ww2jA'), null);
  assert.equal(channelHandleFromUrl('https://www.youtube.com/user/CBCNews'), null);
  assert.equal(channelHandleFromUrl('https://example.com/@CBCNews'), null);
  assert.equal(channelHandleFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(channelHandleFromUrl(''), null);
  assert.equal(channelHandleFromUrl(null), null);
});

test('channelIdFromUrl reads UC ids and nothing else', () => {
  assert.equal(channelIdFromUrl('https://www.youtube.com/channel/UCuFFtHWoLl5fauMMD5Ww2jA'), CHANNEL_ID);
  assert.equal(channelIdFromUrl('https://www.youtube.com/channel/UCuFFtHWoLl5fauMMD5Ww2jA/videos?view=0'), CHANNEL_ID);
  assert.equal(channelIdFromUrl(CHANNEL_ID), CHANNEL_ID, 'a bare id is accepted as is');
  assert.equal(channelIdFromUrl('https://www.youtube.com/@CBCNews'), null);
  assert.equal(channelIdFromUrl('https://www.youtube.com/channel/notachannel'), null);
  assert.equal(channelIdFromUrl('https://example.com/channel/UCuFFtHWoLl5fauMMD5Ww2jA'), null);
  assert.equal(channelIdFromUrl(UPLOADS_ID), null, 'a playlist id is not a channel id');
  assert.equal(channelIdFromUrl(''), null);
  assert.equal(channelIdFromUrl(undefined), null);
});

// ---------------------------------------------------------------------------------------------
// channels.list

test('resolveChannel by handle calls channels.list with forHandle and the key, never search', async () => {
  const { fetch, calls } = apiRecorder();
  const source = { id: 'yt-cbc-news', type: 'youtube_channel', url: 'https://www.youtube.com/@CBCNews', handle: '@CBCNews', channelId: null };
  const resolved = await resolveChannel(source, { apiKey: KEY, fetch });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/youtube/v3/channels');
  assert.equal(url.searchParams.get('part'), 'contentDetails,snippet');
  assert.equal(url.searchParams.get('forHandle'), '@CBCNews');
  assert.equal(url.searchParams.get('id'), null);
  assert.equal(url.searchParams.get('key'), KEY);
  assert.ok(!calls[0].url.includes('/search'));
  assert.equal(new Headers(calls[0].init.headers).get('user-agent'), USER_AGENT);
  assert.equal(calls[0].init.method || 'GET', 'GET');

  assert.deepEqual(resolved, { channelId: CHANNEL_ID, uploadsPlaylistId: UPLOADS_ID, title: 'CBC News', handle: '@cbcnews' });
});

test('resolveChannel derives the handle from the source url when the handle field is missing', async () => {
  const { fetch, calls } = apiRecorder();
  await resolveChannel({ url: 'https://www.youtube.com/@CBCNews' }, { apiKey: KEY, fetch });
  assert.equal(new URL(calls[0].url).searchParams.get('forHandle'), '@CBCNews');
});

test('resolveChannel by id calls channels.list with id and no forHandle', async () => {
  const { fetch, calls } = apiRecorder();
  const source = { id: 'yt-cbc-news', url: 'https://www.youtube.com/channel/' + CHANNEL_ID, handle: '@CBCNews', channelId: CHANNEL_ID };
  const resolved = await resolveChannel(source, { apiKey: KEY, fetch });

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/youtube/v3/channels');
  assert.equal(url.searchParams.get('id'), CHANNEL_ID);
  assert.equal(url.searchParams.get('forHandle'), null);
  assert.equal(url.searchParams.get('key'), KEY);
  assert.equal(resolved.channelId, CHANNEL_ID);
  assert.equal(resolved.uploadsPlaylistId, UPLOADS_ID);
});

test('resolveChannel reports a missing channel in plain language', async () => {
  const { fetch } = apiRecorder({ channels: () => ({ status: 200, body: fixture('channels-empty.json') }) });
  const error = await resolveChannel({ url: 'https://www.youtube.com/@NoSuchChannel' }, { apiKey: KEY, fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.name, 'YouTubeApiError');
  assert.match(error.message, /channel not found/);
  assert.match(error.message, /@NoSuchChannel/);
  assert.equal(error.reason, 'notFound');
  assert.equal(error.status, null);
});

test('resolveChannel refuses a source with neither handle nor channel id, without a request', async () => {
  const { fetch, calls } = apiRecorder();
  const error = await resolveChannel({ url: 'https://www.youtube.com/c/CBCNews' }, { apiKey: KEY, fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.match(error.message, /handle|channel id/i);
  assert.equal(calls.length, 0);
});

test('resolveChannel refuses to run without an API key, without a request', async () => {
  const { fetch, calls } = apiRecorder();
  for (const apiKey of ['', undefined, null]) {
    const error = await resolveChannel({ handle: '@CBCNews' }, { apiKey, fetch }).then(() => null, (e) => e);
    assert.ok(error instanceof YouTubeApiError);
    assert.equal(error.reason, 'missingKey');
    assert.match(error.message, /YOUTUBE_API_KEY/);
  }
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// playlistItems.list

test('fetchUploads follows nextPageToken up to maxPages and skips the private video', async () => {
  const { fetch, calls } = apiRecorder();
  const entries = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch, maxPages: 2 });

  assert.equal(calls.length, 2);
  const first = new URL(calls[0].url);
  assert.equal(first.origin + first.pathname, 'https://www.googleapis.com/youtube/v3/playlistItems');
  assert.equal(first.searchParams.get('part'), 'snippet,contentDetails');
  assert.equal(first.searchParams.get('maxResults'), '50');
  assert.equal(first.searchParams.get('playlistId'), UPLOADS_ID);
  assert.equal(first.searchParams.get('key'), KEY);
  assert.equal(first.searchParams.get('pageToken'), null);
  const second = new URL(calls[1].url);
  assert.equal(second.pathname, '/youtube/v3/playlistItems');
  assert.equal(second.searchParams.get('pageToken'), 'CAMQAA');
  assert.equal(second.searchParams.get('playlistId'), UPLOADS_ID);
  for (const call of calls) assert.equal(new Headers(call.init.headers).get('user-agent'), USER_AGENT);

  assert.deepEqual(entries.map((e) => e.videoId), ['k7Rm2pXqW3c', 'Zt9bLw4HqYE', 'Qw8Fj2LpN5s', 'u_4Vm-9TzKo'], 'private video x9PzK3mQ8vL is skipped');

  const [a, b, c, d] = entries;
  assert.deepEqual(a, {
    videoId: 'k7Rm2pXqW3c',
    title: 'Ottawa unveils fall economic statement as deficit forecast widens | CBC News',
    link: 'https://www.youtube.com/watch?v=k7Rm2pXqW3c',
    guid: 'yt:k7Rm2pXqW3c',
    published: '2026-10-05T14:02:47.000Z',
    summary: 'The federal government tabled its fall economic statement on Monday, projecting a larger deficit than forecast in the spring budget. Read more: https://www.cbc.ca/news/politics/fall-economic-statement-2026 »»» Subscribe to CBC News to watch more videos: http://bit.ly/1RreYWS Connect with CBC News Online: For breaking news, video, audio and in-depth coverage: http://bit.ly/1Z0m6iX',
    thumbnail: 'https://i.ytimg.com/vi/k7Rm2pXqW3c/hqdefault.jpg',
  });
  assert.equal(a.published, '2026-10-05T14:02:47.000Z', 'contentDetails.videoPublishedAt wins over snippet.publishedAt');
  assert.equal(b.title, 'Wildfire season review: what B.C. learned in 2026 & what comes next');
  assert.equal(b.thumbnail, 'https://i.ytimg.com/vi/Zt9bLw4HqYE/mqdefault.jpg', 'medium is used when high is missing');
  assert.equal(c.title, 'Montreal transit strike enters second week — commuters react | Full report');
  assert.equal(c.published, '2026-10-03T20:45:30.000Z');
  assert.equal(d.published, '2026-10-02T11:05:09.000Z', 'snippet.publishedAt is used when videoPublishedAt is missing');
  assert.equal(d.summary, '');
  assert.equal(d.link, 'https://www.youtube.com/watch?v=u_4Vm-9TzKo');
});

test('fetchUploads stops after one page by default', async () => {
  const { fetch, calls } = apiRecorder();
  const entries = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch });
  assert.equal(calls.length, 1);
  assert.deepEqual(entries.map((e) => e.videoId), ['k7Rm2pXqW3c', 'Zt9bLw4HqYE']);
});

test('fetchUploads honours maxResults and skips deleted videos and non-video entries', async () => {
  const page = fixture('playlist-page2.json');
  delete page.prevPageToken;
  page.items.push({
    kind: 'youtube#playlistItem',
    id: 'x1',
    snippet: { publishedAt: '2026-10-01T00:00:00Z', title: 'Deleted video', description: 'This video is unavailable.', thumbnails: {}, resourceId: { kind: 'youtube#video', videoId: 'Ab1Cd2Ef3Gh' } },
    contentDetails: { videoId: 'Ab1Cd2Ef3Gh' },
  });
  page.items.push({
    kind: 'youtube#playlistItem',
    id: 'x2',
    snippet: { publishedAt: '2026-10-01T00:00:00Z', title: 'A playlist, not a video', description: '', thumbnails: {}, resourceId: { kind: 'youtube#playlist', playlistId: 'PLabc' } },
    contentDetails: {},
  });
  page.items.push({
    kind: 'youtube#playlistItem',
    id: 'x3',
    snippet: { publishedAt: '2026-10-01T00:00:00Z', title: 'No thumbnails at all', description: '', resourceId: { kind: 'youtube#video', videoId: 'Zz9Yy8Xx7Ww' } },
    contentDetails: { videoId: 'Zz9Yy8Xx7Ww' },
  });
  const { fetch, calls } = apiRecorder({ playlistItems: () => ({ status: 200, body: page }) });
  const entries = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch, maxResults: 10 });
  assert.equal(new URL(calls[0].url).searchParams.get('maxResults'), '10');
  assert.deepEqual(entries.map((e) => e.videoId), ['Qw8Fj2LpN5s', 'u_4Vm-9TzKo', 'Zz9Yy8Xx7Ww']);
  assert.equal(entries[2].thumbnail, 'https://i.ytimg.com/vi/Zz9Yy8Xx7Ww/hqdefault.jpg', 'standard thumbnail when the API gives none');
});

// ---------------------------------------------------------------------------------------------
// fetchChannelVideos

test('fetchChannelVideos derives the uploads playlist from a known channel id and skips channels.list', async () => {
  const { fetch, calls } = apiRecorder();
  const source = { id: 'yt-cbc-news', url: 'https://www.youtube.com/@CBCNews', handle: '@CBCNews', channelId: CHANNEL_ID };
  const result = await fetchChannelVideos(source, { apiKey: KEY, fetch });

  assert.equal(calls.length, 1, 'one request only');
  assert.equal(new URL(calls[0].url).pathname, '/youtube/v3/playlistItems');
  assert.equal(new URL(calls[0].url).searchParams.get('playlistId'), UPLOADS_ID);
  assert.equal(result.channelId, CHANNEL_ID);
  assert.equal(result.uploadsPlaylistId, UPLOADS_ID);
  assert.deepEqual(result.entries.map((e) => e.videoId), ['k7Rm2pXqW3c', 'Zt9bLw4HqYE']);
  assert.deepEqual(Object.keys(result).sort(), ['channelId', 'entries', 'uploadsPlaylistId']);
});

test('fetchChannelVideos resolves the channel first when only a handle is known', async () => {
  const { fetch, calls } = apiRecorder();
  const source = { id: 'yt-cbc-news', url: 'https://www.youtube.com/@CBCNews', handle: '@CBCNews', channelId: null };
  const result = await fetchChannelVideos(source, { apiKey: KEY, fetch, maxPages: 2 });

  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/youtube/v3/channels', '/youtube/v3/playlistItems', '/youtube/v3/playlistItems']);
  assert.equal(new URL(calls[0].url).searchParams.get('forHandle'), '@CBCNews');
  assert.equal(result.channelId, CHANNEL_ID, 'the channel id is returned so the caller can store it');
  assert.equal(result.uploadsPlaylistId, UPLOADS_ID);
  assert.equal(result.entries.length, 4);
});

// ---------------------------------------------------------------------------------------------
// Errors

test('API errors are mapped to YouTubeApiError with status and reason: quotaExceeded', async () => {
  const { fetch } = apiRecorder({ any: () => ({ status: 403, body: fixture('error-quota.json') }) });
  const error = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.status, 403);
  assert.equal(error.reason, 'quotaExceeded');
  assert.match(error.message, /allowance|quota/i);
  assert.ok(!error.message.includes('<a '), 'HTML from the API message is stripped');
  assert.ok(!error.message.includes(KEY));
});

test('API errors are mapped to YouTubeApiError with status and reason: keyInvalid', async () => {
  const { fetch } = apiRecorder({ any: () => ({ status: 400, body: fixture('error-key.json') }) });
  const error = await resolveChannel({ handle: '@CBCNews' }, { apiKey: KEY, fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.status, 400);
  assert.equal(error.reason, 'keyInvalid');
  assert.match(error.message, /key is not valid/i);
  assert.match(error.message, /YOUTUBE_API_KEY/);
  assert.ok(!error.message.includes(KEY));
});

test('API errors keep the raw reason and status when they are not known ones', async () => {
  const body = { error: { code: 404, message: 'The playlist identified with the request\'s <code>playlistId</code> parameter cannot be found.', errors: [{ message: 'x', domain: 'youtube.playlistItem', reason: 'playlistNotFound', location: 'playlistId', locationType: 'parameter' }] } };
  const { fetch } = apiRecorder({ any: () => ({ status: 404, body }) });
  const error = await fetchUploads('UUnope', { apiKey: KEY, fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.status, 404);
  assert.equal(error.reason, 'playlistNotFound');
  assert.match(error.message, /uploads playlist|cannot be found/i);
  assert.ok(!error.message.includes('<code>'));
});

test('a non-JSON API answer becomes a YouTubeApiError with the status', async () => {
  const { fetch } = apiRecorder({ any: () => ({ status: 502, body: '<html>Bad Gateway</html>' }) });
  const error = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.status, 502);
  assert.equal(error.reason, null);
  assert.match(error.message, /502/);
  const ok = apiRecorder({ any: () => ({ status: 200, body: 'not json' }) });
  const error2 = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch: ok.fetch }).then(() => null, (e) => e);
  assert.ok(error2 instanceof YouTubeApiError);
  assert.equal(error2.status, 200);
  assert.match(error2.message, /could not be read/i);
});

test('the API key never appears in error messages, even when the network error echoes the url', async () => {
  const failing = async (input) => {
    everyRequestedUrl.push(String(input));
    throw new TypeError('fetch failed: connect ECONNREFUSED ' + String(input));
  };
  const error = await resolveChannel({ handle: '@CBCNews' }, { apiKey: KEY, fetch: failing }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.status, null);
  assert.equal(error.reason, 'network');
  assert.ok(!error.message.includes(KEY), 'key redacted: ' + error.message);
  assert.match(error.message, /key=\[redacted\]/);
  assert.match(error.message, /could not reach YouTube/i);

  const echoing = apiRecorder({ any: (url) => ({ status: 500, body: 'Internal error while handling ' + url.toString() }) });
  const error2 = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch: echoing.fetch }).then(() => null, (e) => e);
  assert.ok(error2 instanceof YouTubeApiError);
  assert.ok(!error2.message.includes(KEY), 'key redacted: ' + error2.message);

  const keyInMessage = apiRecorder({ any: (url) => ({ status: 400, body: { error: { code: 400, message: 'Bad key ' + url.searchParams.get('key') + ' in request ' + url.toString(), errors: [{ reason: 'badRequest' }] } } }) });
  const error3 = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch: keyInMessage.fetch }).then(() => null, (e) => e);
  assert.ok(error3 instanceof YouTubeApiError);
  assert.ok(!error3.message.includes(KEY), 'key redacted: ' + error3.message);
});

test('an aborted request is reported as a timeout in plain language', async () => {
  const { fetch } = apiRecorder({ any: () => { throw abortError(); } });
  const error = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch, timeoutMs: 10000 }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.status, null);
  assert.equal(error.reason, 'timeout');
  assert.match(error.message, /did not answer within 10 seconds/i);
  assert.ok(!error.message.includes(KEY));

  const timeoutError = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const other = apiRecorder({ any: () => { throw timeoutError; } });
  const error2 = await resolveChannel({ handle: '@CBCNews' }, { apiKey: KEY, fetch: other.fetch }).then(() => null, (e) => e);
  assert.equal(error2.reason, 'timeout');
});

test('the client really aborts a hanging request after timeoutMs', async () => {
  const hanging = (input, init) => new Promise((_, reject) => {
    everyRequestedUrl.push(String(input));
    init.signal.addEventListener('abort', () => reject(abortError()));
  });
  const started = Date.now();
  const error = await fetchUploads(UPLOADS_ID, { apiKey: KEY, fetch: hanging, timeoutMs: 30 }).then(() => null, (e) => e);
  assert.ok(error instanceof YouTubeApiError);
  assert.equal(error.reason, 'timeout');
  assert.ok(Date.now() - started < 5000, 'returned promptly');

  const error2 = await fetchOEmbed('dQw4w9WgXcQ', { fetch: hanging, timeoutMs: 30 }).then(() => null, (e) => e);
  assert.ok(error2 instanceof OEmbedError);
  assert.match(error2.message, /did not answer/i);
});

test('YouTubeApiError and OEmbedError carry their fields and default to null', () => {
  const a = new YouTubeApiError('boom');
  assert.equal(a.status, null);
  assert.equal(a.reason, null);
  assert.equal(a.message, 'boom');
  const b = new YouTubeApiError('quota', { status: 403, reason: 'quotaExceeded' });
  assert.equal(b.status, 403);
  assert.equal(b.reason, 'quotaExceeded');
  const c = new OEmbedError('gone', { status: 404 });
  assert.equal(c.status, 404);
  assert.equal(new OEmbedError('x').status, null);
});

// ---------------------------------------------------------------------------------------------
// The one rule that must never break

after(() => {
  assert.ok(everyRequestedUrl.length > 10, 'the fake fetches were exercised');
  for (const url of everyRequestedUrl) {
    assert.ok(!url.includes('/search'), 'the client must never call the search endpoint: ' + url);
    assert.ok(!url.includes('/feeds/videos.xml'), 'the client must never fetch the keyless channel feed: ' + url);
  }
});

test('no request in this suite went to youtube/v3/search', () => {
  for (const url of everyRequestedUrl) assert.ok(!url.includes('/search'), url);
});
