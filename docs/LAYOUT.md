# Curanet layout — design reference (version 3, copied from the live site at curanet.io)

This page describes the layout the site must follow. It replaces version 2 (the "New Design" Figma)
with the design of the owner's live site at https://curanet.io, measured element by element from
that site's page code on 2026-10-06 (computed styles and boxes, light and dark, 1280 / 1440 / 768 /
390 / 360 px wide). Both outputs (private preview and hosted site) are built from the same code and
follow this page. Where Curanet has a feature the live site does not (Saved, Following, Live, the
language filter, Settings) or the live site has one Curanet leaves out (accounts, votes, a detail
page), the mapping is written down here so nothing is improvised twice.

## Visual language

- **Light colours**: bar blue `#305dd2`; page `#f9fafb`; card and bars `#ffffff`; grey row
  `#f9fafb`; titles, tabs and menu text `#101828`; publisher names and grey-row links `#364153`;
  muted text (time, buttons, "You've reached the end") `#6a7282`; menu icons and placeholders
  `#737373`; card border `#e5e7eb`; item dividers and thumbnail borders `#f3f4f6`; bar bottom
  borders, menu borders and button borders `#e5e5e5`; hover of white controls on the blue bar
  `#a7c4ff` (with ink `#171717`); menu-item hover `#f5f5f5`; grey-row hover underline `#d1d5dc`;
  tab hover underline `#e5e7eb`; focus ring `#a1a1a1` at 50 % (3 px); link blue `#305dd2`; share
  hover green `#00c950` on `#f0fdf4`; avatar circle `#e5e7eb` with ink `#4a5565`.
- **Dark colours** (same structure): bar `#214fcc`; page `#030712`; card and bars `#101828`;
  card border, dividers and bar borders `#1e2939`; titles `#f9fafb`; publisher names `#f3f4f6`;
  inactive tabs `#e5e7eb`; active tab or link text `#6393ff` with underline `#4677ed`; grey-row
  inactive links `#d1d5dc`; muted `#99a1af`; menu icons `#a1a1a1`; menus `#171717` with borders
  white at 10 %; hover of controls on the blue bar `#214fcc`; outline buttons white at 4.5 % with
  borders white at 15 %; toast `#0a0a0a`; focus ring `#737373` at 50 %; avatar circle `#364153`
  with ink `#d1d5dc`; thumbnail border `#364153`.
- **Typeface**: the system stack
  `ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`,
  antialiased, 16 px / 24 px base. No web font is loaded: the live site ships Geist but never
  applies it, so what visitors see is their system font (SF Pro on Apple devices, Segoe UI on
  Windows). Matching what they see is the goal.
- **Radii**: 10 px (card, thumbnails), 8 px (buttons, menus, inputs, toasts), 6 px (menu items),
  4 px (menu-panel cells), round (avatar, article/video toggle).
- **Shadows**: xs `0 1px 2px rgba(0,0,0,.05)`; sm `0 1px 3px rgba(0,0,0,.1), 0 1px 2px -1px rgba(0,0,0,.1)`;
  md `0 4px 6px -1px rgba(0,0,0,.1), 0 2px 4px -2px rgba(0,0,0,.1)`;
  lg `0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)`.
- **Motion**: colours 150 ms; the header slide and the thumbnail zoom 300 ms; menus fade and zoom
  in over 150 ms. None of it with reduced motion.
- **Cursor**: as on the live site, the arrow on the blue bar's buttons, the ≡ button and the
  outline buttons (Save, Share, heart); the hand on the avatar, inactive tabs, grey-row links,
  menu rows and Menu-panel cells.
- **Widths**: the three bars and the Menu panel share one content container of at most 896 px,
  centred, inside 16 px side padding. The main area (feed, Manage Following, Sources, About) is the
  live feed container: at most 896 px *including* 16 px padding on every side from 640 px up, so
  the card is 864 px wide at x = 208 at 1280 (736 px at 768); below 640 px it has only top and
  bottom padding and the card is full width. Two breakpoints: 640 px (wordmark, paddings,
  thumbnail size) and 768 px (title size, grid columns). The page never scrolls sideways.
- A dark theme with the same structure exists; the default is **light**; the visitor switches in
  the avatar menu ("Dark Mode" / "Light Mode") or in Settings (Light, Dark, Follow system).
- **Where a live colour misses WCAG AA** the nearest colour of the same family is used instead
  (every pair is checked by `npm test`): Save hover ink `#123bb7` (live `#305dd2`, 3.3:1 on its
  hover blue) and in dark `#6393ff`; Share hover ink `#008236` (live `#00c950`, 2.1:1); the dark
  action-button ink `#99a1af` (live `#6a7282`); the focus indicator is a solid `#737373` border
  (dark `#a1a1a1`) inside the 3 px ring, because the ring alone is 1.5:1; checkbox borders
  `#6a7282` (dark `#99a1af`, live `#d1d5dc`); the dark hover of controls on the blue bar
  `#3f64b9` (the live `#214fcc` is the bar itself, so the hover would not show); the dark search
  field `#101828` (the live translucent white leaves the placeholder at 2.5:1); the dark title hover
  (articles and videos) `#6393ff` (live `#4677ed`, 4.3:1 on the `#101828` card); the article/video
  toggle's white glyph turns `#171717` on the light hover, like the other bar controls' ink (the
  live white glyph is 1.75:1 on `#a7c4ff`); and the Language hint takes the hovered row's ink.
  Links and other plain controls show keyboard focus as a 3 px solid outline in the same colour
  (white on the blue bars); the tabs and grey-row links draw it as a 3 px frame around their label
  (clear of the letters and the underline); in forced-colours mode every control keeps an outline.

## Header

One sticky block (`top: 0`, z-index 50, white, shadow sm) made of three bars; 143 px tall on Home
(57 + 49 + 37), 145 px on a category (the third bar is 39 there). All three share the container.

### Bar 1 — the blue bar (56 px + 1 px bottom border of the same blue)

- Background `#305dd2` (dark `#214fcc`). Row: items centred, gap 16 px, side padding 8 px from
  640 px up, none below.
- Left: the **logo** (40 × 40: the live site's `logo.svg`, a `#3B82F6` rounded square, radius 12 on
  an 80-unit box, with a white "C" stroke of width 7 and three white dots of radius 3.5 at x 39,
  y 18 / 30 / 42, all inside a 10-unit margin), then the **wordmark** "Curanet" 8 px to its right:
  24 px / 32 px, weight 900, letter-spacing −0.025 em, white; hidden below 640 px. Logo and
  wordmark are one link to Home.
- Right, in order, with the row's 16 px gaps: the **search** button, the **location** picker, the
  **article/video toggle** and the **avatar**. They keep their sizes on phones.
- **Search button**: 36 × 36, radius 8, transparent, a white 16 px magnifier (lucide `search`).
  Hover `#a7c4ff` with ink `#171717` (dark hover `#214fcc`, ink white). Click opens the search
  field in the bar: it takes the empty middle of the row (up to 672 px wide, 40 px tall, radius 8,
  white, border 1 px `#e5e5e5`, shadow xs, a 20 px grey magnifier 12 px inside at the left, text
  padded 40 px left and 16 px right, 14 px text from 768 px up and 16 px below, placeholder
  "Search news…" in `#737373`); it is focused at once; focus shows a `#737373` border (dark
  `#a1a1a1`) and the 3 px ring. Enter runs the search on the current view (from Sources, About or
  Manage Following, which have no feed, it opens the whole feed with the results, as the live site
  always shows its results page); the magnifier button closes the field again, as does Escape; the
  words stay applied until cleared, and words typed but never applied are dropped when the field
  closes. On phones the location picker and the toggle hide while the field is open so it gets
  the room (the live site leaves it 58 px wide, which is unusable).
- **Location picker**: a 32 px tall ghost button (radius 8, padding 0 10 px, gap 4 px) with a
  16 px white globe (lucide `globe`) and a 12 px / 16 px medium white label. The label is
  **"World"** when no location filter is set, otherwise the country's name ("Canada"). A long name
  ("United Kingdom") that does not fit on a narrow phone is cut with an ellipsis (the live site
  shows short codes such as "NZ" instead); the button's tooltip and accessible name keep the full
  name. It opens a menu 192 px wide (padding 4, radius 8, border 1 px `#e5e5e5`, shadow md, white; dark `#171717`)
  aligned to the button's right edge 4 px below: one 32 px item per choice (padding 6 px 8 px,
  radius 6, 14 px / 20 px), "World" first then every country present in the data by its name;
  the chosen one shows a 16 px check (lucide `check`) in `#737373` at the right; hover `#f5f5f5`.
  Choosing filters the feed at once (our `loc` state) and never reloads the page.
- **Article/video toggle**: a 32 px round transparent button (hover `#a7c4ff`, dark `#214fcc`)
  holding a 20 px white line glyph that shows the current setting and cycles it on each click:
  **both** (two overlapping pages, the back one with a picture, the front one with text lines) →
  **videos only** (a rounded screen with a play triangle) → **articles only** (one page with text
  lines) → both. Its title and accessible name read "Showing: Articles and videos" / "Showing:
  Videos only" / "Showing: Articles only". This is the design's single-button toggle the owner
  chose; it is hidden in Live, which is videos by nature.
- **Avatar**: a 40 px round button whose face is a `#e5e7eb` circle with a 16 px `#4a5565` user
  glyph (lucide `user`); hover sets the button's background to `#a7c4ff` (dark `#3f64b9`) under the
  opaque face, so nothing visible changes, as on the live site. It opens the **avatar menu**
  (below).
- **While a menu is open** (location, avatar, an item's Share) its trigger shows its resting look
  even under the pointer, as the live site's modal menus do. The menus are disclosures: the
  trigger says whether it is expanded and which element it controls; Tab moves through the rows.

### Bar 2 — the category tabs (48 px + 1 px `#e5e5e5`; dark `#101828` with `#1e2939`)

- White. A scrollable track (hidden scrollbar, drag-to-scroll with the mouse, swipe on touch) with
  16 px side padding from 640 px up, none below. Tabs are buttons: 14 px / 20 px, **weight 700**,
  padding 12 px 16 px (12 px 8 px below 640; Home has no left padding from 640 up), no gap, a
  4 px bottom border flush with the bar's bottom line. Inactive: text `#101828` (dark `#e5e7eb`),
  transparent border; hover border `#e5e7eb` (dark `#4a5565`). Active: text and border
  `#305dd2` (dark text `#6393ff`, border `#4677ed`). Clipped tabs are simply cut, no fade.
  Unlike the live site, the active tab is scrolled into view when it changes.
- Contents: **Home**, then every category from `data/categories.json` in file order. (The live
  site filters its tabs by country; Curanet always shows all of them.) Saved, Following and Live
  are not tabs: see the grey row and the avatar menu. Home stays the active tab on every view but a
  category (Saved, Following, Manage Following, Live, Sources, About), as the live site keeps Home
  active on its search, Terms and Privacy pages. The active tab is marked `aria-current`.
- At the right, outside the track, the **≡ button**: 36 × 36, radius 8, 8 px from the container's
  edge, a 16 px three-line glyph (`M4 5h16 M4 12h16 M4 19h16`) in `#101828` (dark `#e5e7eb`);
  hover `#f3f4f6` (dark `#1e2939`). It opens the **Menu panel**; while the panel is open the glyph
  becomes an X.

### Bar 3 — the grey row (36 px + 1 px; 38 + 1 when it lists subcategories)

- `#f9fafb` (dark `#101828`), bottom border `#e5e5e5` (dark `#1e2939`). The links are centred
  with 24 px gaps and 8 px top padding; a row too wide for the container overflows symmetrically
  on desktop and scrolls from the left edge on phones (hidden scrollbar). Links: 14 px / 20 px,
  weight 500, bottom padding 6 px (8 px in the subcategory variant), a 2 px bottom border.
  Inactive `#364153` with a transparent border, hover text `#305dd2` with border `#d1d5dc`;
  active text and border `#305dd2` (dark: inactive `#d1d5dc`, hover `#6393ff` / `#4a5565`, active
  `#6393ff` / `#4677ed`).
- Contents by view:
  - **Home**: **All · Saved · Following**. "All" is the whole feed. Saved and Following are the
    visitor's own lists, placed here because that is where the live site puts a signed-in
    visitor's collections. While Following is open a fourth link, **Manage** (with a 12 px gear),
    opens Manage Following. The live site's "Latest" and "Popular" are left out: Latest is the
    same list as All, and Popular needs vote counts that do not exist here.
  - **A category**: **All** plus its subcategories, in file order; changing the category resets
    the subcategory to All (the 38 + 1 variant).
  - **Live**: **All · News · Sports · Music**.
  - **Saved, Following and Manage Following** show the Home links with theirs active (Manage stays
    in the row, active, while Manage Following is open); **Sources and About** show them with none
    active, like the live site's sort links on its other pages. So the header is 143 px everywhere
    but a category.
- On phones the owner's option remains: the row sits under the tabs (default) or is docked as a
  sticky bar at the bottom of the screen, chosen in Settings; the choice only affects phones.

### Scroll behaviour

Scrolling down past 100 px slides the whole header up by 56 px over 300 ms, so the blue bar goes
away and the tabs stay pinned at the top with the grey row under them; any scroll up, or reaching
the top, brings the blue bar back. The header stays put while the search field, the Menu panel,
the location menu or the avatar menu is open, and while keyboard focus is on a blue-bar control
(a mouse click there does not stop the slide); it never moves with reduced motion (it stays fully
visible).

### Phones (below 640 px)

No wordmark; the four controls keep their desktop sizes and gaps (everything still fits at
360 px: the empty middle of the row gives up its room first, then a long location label is cut
with an ellipsis); tabs have 8 px side padding and scroll; the grey row is centred or docked at
the bottom. The feed card is full width with no side padding and keeps its border and radius.
An item's bottom row keeps the time at the left and the actions at the right; where both do not
fit on one line (the French labels at 360 px) the actions move under the time, still at the right.
The avatar menu is 320 px wide aligned to the right edge; the location menu 192 px. On a short
screen (a phone held sideways) both menus scroll inside themselves so every row can be reached.

## The avatar menu

A menu 320 px wide (padding 24, border **2 px** `#e5e5e5`, radius 8, shadow lg, white; dark
`#171717` with the border white at 10 %) aligned to the avatar's right edge 4 px below. The live
site's version holds sign-in buttons; Curanet's holds, top to bottom:

1. A centred block: a heading 18 px / 28 px bold `#101828` ("Your Curanet"), under it 14 px
   `#4a5565` ("Saved and Following stay in this browser").
2. Three rows styled like the live menu's items (32 px, padding 6 px 8 px, radius 6, 14 px, a 16 px
   `#737373` icon then 16 px to the label, hover `#f5f5f5`): **Saved** (bookmark), **Following** (a
   check-list glyph) and **Live** (a play glyph).
3. A 1 px separator with 12 px margins.
4. **Language** with a 12 px `#737373` hint at the right showing the current choice ("All" /
   "English" / "Français") and a chevron; it expands in place to one row per choice (All
   languages, then the languages present in the data, each named in itself and sorted that way:
   Deutsch, English, Español, Français; a check on the current one; the labels line up with the
   other rows' labels). This is the content-language filter (our `lang` state).
5. A 1 px separator with 4 px margins (as under the live menu's Language row), then **Dark Mode**
   (moon) or **Light Mode** (sun) — one row that toggles the theme and stores it.
6. **Settings** (gear) — opens the Settings dialog.
7. A footer (16 px margin and 16 px padding above it, a top border, 12 px `#6a7282`, centred):
   "Sign-in is coming later · **Sources** · **About**", the two links in `#305dd2` (underline on
   hover).

Opening it moves focus to its first row (the location menu focuses the current choice). Escape, a
click outside, Tab leaving it, or choosing an item closes it. Escape, a Language choice and the
theme row return focus to the avatar; a click outside or Tab leaves focus where the visitor sent
it; a row that opens a view moves focus to that view (the feed, or the page's heading); Settings
moves it into the dialog.

## The Menu panel (the ≡ button)

A full-screen panel fixed under the blue bar (top 56 px, to the bottom, z-index 50, white; dark
`#030712`) that scrolls on its own. Its own 48 px blue bar (same blue, 1 px `#123bb7` bottom
line; dark `#214fcc`) shows "Menu" 18 px / 28 px bold white at the left (4 px in from the
container edge plus 16 px padding) and a 36 px X button at the right. Body padding 24 px 16 px
(24 px 8 px on phones), content indented 16 px:

- "ALL CATEGORIES": 14 px / 20 px bold uppercase `#4a5565` (dark `#99a1af`), 16 px below it a grid
  of cells, 3 columns from 768 px up and 2 below, 12 px gaps: each cell `#f3f4f6` (dark `#1e2939`),
  padding 8 px, radius 4, label 16 px / 24 px bold `#000` (dark `#f3f4f6`); hover `#305dd2` with a
  white label (dark `#214fcc`). One cell per category (no Home). Choosing one closes the panel and
  opens the category.
- Below a 1 px rule and 24 px: "MORE", same heading style, then the same cells for **Saved**,
  **Following**, **Live**, **Sources** and **About**.
- Escape and the X close it; the page behind does not scroll while it is open; focus goes to the
  panel heading on open and back to the ≡ button on close. The blue bar stays usable above it: a
  click on any of its controls closes the panel first, so a menu it opens is never hidden under
  the panel and a feed change is never made behind it.

## Feed

- The page is `#f9fafb` (dark `#030712`). The container has 16 px padding on all sides from
  640 px up and only top and bottom padding below, so the card starts 16 px under the header.
- **The card**: white (dark `#101828`), border 1 px `#e5e7eb` (dark `#1e2939`), radius 10, shadow
  sm, 864 px wide at 1280 (full width on phones). Unlike the live card (overflow hidden, because
  its share menu is drawn outside the card) it does not clip, so an item's share menu, drawn
  inside the item, can hang below the card; nothing else reaches the corners (see the video item
  for the one player that does). Items are stacked in it with
  no gaps, each with a 1 px `#f3f4f6` (dark `#1e2939`) bottom line; 20 at a time, more appear as
  the visitor scrolls (a "Show more" button only where the browser cannot watch scrolling).
- After the last item, when everything is shown: "You've reached the end." 14 px `#6a7282`,
  centred in a 100 px block (the live 32 px sentinel plus 24 px padding: 40 px above and below),
  inside the card.
- Nothing to show: one centred block inside the card, 16 px / 24 px `#6a7282` (dark `#99a1af`),
  48 px padding (the live block, 122 px tall with its border). Curanet adds a button under it; the
  text and the button depend on why the list is empty:
  - Saved with nothing saved (saved items that have left the data do not count): "Nothing saved
    yet.", no button, so the block is exactly the live one.
  - Following with no section followed: "You are not following any section yet." with only the
    blue "Manage following" button.
  - Any other case (Home, a category, Live, or Saved and Following with a list, when the filters
    or the search hide everything): "No content in this category yet.", or "Nothing matches your
    search." when there are search words, with the "Clear filters" button.
  Every text has its French version.

## Article item

- Padding 16 px top and bottom, 16 px sides. The whole text block (publisher and title, and the
  thumbnail) is **one link** to the original, opened in a new tab.
- **Publisher line**: the source name, 14 px / 20 px weight 600, `#364153` (dark `#f3f4f6`), 8 px
  above the title. No icon or monogram.
- **Title**: 20 px / 27.5 px from 768 px up, 18 px / 24.75 px below, weight 400, `#101828` (dark
  `#f9fafb`), at most three lines (clamped with an ellipsis); hovering the link turns it `#305dd2`
  (dark `#6393ff`; see the AA list).
- **Thumbnail** (when there is one): at the right, top-aligned, 24 px from the text (16 px on
  phones), **200 × 112** from 640 px up and **112 × 80** below, radius 10, border 1 px `#f3f4f6`
  (dark `#364153`), shadow sm, `#f3f4f6` behind the picture, picture cover-fitted and scaled to
  105 % over 300 ms while the link is hovered. A picture that fails to load removes the box.
- **Bottom row**, 16 px under the text: the **time** at the left, 12 px / 16 px weight 500
  `#6a7282` (dark `#99a1af`), relative for the first seven days ("about 1 hour ago" style wording
  is not copied; Curanet keeps "1 hour ago", "2 days ago") and a short date after that; the
  **actions** at the right (below). No excerpt is shown.

## Video item

- No side padding: the **player area** spans the card's full inner width at 16:9 (black behind
  it, shadow sm). On the hosted site it shows the video's preview picture with a red rounded play
  button (68 × 48, white triangle) in the middle, like YouTube's own; one click replaces it with
  the privacy-enhanced YouTube player. In the preview file it is a link that opens the video on
  YouTube in a new tab. No tint, no custom overlay.
- Under it, inside 24 px side padding (16 px on phones) and 16 px bottom padding: the publisher
  line 12 px below the player, the title (20 px / 25 px from 768 px up, 18 px / 22.5 px below, no
  clamp, hover `#305dd2` (dark `#6393ff`), a link to the video on YouTube in a new tab) 8 px below,
  then the bottom row 16 px below. A one-line video item is 638.88 px tall at 1280.
- The player has square corners and keeps the item's 16 px top padding, as in the live home feed
  (Home, Live, "videos only"). On a category page the live site drops that padding when the first
  item is a video, so the player sits flush with the card's top edge and takes the card's inner
  corners (9 px: the 10 px radius less the 1 px border).

## Action row: Save, Share, heart

Three outline buttons 24 px tall, radius 8, padding 0 10 px, 6 px between icon and label, 12 px /
16 px weight 500, text and 16 px icon `#6a7282`, white with a 1 px `#e5e5e5` border and shadow xs
(dark: white at 4.5 % with a border white at 15 %), 8 px apart, right-aligned:

- **Save** (lucide `bookmark`, label "Save"): hover text `#305dd2` on `#a7c4ff` (dark `#4677ed`
  on `#1d4ece` at 10 %). Saving fills the bookmark, the label reads "Saved" and a toast says
  "Saved · Find it under Saved". Saving again removes it ("Removed from Saved"). The list lives in
  the browser; no account is needed.
- **Share** (lucide `share-2`, label "Share"): hover text `#00c950` on `#f0fdf4` (dark the same
  green on green at 10 %). Opens the **share menu** (192 px, padding 4, radius 8, border 1 px
  `#e5e5e5`, shadow md, aligned to the button's right edge 4 px below): rows of 32 px (padding
  6 px 8 px, radius 6, 14 px, a 16 px `#737373` icon then 16 px to the label, hover `#f5f5f5`):
  **Copy Link** (lucide `link`), **Facebook**, **Twitter**, **LinkedIn**, **WhatsApp** (filled
  glyph), **Telegram** (lucide `send`). The five services are plain links to their share addresses
  (facebook.com/sharer, twitter.com/intent/tweet, linkedin.com/shareArticle, wa.me, t.me/share)
  carrying the item's **original** link and title, opened in a new tab; nothing is loaded from
  them. Copy Link writes the original link to the clipboard and shows the toast "Link Copied! ·
  The link has been copied to your clipboard."; if copying fails the toast reads "Could not copy
  the link". When there is not enough room below the button (near the bottom of the screen, or
  above the docked grey row) and more above it, the menu opens above the button, as the live
  site's menus flip to stay on screen; an opened menu is scrolled into view so its focused row is
  never hidden.
- **Heart** (lucide `heart`, icon only, 38 px wide): shown as the owner asked, but disabled until
  accounts exist: no hover change, `aria-disabled`, title "Coming later", and a click shows the
  toast "Likes are coming later".
- Keyboard focus: the buttons' border turns `#737373` (dark `#a1a1a1`) inside the 3 px ring
  (`#a1a1a1` at 50 %, dark `#737373` at 50 %); the item link (title and thumbnail) shows a 3 px
  solid `#737373` outline (dark `#a1a1a1`) instead of the live browser outline, which is 1.5:1.
- Each button is described by its item's title for screen readers, so a list of buttons says which
  item a Save belongs to; Save is a plain button whose label carries the state ("Save" /
  "Saved").

**Toasts**: a box 388 px wide at most, 16 px from the bottom-right corner on desktop (full width
16 px inside the top edge on phones), padding 24 px (32 px at the right), white (dark `#0a0a0a`),
border 1 px `#e5e5e5` (dark white at 10 %), radius 8, shadow lg: a 14 px semibold title and a
14 px line at 90 % opacity; it slides in (up from the bottom on desktop, down from the top on
phones) and goes away after 5 s, paused while it is hovered, while focus is inside it and while
the page is in the background, as on the live site; a small X at its top-right closes it, and so
does Escape, without moving focus. One toast shows at a time: a new one replaces it, as the live
site's toast store keeps one. As on the live site the X shows while the toast is hovered or the X
has keyboard focus; on touch screens it is always shown. Announced politely to screen readers (the
toast region is the only announcer of Save and Copy Link). On desktop, keyboard focus is kept
clear of it: a toast that lands on the focused control scrolls the page, and the next Tab stop
stops above it.

## Saved, Following and Live

- **Saved**: the items the visitor saved, newest-saved first, in the same card. Reached from the
  grey row on Home, the avatar menu and the Menu panel. Unsaving an item while Saved is open
  removes it from the list at once; focus moves to the next item's link (or the previous one if
  it was the last, or the feed when the list becomes empty).
- **Following**: the feed limited to the followed sections.
- The language, location, article/video and search filters also apply to Saved and Following.
- **Manage Following** opens from the grey row's Manage link (shown while Following is open), from
  the empty Following view's "Manage following" button, and from the Following row of the avatar
  menu or the Following cell of the Menu panel when nothing is followed yet (once something is
  followed, those two open the Following list); on the hosted site `?view=following-manage` opens
  it directly. The grey row's Following link always opens the Following list. Cancel returns to
  Following without saving; Save Changes stores the choice. It is a card in the same style with a title row ("Manage Following",
  Cancel as a text link and "Save Changes" as a blue button of the bar blue), a search field, an
  "All | Following (n)" pair of pills, one row per category with a count badge that opens a grid
  of checkboxes for its subcategories, and Select all / Clear per category. Checkboxes are 16 px,
  radius 4, border `#d1d5dc`, checked `#305dd2` with a white check.
- **Live**: the newest videos with the sections All / News / Sports / Music in the grey row; the
  toggle is hidden. Until a YouTube API key exists it shows the
  latest videos rather than live streams, and About says so.
- All three work without an account and keep their lists in the browser; when sign-in arrives the
  same lists move to the account.

## Settings (from the avatar menu)

A dialog in the menu style (white, radius 8, border 1 px, shadow lg, 24 px padding, 384 px wide
at most, centred):

- Theme (Light — the default, Dark, Follow system) and Sections bar on phones (Top — the default,
  Bottom; this group shows only below 640 px) apply and are stored in the browser as soon as a
  choice is made.
- Preferred language and location sit in a Preferences group with a one-line explanation and a
  blue Save button (bar blue); a status note under it says "Preferences saved" or that the browser
  does not allow saving. Saving also applies them to the open page at once; afterwards they apply
  whenever the visitor arrives with no filter in the address (a bare `?view=` is not a filter).
- Escape, the X or a click on the backdrop (outside the dialog's box, not on its padding) closes
  the dialog and focus returns to the avatar.

Everything is kept in the browser and the page still works when storage is unavailable (a hint
says so). Sources and About are reached from the avatar menu and the Menu panel.

## Sources and About

They follow the live site's Terms page: one card in the feed container (16 px under the header,
full width on phones), padding 24 px (16 px on phones), a 24 px / 32 px bold heading 24 px above
the text, paragraphs 16 px / 24 px `#364153` (dark `#d1d5dc`) across the card's full width. The
grey row shows the Home links with none active, as on the live Terms page. A "Back to the feed"
link sits under the card. Sources lists every source in a table (stacked blocks on phones); About
carries the tagline as a 20 px bold line, the plain-language description, the removal address and
the time of the last update. Manage Following uses the same container.

## State in the address

- Hosted site: category, subcategory (or the Live section), language, location, article/video
  setting, search words and the view (`?view=saved`, `following`, `following-manage`, `live`,
  `sources`, `about`) are in the page address so a view can be bookmarked or shared. Opening
  another view, category or subcategory adds a history entry, so the browser's Back returns to it
  as on the live site; changing the language, location, article/video setting or search words
  replaces the current entry.
- Preview: the state stays inside the page; the view is named by a plain `#anchor` (`#saved`,
  `#following`, `#following-manage`, `#live`, `#sources`, `#about`, and `#feed` once another view
  has been opened), always replaced, never added to the history.

## Left out of the live design, on purpose

- **Accounts** (Google and Facebook sign-in, collections, votes, the thumbs on the detail page) and
  **analytics**: they need third-party services; the sign-in spot is reserved in the avatar menu.
- **The item page** (`/content/…` with the full description): Curanet links to the original
  instead and shows no article text.
- **"Latest" and "Popular"**: see the grey row. **Country-dependent tabs** (Local only for Canada):
  Curanet's categories are the same everywhere; the location picker filters the items.
- **The install-the-app prompt** (with its PWA manifest and PNG icon set) and the social links in
  the Menu panel's footer. The hosted page keeps the live tab icon (the logo, as `icon.svg`) and
  theme colour (`#3B82F6`); its tab title is "Curanet — Curate the internet" rather than the live
  "Curanet - Your News Aggregator".

## Quality bar

Mobile first; WCAG AA (contrast in both themes, keyboard operation, visible focus, labels, reduced
motion; the publisher's own words carry their language when it differs from the interface's);
interface in English with every string ready in French; no horizontal page scrolling at
any width from 360 px up; everything works in the preview file (a body fragment with plain
`#anchors`) and on the hosted site alike.
