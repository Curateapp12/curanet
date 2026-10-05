---
name: hide-item
description: Remove one item from the Curanet feed by its link and keep it out of later fetches. Use when the owner pastes an article or video link and says to hide, remove or take it down, e.g. "/hide-item https://example.com/story".
---

Hide a single item. The link is recorded in `data/hidden.json`, the item is removed from its
source's file, and the fetcher will skip it from now on (matched by link, or by the feed's own id
within the same source).
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — the item's link (as shown on the site or in the feed) or its 16-character
id, optionally followed by a short reason.

## Steps

1. Run:
   ```
   node scripts/hide-item.js "<link or id>" [--note "<reason>"]
   ```
   It prints the title and source of the removed item, or says that no stored item matched but the
   link is now on the hidden list anyway (so it will never be added).
2. Follow the "After any data change" steps in `_shared.md`. Report the title that was hidden.

To un-hide, remove the entry from `data/hidden.json` (edit the file, validate, commit).
