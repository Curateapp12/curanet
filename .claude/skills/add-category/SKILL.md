---
name: add-category
description: Add a category or a subcategory to the Curanet tree, with an optional French name. Use for "/add-category Podcasts", "/add-category Technology / Robotics", "add a subcategory Robotics under Technology, in French Robotique".
---

Add to `data/categories.json`. Categories are shown in file order; new ones go last.
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — a name, or `Parent / Name` for a subcategory, optionally with a French name.

## Steps

1. Run one of:
   ```
   node scripts/category.js add "<Name>" [--fr "<Nom français>"]
   node scripts/category.js add "<Name>" --parent "<Parent category>" [--fr "<Nom français>"]
   ```
   The id is made from the English name (`Tech News` → `tech-news`). Duplicates are refused.
2. To change the order, edit `data/categories.json` and move the block; validate afterwards.
3. Follow the "After any data change" steps in `_shared.md`. The new category appears as a tab in the
   white category bar (after Home and the other categories), as a tile in the ≡ Menu panel's All
   categories grid and as a row in Manage Following, even before it has sources; tell the owner
   they can now `/add-source` into it.
