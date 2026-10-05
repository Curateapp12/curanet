# Curanet — plan

## Version 0.1 (this pull request)

1. **Project files** — rules in `CLAUDE.md`, design reference in `docs/LAYOUT.md`, permission
   settings that block destructive commands, these docs. ✅
2. **Data and fetcher** — category tree, ~30 verified feeds, seed videos, fetcher with tests for
   fetching, duplicate removal, tagging, pruning and the data checks; YouTube Data API path tested
   against saved sample responses.
3. **Build and site** — one code base, two outputs (private preview artifact; hosted static site),
   built to `docs/LAYOUT.md`, mobile first, WCAG AA, English with French strings ready.
4. **Skills and admin guide** — `/add-source`, `/add-video`, `/remove-source`, `/pause-source`,
   `/edit-source`, `/hide-item`, `/add-category`, `/rename-category`, `/fetch`; `docs/ADMIN_GUIDE.md`.
5. **Workflows** — tests on every pull request; hourly fetch-and-commit, switched off until enabled.

## Next

- Add the YouTube API key as a repository secret and turn on channel fetching.
- Turn on the hourly fetch workflow.
- Connect curanet.io to a host for `dist/`.
- Later versions: visitor accounts, newsletters, analytics, AI tagging, an admin screen, a database.
