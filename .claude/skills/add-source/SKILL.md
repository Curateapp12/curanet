---
name: add-source
description: Add an RSS/Atom feed or a YouTube channel to Curanet. Use when the owner gives a feed or channel address with a category, subcategory, country and language, e.g. "/add-source https://example.com/feed.xml Local / Politics CA en" or "add this feed to Local politics in Canada, English".
---

Add a source to `data/sources.json`, fetch it once, rebuild the preview and republish it.
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — a URL, then a category path (`Category / Subcategory`), then a country
code and a language code. Any of the last three may be missing; the owner may also have written
them as plain words anywhere in the message.

## Steps

1. Work out the four values (URL, category path, country, language). If the category path is
   missing or does not resolve, show the owner the category tree (`node scripts/category.js list`)
   and ask which to use. If the country or language is missing, infer it from the publisher when
   obvious (a `.ca` news site in English → `CA en`), otherwise ask. Ask once, with all missing
   values in one question.
2. Check the address and show the owner what it is:
   ```
   node scripts/add-source.js "<url>" --category "<Category / Subcategory>" --country <CC> --language <ll> --check-only
   ```
   This prints the feed's name, how many items it has and the latest five titles, or a plain
   reason why it cannot be used (not a feed, refused by the publisher, timed out, duplicate of an
   existing source). If it is a YouTube channel address, it prints the channel handle and says it
   will be saved as "waiting for key".
3. If the check failed because the address is a web page rather than a feed, look at the printed
   "feeds found on that page" list and retry with the right one. If the publisher refused (HTTP 401,
   403 or 451), stop and tell the owner; do not try other addresses or headers for that publisher.
4. If the check passed, save and fetch:
   ```
   node scripts/add-source.js "<url>" --category "<Category / Subcategory>" --country <CC> --language <ll> [--name "<Display name>"]
   ```
   Pass `--name` when the feed's own title is not how a reader would say the publisher's name
   (feed title "Manchettes - Le Devoir" → `--name "Le Devoir"`). The script saves the source, runs
   the fetcher for that source only and prints how many items were added. A YouTube channel is
   saved with status `waiting_for_key` and nothing is fetched.
5. Follow the "After any data change" steps in `_shared.md` (validate, build, republish, commit,
   push, report). In the report, name the source, its place in the tree and the number of items.
