# Curanet

**Curate the internet.** Curanet collects articles from RSS and Atom feeds and videos from YouTube
and shows them in one feed that visitors narrow by category, subcategory, language, country and
type, and search.

Everything lives in this repository as files. There is no database, no hosting account and no
API key in this version. A fetch script collects items into `data/`, and a build script turns the
data into a static site.

- `docs/PRODUCT.md` — what Curanet is and what this version leaves out
- `docs/ARCHITECTURE.md` — how the pieces fit together
- `docs/DATA.md` — the data files and their formats
- `docs/LAYOUT.md` — the design reference the site follows
- `docs/ADMIN_GUIDE.md` — how the owner manages sources from a Claude session
- `docs/PLAN.md` — what is done and what comes next
- `CLAUDE.md` — the rules every Claude session follows in this repository

## Commands (for sessions and CI; the owner never runs these)

| Command | What it does |
|---|---|
| `npm install` | installs the few free dependencies |
| `npm run fetch` | downloads every active source and adds new items to `data/items/` |
| `npm run build` | builds the hosted site into `dist/` and the private preview into `preview/` |
| `npm test` | runs the tests, including the data-file check |
| `npm run check` | lint, type check, tests and build — the definition of "working" |
