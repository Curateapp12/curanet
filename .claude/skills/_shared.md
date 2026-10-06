# Shared steps for the Curanet admin skills

These steps are referenced by every skill in this folder. They are written for Claude; the owner
never runs commands.

## Network commands in a Claude session

Inside a Claude Code session, Node reaches the internet only through the session's proxy, so every
command that downloads something (`add-source`, `add-video`, `fetch`, `build` with thumbnails) is
run with the prefix `NODE_USE_ENV_PROXY=1`, for example `NODE_USE_ENV_PROXY=1 node scripts/add-video.js …`.
The npm scripts (`npm run fetch`, `npm run build`) already include it. The prefix is harmless
elsewhere (GitHub Actions has no proxy).

## Before any change

1. Make sure you are on a branch other than `main` (`git branch --show-current`). If you are on
   `main`, create a branch named `claude/<short-description>` first (that prefix is pre-approved for pushing).
2. Run `npm install` if `node_modules/` is missing.

## After any data change

1. Run `npm run validate`. Fix the problem if it reports one (the message names the file and the field).
2. Rebuild: `npm run build`. The preview is written to `preview/curanet-preview.html`.
3. Republish the preview: read `docs/PREVIEW.md` for the artifact's address. Publish
   `preview/curanet-preview.html` with the Artifact tool to that same `url` (the tool requires a
   `read` of the artifact first in a new session). Keep the artifact private. Never commit the
   preview file.
4. Commit the changed files under `data/` (and `docs/` if changed) with a clear message and push the
   branch. Open a pull request if none exists for the branch, or tell the owner the pull request is
   updated.
5. Tell the owner in two or three plain sentences what changed, and give the preview link.

## Category paths

Categories and subcategories are written as `Category / Subcategory`, using either the display
name (English or French) or the id from `data/categories.json`. Examples: `News / Politics`,
`Actualités / Politique`, `news/politics`. If the owner gives a subcategory alone and it is unique
in the tree, use it; if it is ambiguous or missing, list the matching choices and ask.

## Countries and languages

Country is an ISO 3166-1 alpha-2 code in upper case (`CA`, `US`, `FR`). Language is an ISO 639-1
code in lower case (`en`, `fr`). Translate plain words the owner uses ("Canada", "French") into
the codes yourself.
