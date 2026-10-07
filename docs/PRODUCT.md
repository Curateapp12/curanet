# Curanet — product

**Name:** Curanet. **Tagline:** "Curate the internet". **Domain (to connect later):** curanet.io.

Curanet collects articles from RSS and Atom feeds and videos from YouTube and shows them in one
feed. Every item has a category and a subcategory. Visitors narrow the feed by category,
subcategory, language, location (country) and type (articles, videos or both), and can search it.

Canada is the best-covered country, in English and French, with local and independent outlets
alongside the national ones. A few other countries and languages are included so the filters have
something to do.

## What this version does

- Shows headlines and thumbnails with links to the original publishers. No article text is stored
  or shown; excerpts (at most 300 characters from the feed's own summary) are used only for search.
- Videos open on YouTube (preview) or play in YouTube's privacy-enhanced embedded player (hosted site).
- The owner manages sources by talking to Claude in a session (see `docs/ADMIN_GUIDE.md`).
- The look copies the owner's live site at curanet.io (`docs/LAYOUT.md`): a blue bar with the
  logo, search, the location picker, the article/video button and the avatar menu; a white bar
  with Home and the category tabs and a ≡ Menu panel; a grey row with the sections of the open
  page; one feed card. The system font, the live blue palette, light by default, with Dark Mode in
  the avatar menu and "Follow system" in Settings.
- Visitors can **Save** items (Home › Saved, also in the avatar menu and the ≡ panel), **Follow**
  sections (Home › Following, with Manage Following; also in the avatar menu and the ≡ panel) and
  **Share** an item (copy the link, or a service's own share page with the original link). Saved
  and followed lists live in the visitor's browser; there is no account yet. The **Like** heart is
  shown but disabled until accounts exist; **Comment** comes with accounts too. **Live** shows the
  latest videos until a YouTube API key makes real live streams possible.
- A visitor's preferred language, location, theme and (on phones) the position of the sections
  bar are remembered in their browser.

## Left for later

Visitor sign-in and accounts, payments, publishing tools, newsletters, analytics, AI tagging, an
admin screen, a database, and automatic YouTube channel fetching (built, but waiting for an API key).
