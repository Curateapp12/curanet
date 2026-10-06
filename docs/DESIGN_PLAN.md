# Design plan: applying the "New Design" Figma to Curanet

Figma file: https://www.figma.com/design/4CdkN0M6fwlqPa685aB7Az/New-Design (page "Prototype").
Written 2026-10-06 from the frames that could be read (see "What could not be read" at the end).

This document does three things: it maps every part of the design to the part of the code that
draws it today, it lists the buttons in the design that have no working feature behind them with a
proposed solution for each, and it lays out the implementation in phases. Decisions the owner must
make are collected at the end.

---

## 1. What the design shows

**Desktop (1512 px wide)**

- A 60 px white top bar: a 40 px round yellow logo at the left, a centred row of text tabs
  (My Hub, Live, Home, Local, World, Business, Technology, Science, Nature, Sports, Entertainment,
  Lifestyle, Knowledge, Health, Mobility…), two round ‹ › arrow buttons that scroll that row, and a
  40 px round avatar at the right. The selected tab is blue (#0081FE) with a 3 px blue underline.
- A 50 px light-grey second bar, centred, with "All" plus the subcategories of the selected
  category, same tab style. It is absent on **Home**; it shows **Saved / Following ⚙** on
  **My Hub**; it shows **All / News / Sports / Music** on **Live**.
- The feed: one centred 840 px white panel (8 px radius, faint border and shadow) on a very light
  blue page (#F8FBFE). Items are stacked inside it with 20 px padding and 1 px grey dividers.
- **Article item**: a 24 px round publisher icon and the publisher's name above the title
  (Roboto 600, 20 px); 16:9 thumbnail on the right (8 px radius); a bottom row with the time on the
  left and four actions on the right: "1.2k Like", "Comment", "Share", "Save" (the last three as
  light chips). A second variant ("B") puts "publisher • time" on one line above the title and the
  actions on the left under the title.
- **Video item**: full-width 16:9 image with a dark tint and a white 80 px circle holding a blue
  play triangle; title, "publisher • time" and the same actions below.
- **My Hub › Saved**: the feed limited to saved items (filled bookmark, older items show an absolute
  date). **My Hub › Following ⚙**: a "Manage Following" panel with a search box, an All / Following
  (12) toggle, one accordion row per category with a count badge, a grid of blue checkboxes for its
  subcategories, "Select all / Clear", and Cancel / Save Changes.
- **Live**: a video-first feed (full-width previews) with sections News, Sports, Music.

**Mobile (428 px wide)**

- V1: a 48 px category row (no logo, no arrows, avatar pinned at the right) with a 48 px
  subcategory row under it, both sticky. V2: the same, but the subcategory row is docked at the
  bottom of the screen (sticky, thumb-reachable).
- Cards are full-width with 1 px dividers: publisher name (small grey) above a bold 3-line title,
  110 × 86 thumbnail on the right (6 px radius), then the time on the left and four small icons
  (heart, comment, share, bookmark) on the right, no labels.
- Video: full-width 16:9 image, 40 px white play circle, text below.
- A "Mobile" frame shows a pasted picture of a preferences page with checkboxes (the mobile My Hub).
- Small components: hover states for tabs, a checkbox (unchecked / blue checked), and two
  three-variant "Single" / "Switch" rows in a deep blue that are not used by any screen.

**Visual tokens**: blue #0081FE; text #374151 (titles) and #4B5563 (everything else), #6B7280
(mobile publisher); page #F8FBFE; bars #FFFFFF and #F9FAFB; borders #F3F4F6 and #E6E9F0; dividers
#E5E7EB; disabled #D1D5DB; logo #FAEB05. One typeface, Roboto (400 / 500 / 600). Radii 8 (panel,
thumbnails), 6 (chips), full (circles). No dark theme is drawn.

---

## 2. Design → code map

| Design piece | Draws it today | What changes |
|---|---|---|
| 60 px top bar with logo, tab row, ‹ › arrows, avatar | `.brand-row` (text wordmark, not sticky) + `header.site-header > #ribbon-categories` (`src/site/index.html` 10–24; `styles.css` 159–264; `app.js` `renderCategoryRibbon`, `makeChip`, `revealChip`) | Merge brand row and ribbon into one sticky 60 px bar. Replace the wordmark with the round logo (keep the text as the accessible name). Restyle chips as text tabs with a 3 px underline. Drop the leading "All" chip: **Home** becomes "everything". Add the arrow buttons (scroll the row by one screen, grey when at either end; hidden on phones). Move the profile button into the bar as a 40 px round avatar button. |
| 50 px second bar, centred tabs, hidden on Home | `#ribbon-subcategories` + `.ribbon-sub .chip` + `.ribbon-hint` (`styles.css` 267–289; `app.js` `renderSubcategoryRibbon`) | Full-width light bar, centred tabs, blue underline; remove the "Pick a category" hint and hide the bar on Home. Keep the rule that changing the category resets the subcategory to All. Special contents on My Hub (Saved / Following) and Live (its sections). |
| Mobile V2 bottom-docked subcategory bar | nothing | `position: sticky; bottom: 0` variant of the same bar under a phone breakpoint, with bottom padding on the feed and safe-area inset (decision: V1 or V2). |
| Language, location, article/video, search controls | `#controls` row (`index.html` 26–53; `app.js` `fillSelect`, `cycleType`, `applySearch`) | **Not in the design at all.** Proposal: keep them in a slim row under the bars on desktop (right-aligned, as now) and on phones fold them into the avatar panel, with the search box kept visible. Needs the owner's answer (decision 3). |
| Feed as one white panel with dividers | `.feed` (gap 10) and separate `.card` boxes (`styles.css` 401–413) | One panel: border, 8 px radius, shadow; items separated by 1 px #E5E7EB lines; 20 px padding. Column width 680 → 840 px on desktop. Mobile: full-width, no panel, dividers only. |
| Article item anatomy (publisher line above the title, time bottom-left, actions bottom-right) | `template#tpl-article`, `renderArticle` (`app.js` 674–699), `.card-*` rules | New template order: publisher line (icon + name), title, thumbnail right, bottom row (time left, actions right). Title 20 px / 1.5 / 600, clamped to 2 lines on desktop and 3 on phones. Thumbnail 200 × 112 (8 px radius) on desktop, 110 × 86 (6 px) on phones. **This moves the publisher name from below the title to above it, which changes `docs/LAYOUT.md`.** |
| Video item anatomy | `template#tpl-video`, `renderVideo`, `.video-box`, `.play-badge` | Full-bleed 16:9 image with a 20 % dark tint, 80 px white circle + blue triangle (40 px circle on phones), title and "publisher • time" + actions below. The two play behaviours stay: link out in the preview, privacy-enhanced embed on the hosted site. |
| Publisher icon (24 px circle) | nothing (only the name) | A monogram circle (first letter on a pastel colour derived from the source id) drawn in CSS, which matches the design's placeholder look and needs no images. Optionally the publisher's real favicon on the hosted site with the monogram as fallback (decision 5). |
| Like / Comment / Share / Save | nothing | See section 3. |
| Time: relative, switching to an absolute date when old | `fillTime`, `formatRelative` (`app.js` 313–349) | Add the rule "older than 7 days → short absolute date", and fix "1 hours ago" to "1 hour ago". |
| Colour tokens | `:root` in `styles.css` 7–89 (teal palette, light + dark) | New light values from the design (blue #0081FE, grey text, #F8FBFE page, #F3F4F6 / #E5E7EB borders). Derive a dark palette with the same structure (decision 6). The coral accent goes; the play button becomes blue on white. |
| Typeface | Bricolage Grotesque + Source Sans 3 from Google Fonts (`scripts/build.js` line 28) | Roboto (variable weight) from Google Fonts with a system fallback; sizes per the design. |
| Category names | `data/categories.json` (News, Business, Technology, Culture, Sports, Life) | The design uses Local, World, Business, Technology, Science, Nature, Sports, Entertainment, Lifestyle, Knowledge, Health, Mobility with its own subcategories. That is a data decision, not code (decision 1). |
| Sources and About sections, profile panel | `#sources-section`, `#about-section`, `#profile-panel` | Keep, restyled with the new tokens; reached from the avatar menu. The panel keeps its reserved account slot. |
| Hover states, checkbox, "Single" / "Switch" rows | — | Hover: tab text turns blue (to confirm once the hover component can be read). Checkbox: used by the Following manager. "Single" / "Switch": unused by any screen; left out until the designer says what they are. |

---

## 3. Extra buttons: what is missing and what I propose

Rule of the project: no third-party services, no accounts, no server. Everything below respects it.

| Button / view | Missing today | Proposal | Fits the rules? |
|---|---|---|---|
| **Save** (bookmark on every item) and **My Hub › Saved** | No saved list | Keep a list of saved item ids in the visitor's browser (`localStorage`, same try/catch pattern as the preferences). The bookmark fills when saved. The Saved tab shows those items, newest-saved first, with the plain empty message when there are none. Works in the preview and on the hosted site; vanishes if the visitor clears their browser. When sign-in arrives later, the same list moves to the account. | Yes |
| **Following ⚙** and the **Manage Following** panel | No following | A list of followed subcategory ids in the browser. The Following tab shows the feed limited to them; the gear opens the panel from the design (search, All / Following toggle, one accordion per category with a count badge, checkbox grid, Select all / Clear, Cancel / Save Changes), built from `data/categories.json`. "Following (12)" counts the checked boxes. The design's checkbox component is used as drawn. | Yes |
| **Like** with a count | No likes, no counts anywhere in the data | Likes need an account and a shared server to mean anything. Options: (a) leave the button out until accounts exist (recommended); (b) show a private "liked" toggle stored in the browser with no count; (c) keep the design's look with the count hidden. Feeds carry no like counts and YouTube counts would need the API key. | (a) and (b) yes; a real count, no |
| **Comment** | No comments | Same as Like: needs accounts and a server. Leave it out for now (recommended) or show it disabled with a "coming later" tooltip. | Leaving out, yes |
| **Share** | No share action | The browser's own share sheet (`navigator.share`) when available (phones), otherwise "Copy link" with a short confirmation. Shares the original article or video link. No service needed. | Yes |
| **Live** | Nothing in the data marks an item as live | Simplest faithful version: Live = the videos-only feed, newest first, with the sections News / Sports / Music mapped to the sources' categories; the existing article/video button already does this filtering. Real live streams would need the YouTube Data API key and a per-video "live" check, so that is a later step. | Yes (videos); real live, later |
| **Home** | — | Home = no category selected, second bar hidden. Replaces the current "All" chip and the "pick a category" hint. | Yes |
| **‹ › arrows** on the top bar | Ribbon scrolls by swipe only | Two buttons that scroll the row by its visible width; greyed at the ends; hidden when everything fits and on phones. | Yes |
| **Avatar** | A plain profile icon in the controls row | A 40 px round button showing a neutral avatar (no sign-in yet) that opens the existing panel: preferred language and location, links to Saved, Following, Sources and About, and the reserved sign-in slot. On phones the language, location and article/video controls move into this panel if decision 3 says so. | Yes |
| **Logo** | Text wordmark | Export the round yellow logo from Figma as an SVG (once Figma calls are available again) and use it; the text "Curanet" stays as the accessible name and in the About section. | Yes |
| **Absolute dates** ("Dec 12, 2025") | Only relative times | Relative time for the first 7 days, then a short date. | Yes |
| **Publisher icons** | None | Monogram circles (no images), optionally real favicons on the hosted site. | Yes |

Not in the design but required by the brief, and kept: the language filter, the location filter,
the article/video button, and search. Where they sit is decision 3.

---

## 4. Decisions needed before building

1. **Category tree.** Keep the current six categories (News, Business, Technology, Culture,
   Sports, Life) and only restyle, or adopt the design's tree (Local, World, Business, Technology,
   Science, Nature, Sports, Entertainment, Lifestyle, Knowledge, Health, Mobility, each with its own
   subcategories)? The design's two taxonomies also disagree with each other (the second bar lists
   Local → News, Politics, Justice, Economy, Health, Education, Transport, Events; the Following
   panel lists Local → News, Events, Politics, Community, Weather). If you want the design's tree,
   send the final list and I will add it with the category skills and re-file the 60 sources.
2. **Which article layout**: time at the bottom-left with actions at the right (the "Menu" /
   Desktop frames), or "publisher • time" on one line with actions under the title (frame "B")?
   Recommended: the first; it is what 14 of the 16 menu variants show.
3. **Where the four filter controls live.** Proposal: a slim right-aligned row under the bars on
   desktop; on phones, language / location / article-video inside the avatar panel and the search
   box as a magnifier button in the top row. Alternative: keep today's controls row everywhere.
4. **Mobile subcategory bar**: under the menu (V1) or docked at the bottom (V2)? Recommended: V1
   first (one layout for all screens, no safe-area questions); V2 can be added as an option later.
5. **Publisher icons**: monograms only, or real favicons on the hosted site (loaded from the
   publisher's own site, never copied into the repository) with monograms as fallback?
6. **Dark theme**: the design has none. Keep a derived dark theme (recommended, it already works)
   or ship light only?
7. **Like and Comment**: leave them out until accounts exist (recommended), or show them disabled?
8. **"Single" / "Switch" components**: what are they for? They appear on no screen.

I will proceed with the recommended answers unless you say otherwise.

---

## 5. Implementation plan

Each phase is one pull request, each ends with `npm run check` green, a rebuilt preview and
screenshots at phone and desktop widths. Work goes on a branch from `main`.

**Phase 1 — Visual tokens and typography (small).** New light palette and derived dark palette in
`styles.css`, Roboto from Google Fonts in `scripts/build.js`, radii and shadows. No layout change.
Everything still passes the existing tests.

**Phase 2 — Top bars (medium).** One sticky 60 px bar with logo, text tabs, arrows and the avatar
button; the 50 px second bar with centred tabs, hidden on Home; Home replaces All; mobile rows at
48 px with the avatar pinned; the controls row per decision 3. Update `docs/LAYOUT.md` to describe
the new bars. Tests for Home / arrows / tab states.

**Phase 3 — Feed and cards (medium).** The white panel with dividers; new article and video
templates (publisher line above the title, bottom row with time and actions, 2- and 3-line title
clamp, thumbnail sizes, play circle); monogram publisher icons; relative-then-absolute dates; Share
with copy-link fallback; Save with the browser-side list and the filled bookmark. Update
`docs/LAYOUT.md` for the card anatomy. Build tests for the new templates and strings in English
and French.

**Phase 4 — My Hub (medium).** Saved tab; Following tab with the Manage Following panel (search,
toggle, accordions, checkbox grid, Select all / Clear, Cancel / Save Changes); URL state for
`view=saved|following` on the hosted site; works with storage blocked (shows a hint).

**Phase 5 — Live (small).** Live tab = videos-only feed with News / Sports / Music sections mapped
to categories; marked in the About section as "latest videos" until real live streams exist.

**Phase 6 — Data (depends on decision 1).** If the design's category tree is adopted: add the
categories and subcategories with `/add-category`, re-file the 60 sources with `/edit-source`,
rebuild. If not, nothing to do.

**Later, outside this plan**: Like and Comment (need accounts and a server), real live streams
(need the YouTube API key), a server-side Saved / Following when sign-in arrives.

Rough sizes: phases 1 + 2 + 3 together are about two sessions of work; 4 and 5 one more; 6 is
mostly data entry.

---

## 6. What could not be read, and how to unblock it

Figma's Starter plan allows **20 tool calls per month** through the Claude connection, and those
were used up while reading this file (the page screenshot, four frame screenshots, seven of the
sixteen menu variants, one full design-context read of frame "B", the layer tree, and the variable
list). Everything above comes from those captures, measured pixel by pixel; the typeface and
weights come from the one design-context read (Roboto 400 / 500 / 600).

Not read: menu variants 4 to 12 (presumably the remaining categories), the two hover components,
the exact text of the "Single" / "Switch" rows, and the logo as a vector.

To unblock any of it, one of: wait for the monthly reset of the Figma allowance; move the Figma
file to a plan with a Dev or Full seat (200 calls a day); or export the frames you care about as
PNG/SVG from Figma (File → Export) and attach them in a session. The plan above does not depend on
the missing pieces except for the exact hover colours and the logo file.
