# Curanet — data files

All data lives under `data/` as JSON. Every file has a `version` field. `npm run validate` (also
part of `npm test`) checks every file against the rules below and names the exact problem, so a
typo is caught before it breaks the site.

## `data/categories.json` — the category tree, in display order

```json
{
  "version": 1,
  "categories": [
    {
      "id": "local",
      "name": { "en": "Local", "fr": "Local" },
      "subcategories": [
        { "id": "news", "name": { "en": "News", "fr": "Actualités" } }
      ]
    }
  ]
}
```

- `id`: lower-case letters, digits and dashes; unique among categories (subcategory ids are unique
  within their category). Sources refer to these ids, so renaming a category changes only `name`.
- `name.en` is required; `name.fr` is optional and used when the interface is in French.

## `data/sources.json` — feeds and channels

```json
{
  "version": 1,
  "sources": [
    {
      "id": "globe-and-mail-canada",
      "type": "feed",
      "name": "Globe and Mail",
      "url": "https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/canada/",
      "siteUrl": "https://www.theglobeandmail.com",
      "category": "local",
      "subcategory": "news",
      "country": "CA",
      "language": "en",
      "status": "active",
      "addedAt": "2026-10-05T23:00:00.000Z",
      "fetch": {
        "etag": "W/\"abc\"",
        "lastModified": "Mon, 05 Oct 2026 22:51:40 GMT",
        "lastAttempt": "2026-10-05T23:10:00.000Z",
        "lastSuccess": "2026-10-05T23:10:00.000Z",
        "lastResult": "ok",
        "lastError": null,
        "failures": 0
      }
    },
    {
      "id": "yt-cbc-news",
      "type": "youtube_channel",
      "name": "CBC News",
      "url": "https://www.youtube.com/@CBCNews",
      "handle": "@CBCNews",
      "channelId": null,
      "category": "local",
      "subcategory": "news",
      "country": "CA",
      "language": "en",
      "status": "waiting_for_key",
      "addedAt": "2026-10-05T23:00:00.000Z",
      "fetch": null
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Slug, unique, also the item file name (`data/items/<id>.json`). YouTube channels start with `yt-`. |
| `type` | `feed` (RSS/Atom) or `youtube_channel`. |
| `name` | Short display name shown on each item's publisher line, above the title (under the player for videos) ("BBC", "Le Devoir"). |
| `url` | Feed address, or the channel's page (for display and for resolving the channel). |
| `siteUrl` | Publisher's homepage (feeds). |
| `handle`, `channelId` | YouTube only. `channelId` is filled in by the first successful API fetch. |
| `category`, `subcategory` | Ids from `categories.json`. Every item of the source inherits them. |
| `country` | ISO 3166-1 alpha-2, upper case (`CA`, `US`, `FR`). |
| `language` | ISO 639-1, lower case (`en`, `fr`, `de`). |
| `status` | `active` — fetched every run. `paused` — kept, not fetched, items still shown. `blocked` — the publisher refused (HTTP 401/403/451, or an empty 202/204 answer, which is how bot checks look); not fetched until the owner sets it back to `active`. `waiting_for_key` — YouTube channel waiting for the API key. |
| `addedAt` | When the source was added. |
| `fetch` | Written by the fetcher. `lastResult` is `ok`, `unchanged`, `blocked`, `error` or `skipped`. `null` until the first run. |

## `data/items/<source-id>.json` — collected items, one file per source

```json
{
  "version": 1,
  "sourceId": "globe-and-mail-canada",
  "items": [
    {
      "id": "a1b2c3d4e5f60718",
      "guid": "https://www.theglobeandmail.com/canada/article-xyz/",
      "link": "https://www.theglobeandmail.com/canada/article-xyz/",
      "title": "Headline, HTML stripped",
      "excerpt": "At most 300 characters from the feed's own summary, HTML stripped.",
      "published": "2026-10-05T21:30:00.000Z",
      "thumbnail": "https://www.theglobeandmail.com/resizer/...jpg",
      "type": "article",
      "addedAt": "2026-10-05T23:10:00.000Z"
    },
    {
      "id": "9f8e7d6c5b4a3921",
      "guid": "yt:dQw4w9WgXcQ",
      "link": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Video title",
      "excerpt": "",
      "published": "2026-10-05T23:00:00.000Z",
      "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      "type": "video",
      "videoId": "dQw4w9WgXcQ",
      "addedAt": "2026-10-05T23:00:00.000Z"
    }
  ]
}
```

- `id` is the first 16 hex characters of the SHA-1 of the normalised link.
- Limits, enforced by the fetcher and checked by `npm run validate`: title at most 300 characters,
  excerpt at most 300 characters, link / guid / thumbnail at most 2048 characters, links and
  thumbnails must start with `http://` or `https://`. Entries outside the limits are skipped.
- Items are stored newest first. Items never carry category, country or language: those come from
  the source at build time, so editing a source re-tags all of its items.
- Only these fields are stored. **Never full article text.**
- `published` is the feed's date; for videos added by link it is the date they were added. A feed
  date more than 10 minutes after the fetch is replaced by the fetch time (some publishers label
  world time with their local offset, which would put the story hours in the future), and the build
  does the same for anything stored before that rule.

## `data/hidden.json` — items the owner removed

```json
{
  "version": 1,
  "hidden": [
    { "link": "https://example.com/story", "guid": "…", "sourceId": "example", "hiddenAt": "2026-10-05T23:20:00.000Z" }
  ]
}
```

A hidden item is removed from its item file and never added again (matched by link, or by guid
within the same source).

## `data/runs/<YYYY-MM-DDTHH-MM-SSZ>.json` — one file per fetch run

```json
{
  "version": 1,
  "startedAt": "2026-10-05T23:10:00.000Z",
  "finishedAt": "2026-10-05T23:10:41.000Z",
  "totals": { "sources": 32, "fetched": 28, "unchanged": 3, "added": 140, "pruned": 0, "blocked": 1, "errors": 2, "skipped": 4 },
  "sources": [
    { "id": "globe-and-mail-canada", "result": "ok", "added": 12, "pruned": 0, "ms": 812, "error": null },
    { "id": "cbc-top-stories", "result": "error", "added": 0, "pruned": 0, "ms": 10003, "error": "timeout after 10000 ms" }
  ]
}
```

Run logs older than 90 days are deleted by the fetcher.

## Editing by hand on GitHub

The owner can open any of these files on GitHub's website, press the pencil icon, change a value
and commit. `npm test` in the pull request check validates the result. Common edits: change a
source's `category`/`subcategory`/`country`/`language`, set `status` to `paused` or back to
`active`, or add a category to `categories.json`.
