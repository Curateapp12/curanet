# Curanet layout — design reference (version 2, from the "New Design" Figma)

This page describes the layout the site must follow. It replaces the first version (a two-ribbon
Reddit-style feed) with the owner's Figma design, file "New Design", page "Prototype"
(https://www.figma.com/design/4CdkN0M6fwlqPa685aB7Az/New-Design). Both outputs (private preview and
hosted site) are built from the same code and follow this page. Measurements come from the Figma
frames; where the frames disagree, the choice is noted.

## Visual language

- Colours: blue `#0081FE` for everything selected or active; titles `#374151`; other text
  `#4B5563`; small publisher names on phones `#6B7280`; page `#F8FBFE`; bars `#FFFFFF` and
  `#F9FAFB`; borders `#F3F4F6`; dividers `#E5E7EB`; disabled `#D1D5DB`; logo circle `#FAEB05`.
  The article/video toggle bar is a deeper blue `#1D52DE`. A dark theme with the same structure
  exists; the default is **light** and the visitor can switch in Settings.
- One typeface, Roboto (400 / 500 / 600 / 700), from Google Fonts with a system fallback. Body
  16 px / 1.5. Tabs 14 px medium. Titles 20 px semibold on desktop, 15 px bold on phones.
- Radii: panel and thumbnails 8 px, chips 6 px, buttons and avatars round.

## Top bar (desktop, wider than 920 px)

- One sticky 60 px white bar with a 1 px `#F3F4F6` bottom line. Left: the round yellow logo
  (40 px) linking to Home; the name "Curanet" stays as its accessible text. Centre: the navigation
  strip. Right: a 40 px round avatar button that opens Settings.
- The strip holds, in order: **My Hub**, **Live**, **Home**, then every category from
  `data/categories.json` in file order. Tabs are text (14 px medium, `#374151`, 8 px side padding,
  16 px apart); the selected tab is blue with a 3 px blue underline flush with the bar's bottom.
  Hovering turns the text blue.
- The strip scrolls sideways with a hidden scrollbar and clips hard (no fade). Two 40 px round
  previous/next buttons at its right end scroll it by one screen; they grey out at the ends and
  disappear when everything fits.

## Second bar (desktop)

- 50 px, `#F9FAFB`, 1 px `#E5E7EB` bottom line with a soft shadow, sticky under the top bar. Its
  tabs are centred and styled like the top ones (`#4B5563`, selected blue + underline).
- Contents: a category → **All** plus its subcategories; **Home** → the bar is not shown;
  **My Hub** → **Saved** and **Following ⚙**; **Live** → **All, News, Sports, Music**.
- Changing the category resets the subcategory to All.

## Bars on phones and small tablets (920 px and narrower)

- Row 1: 48 px white, the same tabs with a 12 px inset, no logo and no arrows. A 32 px avatar
  button is pinned at the right over the row on a white block, with a 32 px magnifier button beside
  it that opens the search field under the bars.
- Row 2: 48 px `#F9FAFB` with the same tabs as the desktop second bar. The owner chose to offer
  both placements from the design: **top** (default, directly under row 1) or **bottom** (docked
  as a sticky bar at the bottom of the screen). The visitor picks in Settings; the choice is kept
  in the browser and only affects phones.

## Tools row

- Directly under the bars, inside the feed column. The **article/video control** is the design's
  "Single" component: one 48 px bar in `#1D52DE` with a white icon at the left, the current label
  in the middle ("Articles + videos" → "Articles" → "Videos" → back), and a round dark control at
  the right; each click moves to the next setting and the label always shows the current one. It
  starts on articles and videos together and is hidden in Live.
- Desktop: the toggle bar sits at the left (280 px); the language filter, the location filter
  and the search field sit at the right. Phones: the toggle bar is full width; the language and
  location filters live in Settings (they apply immediately); search is the magnifier in row 1.
- The language and location filters list only the languages and countries present in the data,
  with All first. Search runs on Enter or on the magnifier and covers titles, excerpts and source
  names within the current selection. Language and location start on All and combine with
  everything else.

## Feed

- Desktop: one centred white panel 840 px wide, 24 px below the bars (8 px radius, 1 px
  `#F3F4F6` border, faint shadow, 20 px vertical padding). Items are stacked inside it, newest
  first, separated by 1 px `#E5E7EB` lines. 30 items at a time; more appear as the visitor scrolls.
- Phones: no panel; items are full width with the same dividers on the `#F8FBFE` page.
- A plain message appears when nothing matches, with a "Clear filters" button.

## Article item

- Desktop: a **publisher line** at the top (24 px round monogram of the source name on a pastel
  colour, then the source name, 16 px semibold); below it the **title** (20 px semibold, at most
  two lines); the **thumbnail** at the right (200 × 112, 8 px radius), the title spanning the full
  width when there is none; a **bottom row** with the time at the left and the actions at the
  right: **Like** and **Comment** (shown but disabled, "Coming later"), **Share** (the browser's
  share sheet, otherwise "Copy link"), **Save** (fills the bookmark and adds the item to My Hub ›
  Saved). Chips: `#F9FAFB` with a `#F3F4F6` border, 6 px radius, 16 px icon, 14 px label.
- Phones: the publisher name only (13 px grey), the title (15 px bold, at most three lines), a
  110 × 86 thumbnail at the right (6 px radius), then the time at the left and four icon-only
  buttons at the right (heart and comment disabled, share, bookmark).
- Clicking the title or the thumbnail opens the original in a new tab. No excerpt is shown.
- Time: relative for the first seven days ("1 hour ago", "2 days ago"), then a short date
  ("Dec 12, 2025").

## Video item

- Desktop: a full-width 16:9 preview (840 × 473) with a 20 % dark tint and an 80 px white circle
  holding a blue play triangle; below it the title, then a row with the channel (monogram, name,
  time) at the left and the actions at the right. Phones: a full-width 16:9 preview with a 40 px
  white circle, then the channel name, the title, and the time with the four icons.
- In the preview the whole preview image links to YouTube in a new tab; on the hosted site it
  plays in YouTube's privacy-enhanced player on click.

## My Hub

- **Saved**: the items the visitor saved, newest-saved first, kept in the browser. Empty message
  when there are none.
- **Following**: the feed limited to the sections the visitor follows, kept in the browser; empty
  message with a "Manage following" button. The gear opens **Manage Following** in the column: a
  title with Cancel and Save Changes, a search field, an All | Following (n) toggle, one row per
  category with a count badge that opens a grid of checkboxes for its subcategories, and Select
  all / Clear per category.
- Both work without an account. When sign-in arrives, the same lists move to the account.

## Live

- The newest videos, with sections All / News / Sports / Music. Until a YouTube API key exists it
  shows the latest videos rather than live streams, and About says so.

## Settings (the avatar)

- Theme: Light (default), Dark, Follow system. Sections bar on phones: Top (default) or Bottom.
  Preferred language and location (applied when the visitor arrives with no filters), and on
  phones the live language and location filters. Links to Saved, Following, Sources and About. A
  reserved spot for sign-in later. Everything is kept in the browser and the page still works when
  browser storage is unavailable.

## State in the address

- Hosted site: category, subcategory, language, location, article/video setting, search words and
  the view (saved, following, live) are in the page address so a view can be bookmarked or shared.
  Preview: that state stays inside the page; Sources, About, Saved, Following and Live are reached
  with plain `#anchors`.

## Sources and About

- Reached from Settings. Sources lists each source with its status and last successful fetch.
  About explains that Curanet shows headlines and short excerpts with links to the original
  publishers, says that Live shows the latest videos for now, and gives a placeholder contact for
  removal requests.

## Quality bar

Mobile first; WCAG AA (contrast in both themes, keyboard operation, visible focus, labels, reduced
motion); interface in English with every string ready in French; no horizontal page scrolling at
any width from 360 px up.
