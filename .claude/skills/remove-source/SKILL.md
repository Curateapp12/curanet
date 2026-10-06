---
name: remove-source
description: Remove a source and all of its collected items from Curanet. Use when the owner says to delete, drop or remove a feed, publisher or channel, e.g. "/remove-source the-tyee".
---

Remove a source from `data/sources.json` and delete its items file.
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — a source id, its feed URL, or the publisher's name.

## Steps

1. Find the source: `node scripts/source.js list` prints every source with its id, name, place in
   the tree, status and item count. If the owner's words match more than one source (several
   "Globe and Mail" feeds), list the matches and ask which one. If none matches, say so.
2. Removal deletes the collected items too and cannot be undone except through Git history. It is
   safe to proceed without asking when the owner named the source clearly.
   ```
   node scripts/source.js remove <id>
   ```
3. Follow the "After any data change" steps in `_shared.md`. Report what was removed and how many
   items went with it. If the owner only wants to stop fetching for a while, suggest
   `/pause-source` instead.
