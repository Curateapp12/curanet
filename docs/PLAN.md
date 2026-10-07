# Curanet — plan

## Version 0.1 (the first pull request) ✅

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

## Version 0.2 — the "New Design" Figma (pull request #2, 2026-10-06) ✅

1. **Category tree** — the design's twelve categories (Local, World, Business, Technology, Science,
   Nature, Sports, Entertainment, Lifestyle, Knowledge, Health, Mobility), each with its
   subcategories and French names; every source re-filed. ✅
2. **Top bar** — My Hub, Live, Home and the categories as text tabs, with arrows on desktop and
   the avatar at the right; the sections bar under it, which phones can dock at the bottom. ✅
3. **Feed** — one white panel with dividers, the publisher line above the title, Save and Share on
   every item, the article/video bar, and the language, location and search filters. ✅
4. **My Hub** — Saved and Following, kept in the visitor's browser, with Manage Following. ✅
5. **Live** — the latest videos with All / News / Sports / Music. ✅
6. **Settings** — theme (light by default, dark, follow system), sections-bar position on phones,
   preferred language and location; links to Saved, Following, Sources and About. ✅

Left for later: Like and Comment (need accounts and a server), real live streams (need the YouTube
API key), Saved and Following on the account side when sign-in arrives (the Figma hover colours and
logo vector were superseded by version 0.3).

## Version 0.3 — the live curanet.io design (2026-10-06) ✅

1. **Blue top bar** — the live logo, search, the location picker ("World" = all), the cycling
   article/video button and the avatar menu (Saved, Following, Live, Language, Dark Mode,
   Settings, Sources, About). ✅
2. **Tabs and Menu panel** — Home plus the category tabs, and the ≡ Menu panel with every category
   and Saved, Following, Live, Sources, About. ✅
3. **Grey row** — All / Saved / Following on Home, All plus the subcategories on a category,
   All / News / Sports / Music in Live; it can still dock at the bottom on phones. ✅
4. **Feed card** — publisher name, title and thumbnail as one link to the original, Save, a Share
   menu with plain share links carrying the original link, and the heart shown but disabled. ✅
5. **System font** and `docs/LAYOUT.md` version 3, measured from the live site. ✅

Left for later: Like and Comment (accounts and a server), real live streams (the YouTube API key),
Saved and Following on the account side once sign-in exists.

## Next

- Add the YouTube API key as a repository secret and turn on channel fetching.
- Turn on the hourly fetch workflow.
- Connect curanet.io to a host for `dist/`.
- Later versions: visitor accounts, newsletters, analytics, AI tagging, an admin screen, a database.
