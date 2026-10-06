---
name: add-video
description: Add one YouTube video to Curanet by link, with a category, subcategory, country and language. Use when the owner pastes a youtube.com or youtu.be link and wants it in the feed, e.g. "/add-video https://youtu.be/abc123 News / Politics CA en".
---

Add a single video from its link. Title, channel name and preview image come from YouTube's oEmbed
endpoint; the publication date is the date it is added (oEmbed gives none).
Read `.claude/skills/_shared.md` first and follow its before/after steps.

Arguments: `$ARGUMENTS` — a YouTube video link, then a category path, a country code and a language
code (any may be missing or written as plain words).

## Steps

1. Work out the values as in `/add-source`. Ask once for anything missing that cannot be inferred.
2. Run:
   ```
   node scripts/add-video.js "<video link>" --category "<Category / Subcategory>" --country <CC> --language <ll>
   ```
   The script confirms the video through oEmbed (a private, removed or mistyped video is refused
   with a plain reason), finds or creates the channel's source (`yt-<channel>`, status
   `waiting_for_key`) and adds the video to that source's items unless it is already there.
3. Items take their category, country and language from their source. If the channel already
   exists with a different place in the tree, the script says so and keeps the channel's values;
   tell the owner and offer `/edit-source` if they want the channel moved.
4. Follow the "After any data change" steps in `_shared.md`. Report the video title and channel.

Never guess or invent a video link, never read YouTube channel pages or `/feeds/videos.xml`, and
only ever request the oEmbed endpoint (the script does this).
