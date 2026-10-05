# Curanet layout — design reference

This is the layout the site must follow exactly. It is a single-column feed in the style of
Reddit's or Facebook's. Copy the structure only: Curanet has its own colours, type and icons, not
theirs. Both outputs (the private preview and the hosted site) are built from the same code and
follow this page.

## Ribbons

- Two ribbons sit at the very top of every page. The first lists the categories. The second lists
  the subcategories of the chosen category. Each begins with **All**, scrolls sideways when it does
  not fit, and stays visible while the visitor scrolls (sticky).
- While the first ribbon is on All, the second keeps its place and shows a hint to pick a category.
- Changing the category resets the subcategory to All.

## Controls row

- Directly below the ribbons, on the right: the language filter, the profile button, the location
  filter, the article/video button and the search bar. On a phone all five stay reachable without
  sideways scrolling.
- The article/video button is one button that changes the feed each time it is clicked: articles
  and videos together → articles only → videos only → back to both. It starts on articles and
  videos together, and its label always shows the current setting.
- The language and location filters list only the languages and countries that exist in the data,
  with All first.
- Search runs when the visitor presses Enter or taps the search icon, and covers titles, excerpts
  and source names within the current selection.

## Feed

- Below the controls is the content: one item under another in a single centred column, newest
  first, showing about 30 at a time with more appearing as the visitor scrolls. Articles and videos
  share the same feed unless the article/video button narrows it.
- **Article item:** the title at the top left and the thumbnail on the right. Directly below the
  title is the publisher's name, for example "BBC". Clicking the title or the thumbnail opens the
  original article in a new tab. When there is no thumbnail, the title uses the full width.
- **Video item:** the video at the top, shown as its preview image with a play button. Directly
  below the video is its title. Directly below the title, on the left, is the YouTube channel's
  name. In the preview the video opens on YouTube in a new tab; on the hosted site it plays in
  YouTube's privacy-enhanced embedded player (youtube-nocookie.com) when the play button is pressed.
- Beside the publisher or channel name, show the time since publication in small text. Show no
  excerpt in the feed.
- Show a plain message when nothing matches the current selection.
- Language and location start on All and combine with the ribbons, the article/video button and
  each other.

## Profile panel

- The profile button opens a small panel with the visitor's saved language and location, kept in
  the browser, and links to the Sources and About sections. The saved values apply only when the
  visitor arrives with no filters set, and the page must still work when browser storage is
  unavailable. There is no sign-in. The panel is built so sign-in can be added later without
  changing the layout.

## State in the address

- On the hosted site, the chosen category, subcategory, language, location, article/video setting
  and search words appear in the page address, so a view can be bookmarked or shared. In the
  preview, that state is kept inside the page (the artifact viewer only passes plain `#anchors`).

## Sources and About

- Sources and About are sections of the same page, reached from the profile panel. Sources lists
  each source with its status and last successful fetch. About explains that Curanet shows
  headlines and short excerpts with links to the original publishers, and gives a placeholder
  contact for removal requests.

## Preview vs hosted

| | Preview (private artifact) | Hosted site (static files) |
|---|---|---|
| Thumbnails | downloaded at build time, shrunk to ~240 px wide, embedded as data URIs; oldest dropped first to stay under 12 MB | loaded straight from the address the feed gives, no copies |
| Videos | open on YouTube in a new tab | privacy-enhanced embedded player on click |
| Filter state | inside the page | in the page address (query string) |
| Output | one self-contained HTML fragment (no doctype/html/head/body, per the artifact rules) | `dist/index.html` plus assets |

## Quality bar

Mobile first; accessible to WCAG AA (contrast, keyboard operation, focus states, labels, reduced
motion); interface in English with every string kept in a translation table ready for French;
light and dark themes.
