# Curanet — architecture

Curanet is three things: **data files**, a **fetcher** that fills them, and a **build** that turns
them into a site. Nothing runs on a server. The site's filters, search and sorting run in the
visitor's browser.

```
data/sources.json ──┐
data/categories.json┼──► scripts/fetch.js ──► data/items/<source>.json  +  data/runs/<time>.json
data/hidden.json ───┘            │
                                 ▼
                         scripts/build.js ──► dist/              (hosted site: static files)
                                          └─► preview/curanet-preview.html (private preview, one file)
```

## Pieces

| Path | Role |
|---|---|
| `data/` | All content and configuration, as JSON. See `docs/DATA.md`. |
| `src/lib/feed.js` | Parses RSS 2.0, RSS 1.0 (RDF) and Atom into plain item objects (title, link, guid, published, summary, thumbnail). |
| `src/lib/sanitize.js` | Strips HTML, decodes entities, trims excerpts to 300 characters, normalises links (drops tracking parameters and fragments). |
| `src/lib/store.js` | Reads and writes the data files; dedupes against stored and hidden items; prunes items older than 90 days. |
| `src/lib/fetcher.js` | Downloads one source with the Curanet user agent, conditional headers and a 10 s limit; classifies the outcome (ok / unchanged / blocked / error). |
| `src/lib/youtube.js` | The YouTube Data API v3 client (channels.list → uploads playlist → playlistItems.list) and the oEmbed lookup for single videos. |
| `src/lib/validate.js` | Validates every data file; used by the tests and by `npm run validate`. |
| `src/lib/categories.js` | Looks up categories and subcategories by id or display name (English or French). |
| `scripts/fetch.js` | The run: a small pool fetches a few sources at a time, applies the rules, writes the run log. Exit code 0 even when sources fail. |
| `scripts/build.js` | Assembles items with their source's tags, renders the hosted site and the preview from the same templates and browser code. |
| `scripts/*.js` (add-source, add-video, source, category, hide-item, validate-data, serve) | Command-line helpers that the skills in `.claude/skills/` call. |
| `src/site/` | The browser code: `index.html` template, `app.js`, `styles.css`, `strings.js` (English with French ready), `icon.svg` (the tab icon). |
| `test/` | Node test runner tests; fixtures in `test/fixtures/` stand in for the network. |
| `.github/workflows/` | CI on pull requests; an hourly fetch-and-commit workflow that is switched off until the owner turns it on. |

## The fetch run

1. Load `sources.json`, `categories.json`, `hidden.json`.
2. For each source with status `active` (feeds) — `paused`, `blocked` and `waiting_for_key` are
   skipped and logged as skipped:
   - GET the feed with `User-Agent: Curanet/<version> (+https://curanet.io)`, `If-None-Match` and
     `If-Modified-Since` from the last run, 10-second timeout, at most 5 MB.
   - 304 → `unchanged`. 401/403/451, or an empty 202/204/205 answer (how bot checks look) → status
     becomes `blocked`; the fetch block records the result, the reason and one more failure, and the
     source is not fetched again until the owner sets it back to `active`. Any other failure →
     `error`, the failure counter increments, the source stays active.
   - 200 → parse, sanitise, drop entries already older than 90 days, drop duplicates (same link as
     any stored item of any source or any hidden item, or same guid from the same source), add the
     rest with `addedAt = now`, prune stored items older than 90 days (an item the feed gave no date
     is kept as long as the feed still lists it), write the source's item file newest first.
3. YouTube channel sources run the same way through the Data API when `YOUTUBE_API_KEY` is set in the
   environment; otherwise they are skipped with `waiting_for_key`.
4. At most 4 sources download at the same time.
5. Write `data/runs/<timestamp>.json` and update the `fetch` block of each source in `sources.json`.
6. Exit 0. A fatal problem (unreadable data file) exits 1 before anything is written.

## The build

1. Load the data; attach each source's name, category, subcategory, country and language to its
   items; sort newest first (`published`, falling back to `addedAt`).
2. **Hosted** (`dist/`): `index.html` with the data inlined as JSON, `strings.js`, `app.js`,
   `styles.css` and the tab icon `icon.svg`; the head also carries a one-line script that applies
   the saved theme before the first paint. Images load from the publisher's address; videos play in `youtube-nocookie.com`;
   filters live in the query string.
3. **Preview** (`preview/curanet-preview.html`): the same template rendered as an artifact fragment
   (no doctype/html/head/body; `<title>`, then the same one-line theme script, then `<style>`),
   with CSS and JS inlined. Thumbnails
   are downloaded (10 s each, a few at a time, cached in `.cache/thumbs/`), resized to 240 px wide
   WebP and embedded as data URIs, newest items first, until the file would pass 12 MB; older
   items then show without a thumbnail. Videos open on YouTube in a new tab (the artifact viewer
   forbids players from other sites). State stays in the page.
4. **Publishing**: `.github/workflows/pages.yml` builds the hosted output on GitHub and publishes it
   with GitHub Pages after every push to `main`, after each hourly fetch and on demand. It skips
   itself while Pages is switched off for the repository (`docs/ADMIN_GUIDE.md` has the owner's
   steps); the preview is never published there.

The browser code is two scripts, `strings.js` (the English and French tables) and `app.js`, with a
small `CONFIG` object injected by the build (`mode`, `urlState`, `thumbnails`, `video`, `uiLang`).
Saved items, followed sections, the theme, the sections-bar position and the preferred language and
location are kept in the visitor's browser (localStorage keys `curanet.*`; in memory for the visit
when the browser refuses storage). Everything else is identical in both outputs.

## Why these choices

- **Files, not a database:** the repository is the only service the owner has. JSON files are easy
  to read, diff and fix on GitHub's website.
- **One file per source:** a fetch changes only the files of the sources that changed, so commits
  stay small and the owner can delete a source by deleting its file.
- **No framework:** the site is one plain JavaScript file (`app.js`, about 2,800 lines with
  comments) plus a strings table, which keeps the preview self-contained and the hosted site
  hostable anywhere.
