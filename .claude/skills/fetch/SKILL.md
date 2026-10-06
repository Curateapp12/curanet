---
name: fetch
description: Run the Curanet fetcher (download every active source, add new items, prune old ones), rebuild both outputs and republish the private preview. Use for "/fetch", "refresh the feed", "update the preview".
---

Run a fetch, rebuild, republish.
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — optional: one or more source ids to fetch only those.

## Steps

1. Run the fetcher (all sources, or `--source <id>` for each id given). In a Claude session the
   request must go through the session's proxy, so prefix the command:
   ```
   NODE_USE_ENV_PROXY=1 npm run fetch -- [--source <id>]
   ```
   The output lists each source with `ok`, `unchanged`, `BLOCKED`, `error` or `skipped`, the
   number of new items, and the path of the run log in `data/runs/`.
2. Read the summary. Sources that are `BLOCKED` were refused by their publisher and are now
   skipped; `error` sources (timeouts, network) stay active and are tried again next time. Mention
   both kinds to the owner; never try to get around a refusal.
3. Follow the "After any data change" steps in `_shared.md`: validate, `npm run build`, republish
   the preview, commit `data/`, push.
4. Report: how many items were added in total, which sources failed and why, and the preview link.
