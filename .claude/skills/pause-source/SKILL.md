---
name: pause-source
description: Pause or resume a source. A paused source keeps its items on the site but is not fetched. Also un-blocks a source the publisher had refused. Use for "/pause-source <id>", "resume <id>", "pause the Globe politics feed".
---

Change a source's status between `active` and `paused` (or back to `active` from `blocked`).
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — a source id, URL or name, optionally preceded by "resume".

## Steps

1. Find the source with `node scripts/source.js list` (ask if several match).
2. Pause: `node scripts/source.js pause <id>`. Resume: `node scripts/source.js resume <id>`.
   Resuming a `blocked` source sets it back to `active`; the next fetch will try it again once. If
   the publisher refuses again it becomes `blocked` again — tell the owner that is expected and
   that the rules do not allow working around a refusal.
3. A YouTube channel in `waiting_for_key` cannot be resumed to active without the API key; say so.
4. Follow the "After any data change" steps in `_shared.md`. Report the new status.
