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
| `/add-source` | Adds a feed (or a YouTube channel) with its category, subcategory, country and language. Claude checks the address works, shows you the publisher's name and latest titles, refuses duplicates, fetches it once and rebuilds. | `/add-source https://globalnews.ca/politics/feed/ Local / Politics CA en` |
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

## What visitors see

The site copies the look of your live site at curanet.io.

- **The blue bar** at the top holds the Curanet logo (it goes back to Home), a search button, the
  location picker ("World" means every country), the article/video button (each click switches
  between both, videos only and articles only) and the round avatar button.
- **The white bar** under it shows **Home** and then every category from `data/categories.json`,
  in file order. The **≡** button at its right opens the Menu panel: every category as a tile,
  and under "More" the tiles Saved, Following, Live, Sources and About.
- **The grey row** under that changes with the page: **All · Saved · Following** on Home (plus
  **Manage** while Following is open), **All** and the subcategories on a category, and
  **All · News · Sports · Music** in Live.
- **The avatar menu** has Saved, Following and Live; Language (which languages the feed shows);
  Dark Mode / Light Mode; Settings; and links to Sources and About. In Settings a visitor chooses
  the theme (light by default), where the grey row sits on a phone (top or bottom), and a
  preferred language and location.
- **Under each item** are **Save**, **Share** (copy the link, or share it on Facebook, Twitter,
  LinkedIn, WhatsApp or Telegram, always with the original article's link) and a heart. The heart
  (Like) is shown but does nothing yet; liking and commenting come later, with accounts.
- Saved items and followed sections stay in each visitor's own browser; there is no account.
  **Live** shows the latest videos until the YouTube API key exists; real live streams come later.
- A category you add with `/add-category` appears as a tab in the white bar, as a tile in the
  Menu panel and in Manage Following on the next build.

## Where things are

- `data/sources.json` — every feed and channel: its name, address, category, subcategory, country,
  language and status.
- `data/categories.json` — the category tree, in the order the site shows it: the category tabs
  (after Home) and the tiles of the ≡ Menu panel.
- `data/hidden.json` — items you removed.
- `data/items/` — the collected items, one file per source.
- `data/runs/` — one file per fetch run, saying when it ran, what it added and what failed.
- `docs/SOURCE_CANDIDATES.md` — more feeds that were checked and work, ready to add.

## Editing the files yourself on GitHub (optional)

If you prefer to change something directly:

1. On GitHub, open the file (for example `data/sources.json`).
2. Press the pencil icon (**Edit this file**) at the top right.
3. Change the value. Keep the quotes and commas exactly as they are. Common edits:
   - Move a source: change `"category": "local"` and `"subcategory": "politics"` to other ids from
     `data/categories.json` (a category id and one of its own subcategory ids; ids are the
     lower-case words with dashes, like `personal-finance`).
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

## Putting the website online (GitHub Pages)

The website can be published by GitHub itself, with no other service, at
https://curateapp12.github.io/curanet/ . Once it is on, it updates on its own after every merge and
after every hourly fetch, and videos play inside the page. The website is public: anyone with the
address can open it. Your private preview stays private.

On GitHub's free plan, Pages only works for a **public** repository. Making the repository public
lets anyone read its files (code, data, documents) and its history, which includes the e-mail
address `curateapp12@gmail.com` on the merges you made. Secrets such as `YOUTUBE_API_KEY` stay
secret. The other way is a paid GitHub plan (GitHub Pro), which keeps the repository private;
the website is public either way.

1. Repository → **Settings** → **General** → scroll to **Danger Zone** → **Change visibility** →
   **Change to public**, then confirm. (Skip this if you have a paid plan.)
2. Repository → **Settings** → **Pages** → under **Build and deployment**, set **Source** to
   **GitHub Actions**. Nothing else on that page needs changing.
3. Repository → **Actions** → **Publish website** (left column) → **Run workflow** → green **Run
   workflow** button. After a minute or two the run shows a green check.
4. Open https://curateapp12.github.io/curanet/ .

To take the website offline again: **Settings** → **Pages** → **Unpublish site** (or set
**Source** back to **Deploy from a branch** with no branch).

### Using your own domain (sajidmahmud.com, registered at GoDaddy)

Do the four steps above first, so the site already works at its github.io address. The website then
moves to https://sajidmahmud.com and the github.io address forwards there. Nothing in the project
files changes: the domain is set in GitHub's settings and in GoDaddy.

Today the domain is parked: its DNS is run by a parking service (ParkLogic), so GoDaddy's record page
has no effect until GoDaddy runs the DNS again. Switching ends the parking page. The domain has no
working e-mail (its records say it sends none), so nothing else breaks.

1. **Let GoDaddy run the DNS.** Sign in to GoDaddy → **Domain Portfolio** → **sajidmahmud.com** →
   **DNS** → **Nameservers** → **Change Nameservers** → choose **GoDaddy Nameservers
   (recommended)** → **Save** → **Continue**. GoDaddy may ask for a code sent by text or e-mail.
   This usually takes effect within an hour, at most 48 hours.
2. **Prove to GitHub that the domain is yours** (protects it from being claimed by someone else).
   On GitHub, click your picture (top right) → **Settings** → **Pages** (left column, under "Code,
   planning, and automation") → **Add a domain** → type `sajidmahmud.com` → **Add domain**. GitHub
   shows a TXT record: a name starting with `_github-pages-challenge-` and a code. Keep that page
   open. In another tab, in GoDaddy: **sajidmahmud.com** → **DNS** → **Add New Record** → Type
   **TXT**, Name: the part before `.sajidmahmud.com` (for example
   `_github-pages-challenge-curateapp12`), Value: the code → **Save**. Back on GitHub press
   **Verify** (if it is too early, come back later: **⋯** next to the domain → **Continue
   verifying**). Leave this TXT record in place for good.
3. **Tell the website its address.** Repository → **Settings** → **Pages** → **Custom domain** →
   type `sajidmahmud.com` → **Save**.
4. **Point the domain at GitHub.** In GoDaddy: **sajidmahmud.com** → **DNS** (the records list):
   - Delete the existing **A** record whose Name is **@** (it may show "Parked"): the pencil or
     **⋯** next to it → **Delete**.
   - **Add New Record** → Type **A**, Name `@`, Value `185.199.108.153` → **Add another value** →
     `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (four values in all) → **Save**.
   - Optional, for newer networks: **Add New Record** → Type **AAAA**, Name `@`, values
     `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` →
     **Save**.
   - The **CNAME** record with Name **www**: **Edit** → Value `curateapp12.github.io` (no
     `/curanet`) → **Save**. If there is none, add it with **Add New Record** → Type **CNAME**.
   - If GoDaddy shows a **Forwarding** section for the domain, make sure it is off.
5. **Wait, then switch on the padlock.** Repository → **Settings** → **Pages**: once the line under
   Custom domain says the DNS check succeeded (minutes to a day), GitHub prepares a certificate
   (up to an hour, sometimes longer). Then tick **Enforce HTTPS**.
6. Open https://sajidmahmud.com .

To stop using the domain: **Settings** → **Pages** → **Custom domain** → **Remove**; the site goes
back to its github.io address. The records at GoDaddy can then be deleted.

## Where the preview lives

The preview is a private artifact in Claude. Its address is recorded in `docs/PREVIEW.md` so that
every session republishes to the same place. It holds copies of publishers' thumbnails, which is
why it is private and never committed.
