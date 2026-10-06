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
- A visitor's preferred language and location can be remembered in their browser.

## Left for later

Visitor sign-in and accounts, payments, publishing tools, newsletters, analytics, AI tagging, an
admin screen, a database, and automatic YouTube channel fetching (built, but waiting for an API key).
