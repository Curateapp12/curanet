---
name: rename-category
description: Rename a category or subcategory (English and/or French display name). Ids never change, so sources keep working. Use for "/rename-category Knowledge --name Learning" or "call the Entertainment category Arts & Entertainment".
---

Rename in `data/categories.json`. Only the display names change; the id stays, so every source and
item keeps its place.
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — the current name or id (`Category` or `Category / Subcategory`), then the
new English name and/or new French name.

## Steps

1. Run:
   ```
   node scripts/category.js rename "<Category [/ Subcategory]>" [--name "<New English name>"] [--fr "<Nouveau nom français>"]
   ```
2. Follow the "After any data change" steps in `_shared.md`. Report old → new.

If the owner wants a different id as well (rarely needed), that is a manual edit of
`data/categories.json` plus the matching `category`/`subcategory` values in `data/sources.json`;
run `npm run validate` after.
