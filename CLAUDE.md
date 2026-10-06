# Curanet — rules for every session

Curanet ("Curate the internet", future domain curanet.io) collects articles from RSS/Atom feeds and
videos from YouTube and shows them in one filterable feed. Everything lives in this repository as
files; there are no external services. Read `docs/ARCHITECTURE.md` for how the pieces fit and
`docs/DATA.md` for the file formats. The visual design reference is `docs/LAYOUT.md` — follow it
exactly when touching the site.

## How to work with the owner

- The owner is not a programmer and has never used a terminal or Git. They work only in a web
  browser and cannot install or save anything on their computer. **Never ask them to run a command.**
- **No third-party services.** No hosting provider, database service, API key or account of any
  kind beyond this GitHub repository. If something seems to need one, find a way without it or
  leave it out and say so.
- Make routine decisions yourself and keep going. When something is ambiguous, pick the simplest
  option that keeps the layout and the rules in this file. Stop only for something that cannot be
  undone or that only the owner can do, and collect those into one numbered checklist that names
  the page, button and field for each step.
- Explain things in plain language, a few sentences at a time.
- Work on a branch, never directly on `main`, and commit and push after every working step. If
  GitHub rejects a push because it contains workflow files, leave those files out, carry on, and
  give the owner their contents with the steps to add them on GitHub's website.
- The owner manages sources by talking to Claude. Use the skills in `.claude/skills/` (add-source,
  add-video, remove-source, pause-source, edit-source, hide-item, add-category, rename-category,
  fetch). `docs/ADMIN_GUIDE.md` explains them in plain language.
- The preview is a single HTML file published as a **private** artifact for the owner only. It
  contains copies of publishers' images, so it is never committed (`preview/` is git-ignored).

## YouTube

- YouTube's robots.txt disallows automated fetching of its keyless channel feed
  (`/feeds/videos.xml`). **Do not use it**, and do not read channel pages to collect video lists.
- Channels are fetched only through the official YouTube Data API v3, by listing each channel's
  uploads playlist (`channels.list` → `contentDetails.relatedPlaylists.uploads` →
  `playlistItems.list`), **never** through its `search` call. Until the owner provides a key (as the
  `YOUTUBE_API_KEY` secret / environment variable, never pasted into chat), every channel keeps the
  status `waiting_for_key`.
- Until then, videos are added one at a time by link (`/add-video`). Title, channel name and
  preview image come from YouTube's oEmbed endpoint
  (`https://www.youtube.com/oembed?url=…&format=json`). oEmbed gives no publication date, so the
  date the video was added is used.
- Never invent a video link. A video that oEmbed cannot confirm is skipped.

## Content rules

- Store only: the title, an excerpt of at most 300 characters taken from the feed's own summary
  (used for search), the source name, the published date, the link to the original, and the
  thumbnail's address. **Never store or show full article text.**
- Thumbnail images are copied only into the private preview file, never into the repository or the
  hosted site (which loads them from the publisher's address).
- Strip all HTML from titles and excerpts before storing them, so nothing from a feed can run on
  the site. Decode entities, drop tags, collapse whitespace. Stored fields have hard limits
  (title and excerpt 300 characters, link / guid / thumbnail 2048, http(s) only); every text
  routine must stay linear in the input size so one hostile feed cannot stall a run.
- If a publisher refuses the fetcher (HTTP 401, 403 or 451, an explicit denial, or an empty
  202/204 answer in place of the feed, which is what bot checks return), record it, mark the source
  `blocked` and move on. **Do not work around a refusal** (no header spoofing, proxies,
  scraping or alternative endpoints).

## Data rules

- An item is a duplicate when it has the same link, or the same identifier (guid) from the same
  source, as a stored or hidden item. Duplicates are skipped. Matching the same story across
  different publishers is not needed in this version.
- Each item takes its category, subcategory, country (ISO 3166-1 alpha-2, upper case) and language
  (ISO 639-1, lower case) from its source. Items never carry their own tags.
- The fetcher identifies itself with a user agent that names Curanet
  (`Curanet/<version> (+https://curanet.io)`), sends `If-None-Match` / `If-Modified-Since` from the
  previous run so unchanged feeds are not downloaded again, gives each source at most 10 seconds,
  and fetches a few sources at a time (default 4), never all at once.
- Items older than 90 days are removed on every run.
- One failing source never stops a run. Every run is logged in `data/runs/`: when it ran, how many
  items it added, and which sources failed and why.
- `npm test` includes a data check that validates `data/*.json`. Run it after any data edit.

## Engineering conventions

- Node.js (>= 20), ES modules, plain JavaScript with JSDoc types checked by `tsc` (`npm run typecheck`).
  No framework in the browser code. Only free npm packages with no accounts or keys.
- A step is finished only when `npm run check` (lint, type check, tests, build) passes.
- Tests use Node's built-in test runner (`node --test`). Network-dependent behaviour is tested
  against fixtures in `test/fixtures/`.
- Commit after every working step with a clear message.
