# Curanet — admin guide

This is for the owner. There is no admin screen yet: you manage Curanet by talking to Claude in a
Claude Code session, and Claude does the technical work. You never need to run a command.

## The short version

Open a session in this repository and say what you want in plain words, or type one of the
commands below. Claude checks the request, changes the data files, rebuilds the site, republishes
your private preview and commits the change on a branch. It then tells you what it did and gives you
the preview link.

| Command | What it does | Example |
|---|---|---|
| `/add-source` | Adds a feed (or a YouTube channel) with its category, subcategory, country and language. Claude checks the address works, shows you the publisher's name and latest titles, refuses duplicates, fetches it once and rebuilds. | `/add-source https://thetyee.ca/rss2.xml Local / News CA en` |
| `/add-video` | Adds one YouTube video by link. | `/add-video https://youtu.be/dQw4w9WgXcQ Entertainment / Music GB en` |
| `/remove-source` | Deletes a source and all of its items. | `/remove-source the-tyee` |
| `/pause-source` | Stops fetching a source but keeps its items. `resume` turns it back on (also un-blocks a refused source). | `/pause-source rabble`, `/pause-source resume rabble` |
| `/edit-source` | Moves a source to another category or subcategory, or changes its country, language or name. All of its items follow. | `/edit-source the-tyee --category "Knowledge / Opinion"` |
| `/hide-item` | Removes one item from the feed by its link (or its 16-character id), for good. | `/hide-item https://example.com/story` |
| `/add-category` | Adds a category, or a subcategory under an existing category, with an optional French name. | `/add-category Technology / Robotics --fr Robotique` |
| `/rename-category` | Renames a category or subcategory. Everything stays in place. | `/rename-category Knowledge --name Learning` |
| `/fetch` | Downloads every active source, adds new items, removes items older than 90 days, rebuilds and republishes the preview. | `/fetch` |

You can also just say "add the Halifax Examiner feed to Local news in Canada, English" and Claude
will use the right command.

Every change goes on a branch and into a pull request. On GitHub's website, open the pull request
and press **Merge pull request** to make it part of `main`. The checks on the pull request include
a test of the data files, so a mistake is caught before it reaches the site.

## Where things are

- `data/sources.json` — every feed and channel: its name, address, category, subcategory, country,
  language and status.
- `data/categories.json` — the category tree, in the order the ribbon shows it.
- `data/hidden.json` — items you removed.
- `data/items/` — the collected items, one file per source.
- `data/runs/` — one file per fetch run, saying when it ran, what it added and what failed.
- `docs/SOURCE_CANDIDATES.md` — more feeds that were checked and work, ready to add.

## Editing the files yourself on GitHub (optional)

If you prefer to change something directly:

1. On GitHub, open the file (for example `data/sources.json`).
2. Press the pencil icon (**Edit this file**) at the top right.
3. Change the value. Keep the quotes and commas exactly as they are. Common edits:
   - Move a source: change `"category": "news"` and `"subcategory": "politics"` to other ids from
     `data/categories.json` (ids are the lower-case words with dashes, like `top-stories`).
   - Pause a source: change `"status": "active"` to `"status": "paused"`. Resume: back to `"active"`.
   - Change the shown name: edit `"name"`.
4. Press **Commit changes…**, choose **Create a new branch for this commit and start a pull
   request**, and press **Propose changes**, then **Create pull request**.
5. Wait for the check named **Lint, types, tests, build** to turn green. If it turns red, open it:
   the data check prints the exact problem (for example `country "ca" must be two upper-case letters
   like CA`). Fix it in the same branch and the check runs again.
6. Press **Merge pull request**.

The next fetch picks up the change; the site is rebuilt from the data at the next build.

## What the statuses mean

| Status | Meaning | What to do |
|---|---|---|
| **Active** | Fetched every run. | Nothing. |
| **Paused** | Not fetched; items stay visible. | `/pause-source resume <id>` to turn it back on. |
| **Blocked** | The publisher's server refused Curanet (HTTP 401, 403 or 451), or answered with an empty page instead of the feed, which is how "are you a robot?" checks look (HTTP 202/204). The source is skipped until you say otherwise. | See below. |
| **Waiting for key** | A YouTube channel. Channels are fetched only through the official YouTube Data API, which needs a key you have not added yet. | Add the key (below), then run the **Hourly fetch** workflow once by hand (**Actions** → **Hourly fetch** → **Run workflow**) or wait for the next hourly run. A `/fetch` from a Claude session cannot see the key. |

Beside the status, the Sources section of the site shows the last successful fetch. A source that
shows `error` in a run log (timeout, network problem, broken feed) stays active and is tried again
next run; if it keeps failing for days, ask Claude to check it.

## When a source shows as blocked

A block means the publisher does not want automated readers. Curanet's rule is to respect that:
it records the refusal and does not try other addresses, headers or tricks.

Your options:

1. Leave it blocked. Its old items disappear after 90 days.
2. Check whether the publisher offers another official feed address (many list them on a page
   called "RSS" or "Feeds"). If so, `/remove-source` the blocked one and `/add-source` the new one.
3. If you believe the block was temporary (a server problem), `/pause-source resume <id>` sets it
   back to active and the next fetch tries once more. If it is refused again it becomes blocked again.
4. Some publishers block cloud networks but not GitHub's. CBC's feeds, for example, time out from
   the Claude session but may work from the hourly GitHub Actions fetch. Try adding them after the
   hourly fetch is switched on.

## Adding the YouTube API key (when you have one)

Never paste the key into a chat. Add it as a secret on GitHub's website:

1. Open the repository → **Settings** → **Secrets and variables** → **Actions**.
2. On the **Secrets** tab press **New repository secret**.
3. Name: `YOUTUBE_API_KEY`. Secret: paste the key. Press **Add secret**.

The hourly fetch (once switched on) reads the secret and fetches each channel's uploads through the
official API; channels move from "waiting for key" to "active" on their own. A Claude session
cannot see the secret, so channel fetching happens only in GitHub Actions. The key is never written
to any file.

## Switching on the hourly fetch

1. Open the repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.
2. Press **New repository variable**. Name: `CURANET_FETCH_ENABLED`. Value: `true`. Press **Add variable**.

From then on the **Hourly fetch** workflow (in the **Actions** tab) runs every hour, commits new
items to `main` and shows a green check or a red cross for each run. To pause it, delete the
variable. You can also run it once by hand: **Actions** → **Hourly fetch** → **Run workflow**.

## Where the preview lives

The preview is a private artifact in Claude. Its address is recorded in `docs/PREVIEW.md` so that
every session republishes to the same place. It holds copies of publishers' thumbnails, which is
why it is private and never committed.
