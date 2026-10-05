---
name: edit-source
description: Change a source's category, subcategory, country, language or display name. Items follow their source, so this re-tags everything from that source. Use for "/edit-source <id> --category 'News / World'" or "move The Tyee to Local".
---

Edit a source in `data/sources.json`. Items never carry their own tags, so changing the source
changes every item from it at the next build.
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — a source id, URL or name, followed by what to change.

## Steps

1. Find the source with `node scripts/source.js list` (ask if several match).
2. Apply the change(s) in one command; only pass the flags that change:
   ```
   node scripts/source.js edit <id> [--category "<Category / Subcategory>"] [--country <CC>] [--language <ll>] [--name "<Display name>"]
   ```
   The script validates the category path and codes and prints the before/after values.
3. Follow the "After any data change" steps in `_shared.md`. Report the before and after values in
   one sentence.
