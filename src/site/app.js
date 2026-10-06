/*
  Curanet browser app. One plain script shared by the hosted site and the private preview.
  It reads CURANET_CONFIG (injected by the build) and the JSON in #curanet-data, then renders
  everything with createElement and textContent, or by cloning the <template>s of index.html: no
  markup is ever built from feed data.

  CURANET_CONFIG: { mode: 'hosted'|'preview', urlState: boolean, thumbnails: 'remote'|'embedded',
                    video: 'embed'|'link', uiLang: 'en'|'fr' }

  Layout version 3 (docs/LAYOUT.md, the live curanet.io design): a three-bar header (the blue bar
  with search, location picker, article/video toggle and avatar menu; the category tabs with the
  ≡ Menu panel; the grey row with the sections of the open view), one feed card, and the Manage
  Following, Sources and About pages.

  Views: 'feed' (Home or a category), 'saved' and 'following' (the visitor's own lists, reached
  from the grey row on Home), 'manage' (Manage Following), 'live' (latest videos), 'sources',
  'about'. Saved items, followed sections and settings live in the visitor's browser
  (localStorage) and fall back to memory when storage is refused.
*/

/* == pure helpers begin ==
   Small functions with no DOM and no translation table, kept together so test/build.test.js can
   evaluate this block on its own (it slices the file between the "pure helpers" markers and runs
   it in a vm). app.js reads them through CURANET_HELPERS below. */
/* exported CURANET_HELPERS */
var CURANET_HELPERS = (function () {
  'use strict';

  var TYPE_CYCLE = ['both', 'videos', 'articles'];
  var RELATIVE_LIMIT_MS = 7 * 86400 * 1000;

  /**
   * The next value of the article/video toggle: both → videos only → articles only → both.
   * @param {string} current
   * @returns {'both'|'articles'|'videos'}
   */
  function cycleTypeValue(current) {
    var index = TYPE_CYCLE.indexOf(current);
    return /** @type {'both'|'articles'|'videos'} */ (TYPE_CYCLE[(index + 1) % TYPE_CYCLE.length]);
  }

  /**
   * How a date should be shown: relative for the first 7 days ("just now", "5 minutes ago",
   * "1 hour ago", "2 days ago"), then a short absolute date. The caller turns the descriptor into
   * words, so this stays free of the translation table.
   * @param {string} iso
   * @param {number} nowMs
   * @returns {{kind: 'invalid'}|{kind: 'now'}|{kind: 'relative', unit: 'minute'|'hour'|'day', n: number}|{kind: 'date', date: Date}}
   */
  function formatRelativeOrDate(iso, nowMs) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return { kind: 'invalid' };
    var agoMs = nowMs - date.getTime();
    if (agoMs >= RELATIVE_LIMIT_MS) return { kind: 'date', date: date };
    var ago = agoMs / 1000;
    if (ago < 45) return { kind: 'now' };
    if (ago < 3600) return { kind: 'relative', unit: 'minute', n: Math.max(1, Math.floor(ago / 60)) };
    if (ago < 86400) return { kind: 'relative', unit: 'hour', n: Math.floor(ago / 3600) };
    return { kind: 'relative', unit: 'day', n: Math.floor(ago / 86400) };
  }

  /**
   * The first user-perceived character of a text (a whole emoji or a letter with its accents),
   * never half of a surrogate pair. Empty for an empty text.
   * @param {string} text
   * @returns {string}
   */
  function firstGrapheme(text) {
    if (!text) return '';
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        var first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next();
        if (!first.done && first.value && first.value.segment) return first.value.segment;
      }
    } catch (e) {
      // Fall back to code points below.
    }
    var points = Array.from(text);
    return points.length ? points[0] : '';
  }

  /**
   * Lower-case text without accents, for search.
   * @param {string} text
   * @returns {string}
   */
  function fold(text) {
    var out = String(text || '').toLowerCase();
    try {
      out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
    } catch (e) {
      // Older engines without normalize: accents stay significant.
    }
    return out;
  }

  return { cycleTypeValue: cycleTypeValue, formatRelativeOrDate: formatRelativeOrDate, firstGrapheme: firstGrapheme, fold: fold, TYPE_CYCLE: TYPE_CYCLE };
})();
/* == pure helpers end == */

(function () {
  'use strict';

  /**
   * @typedef {Object} FeedItem
   * @property {string} id
   * @property {string} s          Source id.
   * @property {string} t          Title.
   * @property {string} l          Link to the original.
   * @property {string} p          Published, ISO.
   * @property {string|number|null} th    Thumbnail address or data URI, an index into DATA.images, or null.
   * @property {'a'|'v'} ty        Article or video.
   * @property {string} [v]        YouTube video id.
   * @property {string} x          Excerpt (search only).
   * @property {string} [_search]  Folded text for search, computed here.
   *
   * @typedef {Object} FeedSource
   * @property {string} id
   * @property {string} name
   * @property {'feed'|'youtube_channel'} type
   * @property {string} url
   * @property {string|null} siteUrl
   * @property {string} category
   * @property {string} subcategory
   * @property {string} country
   * @property {string} language
   * @property {string} status
   * @property {string|null} lastSuccess
   * @property {string|null} lastResult
   *
   * @typedef {{id: string, name: {en?: string, fr?: string}}} Named
   * @typedef {Named & {subcategories: Named[]}} FeedCategory
   *
   * @typedef {Object} FeedData
   * @property {string} generatedAt
   * @property {FeedCategory[]} categories
   * @property {FeedSource[]} sources
   * @property {FeedItem[]} items
   * @property {string[]} languages
   * @property {string[]} countries
   * @property {string[]} [images]  Preview only: embedded pictures referenced by index from items.
   *
   * @typedef {'feed'|'saved'|'following'|'manage'|'live'|'sources'|'about'} View
   *
   * @typedef {Object} FilterState
   * @property {string} c        Category id or '' for all.
   * @property {string} s        Subcategory id, or the Live section (news|sports|music), or ''.
   * @property {string} lang     Language code or ''.
   * @property {string} loc      Country code or ''.
   * @property {'both'|'articles'|'videos'} type
   * @property {string} q        Search words.
   *
   * @typedef {{theme: 'light'|'dark'|'system', subcatBar: 'top'|'bottom'}} Settings
   *
   * @typedef {Object} Menu       A dropdown (location, avatar, share) and its trigger.
   * @property {HTMLElement} trigger
   * @property {HTMLElement} menu
   * @property {() => boolean} isOpen
   * @property {() => void} open
   * @property {(returnFocus: boolean) => void} close
   *
   * @typedef {{input: HTMLInputElement, label: HTMLElement, sub: Named}} ManageBox
   * @typedef {{category: FeedCategory, row: HTMLElement, button: HTMLElement, body: HTMLElement, badge: HTMLElement, badgeText: HTMLElement, boxes: ManageBox[]}} ManageRow
   */

  var H = window['CURANET_HELPERS'];
  var DEFAULT_CONFIG = { mode: 'hosted', urlState: true, thumbnails: 'remote', video: 'embed', uiLang: 'en' };
  var CONFIG = Object.assign({}, DEFAULT_CONFIG, window['CURANET_CONFIG'] || {});
  /** The translation table from strings.js (loaded before this script). */
  var STRINGS = window['CURANET_STRINGS'] || { en: {}, fr: {} };
  var UI_LANG = typeof CONFIG.uiLang === 'string' && CONFIG.uiLang ? CONFIG.uiLang : 'en';
  var PAGE_SIZE = 20;
  var PREFS_KEY = 'curanet.prefs';
  var SAVED_KEY = 'curanet.saved';
  var FOLLOWING_KEY = 'curanet.following';
  var SETTINGS_KEY = 'curanet.settings';
  var TYPE_LABELS = { both: 'showingBoth', articles: 'showingArticles', videos: 'showingVideos' };
  var STATUS_LABELS = { active: 'statusActive', paused: 'statusPaused', blocked: 'statusBlocked', waiting_for_key: 'statusWaitingForKey' };
  var FILTER_PARAMS = ['view', 'c', 's', 'lang', 'loc', 'type', 'q'];
  var LIVE_SECTIONS = ['news', 'sports', 'music'];
  var LIVE_LABELS = { news: 'liveNews', sports: 'liveSports', music: 'liveMusic' };
  /** Views that show the feed card. */
  var FEED_VIEWS = { feed: true, saved: true, following: true, live: true };
  /** URL tokens (hash or ?view=) for the views that have one. */
  var VIEW_TOKENS = { saved: 'saved', following: 'following', manage: 'following-manage', live: 'live', sources: 'sources', about: 'about' };
  /** The header slides away once the page is scrolled down past this many pixels. */
  var HEADER_HIDE_AFTER = 100;
  /** A mouse drag on the tabs track shorter than this is a click. */
  var DRAG_THRESHOLD_PX = 4;
  var TOAST_MS = 5000;
  var TOAST_LEAVE_MS = 200;
  var MAX_TOASTS = 2;
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var fold = H.fold;

  // ------------------------------------------------------------------ strings

  /**
   * Interface text by key, with {name} placeholders filled from params.
   * @param {string} key
   * @param {Record<string, string|number>} [params]
   * @returns {string}
   */
  function t(key, params) {
    var table = STRINGS[UI_LANG] || STRINGS.en;
    var text = table && typeof table[key] === 'string' ? table[key] : STRINGS.en[key];
    if (typeof text !== 'string') text = key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
      });
    }
    return text;
  }

  /**
   * Fill every element under `root` that carries data-t (text) or data-t-<attribute>. Template
   * content is not reached from the document, so cloneTemplate runs this on every clone.
   * @param {ParentNode} root
   */
  function applyStrings(root) {
    var textNodes = root.querySelectorAll('[data-t]');
    for (var i = 0; i < textNodes.length; i += 1) {
      textNodes[i].textContent = t(textNodes[i].getAttribute('data-t') || '');
    }
    var attrs = ['aria-label', 'title', 'placeholder'];
    for (var a = 0; a < attrs.length; a += 1) {
      var nodes = root.querySelectorAll('[data-t-' + attrs[a] + ']');
      for (var n = 0; n < nodes.length; n += 1) {
        nodes[n].setAttribute(attrs[a], t(nodes[n].getAttribute('data-t-' + attrs[a]) || ''));
      }
    }
  }

  // ------------------------------------------------------------------ small DOM helpers

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function byId(id) {
    var el = document.getElementById(id);
    if (!el) throw new Error('Curanet: the page is missing #' + id);
    return el;
  }

  /**
   * @param {ParentNode} root
   * @param {string} selector
   * @returns {HTMLElement}
   */
  function find(root, selector) {
    var el = root.querySelector(selector);
    if (!el) throw new Error('Curanet: the template is missing ' + selector);
    return /** @type {HTMLElement} */ (el);
  }

  /** @param {Element} el */
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /**
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * @param {string} className
   * @param {string} [text]
   * @returns {HTMLButtonElement}
   */
  function button(className, text) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function cloneTemplate(id) {
    var template = /** @type {HTMLTemplateElement} */ (byId(id));
    var first = template.content.firstElementChild;
    if (!first) throw new Error('Curanet: template #' + id + ' is empty');
    var node = /** @type {HTMLElement} */ (first.cloneNode(true));
    applyStrings(node);
    return node;
  }

  /** @returns {boolean} */
  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  /**
   * @param {HTMLElement} target
   * @param {boolean} [preventScroll]
   */
  function focusOn(target, preventScroll) {
    try {
      target.focus({ preventScroll: Boolean(preventScroll) });
    } catch (e) {
      target.focus();
    }
  }

  /**
   * @param {Element|null} node
   * @returns {boolean} true when the node or one of its ancestors carries the hidden attribute.
   */
  function isHiddenAway(node) {
    for (var current = node; current; current = current.parentElement) {
      if (current.hasAttribute('hidden')) return true;
    }
    return false;
  }

  /**
   * The elements inside `root` that the Tab key can reach, in document order.
   * @param {HTMLElement} root
   * @returns {HTMLElement[]}
   */
  function focusableIn(root) {
    var nodes = root.querySelectorAll(FOCUSABLE);
    /** @type {HTMLElement[]} */
    var out = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var node = /** @type {HTMLElement} */ (nodes[i]);
      if (isHiddenAway(node) || node.getAttribute('aria-hidden') === 'true') continue;
      if (node.getClientRects().length === 0) continue;
      out.push(node);
    }
    return out;
  }

  function scrollToTop() {
    if (window.scrollY <= 0) return;
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  }

  // ------------------------------------------------------------------ storage

  /**
   * All reads and writes go through here; a browser that refuses storage (private mode, blocked
   * site data) turns storageOk off and the page carries on in memory. A value that is stored but
   * unreadable (not JSON) is a different matter: it is ignored and overwritten by the next save,
   * and says nothing about whether storage works.
   */
  var storageOk = true;

  /**
   * @param {string} key
   * @returns {any} the parsed JSON, or null.
   */
  function readStorage(key) {
    var raw;
    try {
      raw = window.localStorage.getItem(key);
    } catch (e) {
      storageOk = false;
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {any} value
   * @returns {boolean} false when the browser refused. A save that works again clears the hint.
   */
  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      var ok = window.localStorage.getItem(key) !== null;
      storageOk = ok;
      return ok;
    } catch (e) {
      storageOk = false;
      return false;
    }
  }

  /**
   * @param {any} value
   * @returns {string[]}
   */
  function stringList(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (entry) { return typeof entry === 'string' && entry.length <= 200; }).slice(0, 5000);
  }

  // ------------------------------------------------------------------ data

  /** @returns {FeedData} */
  function readData() {
    /** @type {FeedData} */
    var empty = { generatedAt: '', categories: [], sources: [], items: [], languages: [], countries: [] };
    var dataEl = document.getElementById('curanet-data');
    if (!dataEl) return empty;
    try {
      var parsed = JSON.parse(dataEl.textContent || '');
      var data = Object.assign(empty, parsed);
      if (!Array.isArray(data.categories)) data.categories = [];
      if (!Array.isArray(data.sources)) data.sources = [];
      if (!Array.isArray(data.items)) data.items = [];
      if (!Array.isArray(data.languages)) data.languages = [];
      if (!Array.isArray(data.countries)) data.countries = [];
      return data;
    } catch (e) {
      return empty;
    }
  }

  var DATA = readData();
  /** @type {Record<string, FeedSource>} */
  var SOURCES = Object.create(null); // no inherited names, so "constructor" is never a source
  DATA.sources.forEach(function (source) { SOURCES[source.id] = source; });
  /** @type {Record<string, FeedCategory>} */
  var CATEGORIES = Object.create(null); // same: "?c=constructor" must not match
  DATA.categories.forEach(function (category) { CATEGORIES[category.id] = category; });
  /** @type {FeedItem[]} */
  var ITEMS = DATA.items.filter(function (item) { return item && SOURCES[item.s]; });
  /** @type {Record<string, FeedItem>} */
  var ITEM_BY_ID = Object.create(null);
  ITEMS.forEach(function (item) {
    item._search = fold(item.t + ' ' + item.x + ' ' + SOURCES[item.s].name);
    ITEM_BY_ID[item.id] = item;
  });
  /** Live › Music uses the "music" subcategory when one exists, otherwise the Entertainment category. */
  var HAS_MUSIC_SUBCATEGORY = DATA.categories.some(function (category) {
    return (category.subcategories || []).some(function (sub) { return sub.id === 'music'; });
  });

  /**
   * @param {Named|null|undefined} named
   * @returns {string}
   */
  function nameOf(named) {
    if (!named) return '';
    var names = named.name || {};
    return names[UI_LANG] || names.en || named.id;
  }

  /**
   * @param {string} categoryId
   * @param {string} subcategoryId
   * @returns {Named|null}
   */
  function subcategoryOf(categoryId, subcategoryId) {
    var category = CATEGORIES[categoryId];
    if (!category || !Array.isArray(category.subcategories)) return null;
    for (var i = 0; i < category.subcategories.length; i += 1) {
      if (category.subcategories[i].id === subcategoryId) return category.subcategories[i];
    }
    return null;
  }

  /**
   * @param {FeedSource} source
   * @returns {string} "category/subcategory", the id used by the Following list.
   */
  function sectionKey(source) {
    return source.category + '/' + source.subcategory;
  }

  // ------------------------------------------------------------------ Intl helpers

  /**
   * @param {'language'|'region'} kind
   * @param {string} code
   * @returns {string}
   */
  function displayName(kind, code) {
    try {
      if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
        var names = new Intl.DisplayNames([UI_LANG], { type: kind });
        var name = names.of(kind === 'region' ? code.toUpperCase() : code);
        if (name && name !== code) return name;
      }
    } catch (e) {
      // Unknown code: fall back to the code itself.
    }
    return code;
  }

  /**
   * The codes with their display names, sorted by name.
   * @param {string[]} codes
   * @param {'language'|'region'} kind
   * @returns {{code: string, label: string}[]}
   */
  function namedCodes(codes, kind) {
    var out = codes.map(function (code) { return { code: code, label: displayName(kind, code) }; });
    out.sort(function (a, b) { return a.label.localeCompare(b.label, UI_LANG); });
    return out;
  }

  /** @type {Intl.DateTimeFormat|null} */
  var absoluteFormat = null;
  /** @type {Intl.DateTimeFormat|null} */
  var shortDateFormat = null;
  /** @type {Intl.NumberFormat|null} */
  var numberFormat = null;
  try {
    if (typeof Intl !== 'undefined') {
      absoluteFormat = new Intl.DateTimeFormat(UI_LANG, { dateStyle: 'medium', timeStyle: 'short' });
      shortDateFormat = new Intl.DateTimeFormat(UI_LANG, { year: 'numeric', month: 'short', day: 'numeric' });
      numberFormat = new Intl.NumberFormat(UI_LANG);
    }
  } catch (e) {
    // Formatting falls back to plain strings below.
  }

  /**
   * @param {number} n
   * @returns {string}
   */
  function formatNumber(n) {
    try {
      return numberFormat ? numberFormat.format(n) : String(n);
    } catch (e) {
      return String(n);
    }
  }

  /**
   * @param {string} iso
   * @returns {string}
   */
  function formatAbsolute(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    try {
      return absoluteFormat ? absoluteFormat.format(date) : date.toLocaleString();
    } catch (e) {
      return date.toISOString();
    }
  }

  /**
   * @param {Date} date
   * @returns {string} "Dec 12, 2025" / "12 déc. 2025"
   */
  function formatShortDate(date) {
    try {
      return shortDateFormat ? shortDateFormat.format(date) : date.toDateString();
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }

  /**
   * "just now", "5 minutes ago", "1 hour ago", "2 days ago", then "Dec 12, 2025".
   * @param {string} iso
   * @param {number} nowMs
   * @returns {string}
   */
  function formatWhen(iso, nowMs) {
    var when = H.formatRelativeOrDate(iso, nowMs);
    if (when.kind === 'invalid') return '';
    if (when.kind === 'now') return t('justNow');
    if (when.kind === 'date') return formatShortDate(when.date);
    var one = { minute: 'minuteAgo', hour: 'hourAgo', day: 'dayAgo' };
    var many = { minute: 'minutesAgo', hour: 'hoursAgo', day: 'daysAgo' };
    return when.n === 1 ? t(one[when.unit]) : t(many[when.unit], { n: formatNumber(when.n) });
  }

  /**
   * @param {HTMLElement} timeEl
   * @param {string} iso
   * @param {number} nowMs
   */
  function fillTime(timeEl, iso, nowMs) {
    timeEl.setAttribute('datetime', iso);
    timeEl.textContent = formatWhen(iso, nowMs);
    var absolute = formatAbsolute(iso);
    if (absolute) timeEl.title = t('publishedOn', { date: absolute });
  }

  // ------------------------------------------------------------------ state

  /** @type {FilterState} */
  var state = { c: '', s: '', lang: '', loc: '', type: 'both', q: '' };
  /** @type {string[]} */
  var searchWords = [];
  /** @type {View} */
  var view = 'feed';
  /** Saved item ids, newest-saved first. */
  var savedIds = stringList(readStorage(SAVED_KEY));

  /**
   * Keep only the "category/subcategory" ids that exist in today's tree, once each. A section
   * the owner removed or re-filed since the visitor followed it would otherwise still count
   * towards "Following (n)" and hide the "not following anything" message.
   * @param {string[]} ids
   * @returns {string[]}
   */
  function knownSectionIds(ids) {
    /** @type {Record<string, boolean>} */
    var seen = Object.create(null);
    return ids.filter(function (id) {
      var slash = id.indexOf('/');
      if (slash <= 0 || seen[id]) return false;
      seen[id] = true;
      return Boolean(subcategoryOf(id.slice(0, slash), id.slice(slash + 1)));
    });
  }

  /** Followed "category/subcategory" ids, limited to sections that still exist. */
  var followingIds = knownSectionIds(stringList(readStorage(FOLLOWING_KEY)));
  /** @type {Settings} */
  var settings = readSettings();

  /** @returns {Settings} */
  function readSettings() {
    var raw = readStorage(SETTINGS_KEY);
    /** @type {Settings} */
    var out = { theme: 'light', subcatBar: 'top' };
    if (raw && typeof raw === 'object') {
      if (raw.theme === 'dark' || raw.theme === 'system' || raw.theme === 'light') out.theme = raw.theme;
      if (raw.subcatBar === 'bottom' || raw.subcatBar === 'top') out.subcatBar = raw.subcatBar;
    }
    return out;
  }

  function saveSettings() {
    writeStorage(SETTINGS_KEY, settings);
  }

  /** @type {MediaQueryList|null} */
  var darkQuery = null;
  try {
    darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (e) {
    // No media queries: "follow system" reads as light.
  }

  /** @returns {boolean} true when the page is dark right now (chosen, or following a dark device). */
  function effectiveDark() {
    if (settings.theme === 'dark') return true;
    if (settings.theme === 'light') return false;
    return Boolean(darkQuery && darkQuery.matches);
  }

  /**
   * Theme at start-up and on change: an explicit light or dark attribute, or none for "system".
   * The build puts the same decision in a tiny inline script at the top of the page so the first
   * paint is already right; running it again here is harmless.
   */
  function applyTheme() {
    var root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    syncThemeToggle();
  }

  /** The grey row docked at the bottom on phones (the CSS limits the class to phone widths). */
  function applySubcatBarSetting() {
    var bottom = settings.subcatBar === 'bottom';
    document.body.classList.toggle('subbar-bottom', bottom);
    document.body.classList.toggle('subcat-bottom', bottom);
  }

  /** @returns {boolean} true when the address carries any filter, valid or not. */
  function hasFilterParams() {
    if (!CONFIG.urlState) return false;
    var params = new URLSearchParams(location.search);
    for (var i = 0; i < FILTER_PARAMS.length; i += 1) {
      if (params.has(FILTER_PARAMS[i])) return true;
    }
    return false;
  }

  /**
   * @param {string} token
   * @returns {View|null}
   */
  function viewFromToken(token) {
    if (token === 'feed') return 'feed';
    for (var name in VIEW_TOKENS) {
      if (VIEW_TOKENS[name] === token) return /** @type {View} */ (name);
    }
    return null;
  }

  /** Read the view and filters from the query string (hosted site only). Unknown values are ignored. */
  function readUrlState() {
    if (!CONFIG.urlState) return;
    var params = new URLSearchParams(location.search);
    var fromView = viewFromToken(params.get('view') || '');
    if (fromView) view = fromView;
    var c = params.get('c') || '';
    if (c && CATEGORIES[c] && view === 'feed') state.c = c;
    var s = params.get('s') || '';
    if (s) {
      if (view === 'live' && LIVE_SECTIONS.indexOf(s) >= 0) state.s = s;
      else if (view === 'feed' && state.c && subcategoryOf(state.c, s)) state.s = s;
    }
    var lang = params.get('lang') || '';
    if (lang && DATA.languages.indexOf(lang) >= 0) state.lang = lang;
    var loc = (params.get('loc') || '').toUpperCase();
    if (loc && DATA.countries.indexOf(loc) >= 0) state.loc = loc;
    var type = params.get('type') || '';
    if (type === 'articles' || type === 'videos') state.type = type;
    state.q = (params.get('q') || '').trim().slice(0, 200);
  }

  /**
   * Mirror the view and filters into the address, without adding history entries. Hosted site:
   * the query string is the one address of a view, and no #hash is left behind. Preview: the
   * state stays in the page and only a plain #anchor names the view (none at all for the feed
   * until another view has been opened).
   */
  function writeUrlState() {
    if (!window.history || typeof history.replaceState !== 'function') return;
    if (!CONFIG.urlState) {
      var token = view === 'feed' ? 'feed' : VIEW_TOKENS[view] || 'feed';
      var current = (location.hash || '').replace(/^#/, '');
      if (current === token || (!current && token === 'feed')) return;
      try {
        history.replaceState(history.state, '', location.pathname + location.search + '#' + token);
      } catch (e) {
        // The artifact viewer may refuse; the page still works.
      }
      return;
    }
    var params = new URLSearchParams();
    if (view !== 'feed' && VIEW_TOKENS[view]) params.set('view', VIEW_TOKENS[view]);
    if (state.c) params.set('c', state.c);
    if (state.s) params.set('s', state.s);
    if (state.lang) params.set('lang', state.lang);
    if (state.loc) params.set('loc', state.loc);
    if (state.type !== 'both') params.set('type', state.type);
    if (state.q) params.set('q', state.q);
    var query = params.toString();
    // The query is the one address of a view on the hosted site; a #hash only triggers a change.
    var url = location.pathname + (query ? '?' + query : '');
    try {
      history.replaceState(history.state, '', url);
    } catch (e) {
      // Some embeddings refuse address changes; the page still works.
    }
  }

  /** @returns {View|null} the view a plain #anchor asks for, if any. */
  function viewFromHash() {
    var hash = (location.hash || '').replace(/^#/, '');
    return hash ? viewFromToken(hash) : null;
  }

  /** @returns {{lang?: string, loc?: string}|null} */
  function loadPrefs() {
    var parsed = readStorage(PREFS_KEY);
    return parsed && typeof parsed === 'object' ? parsed : null;
  }

  // ------------------------------------------------------------------ elements

  var siteHeader = byId('site-header');
  var topbar = byId('topbar');
  var brandLink = byId('brand-link');
  var searchForm = /** @type {HTMLFormElement} */ (byId('search-form'));
  var searchInput = /** @type {HTMLInputElement} */ (byId('search-input'));
  var searchToggle = byId('search-toggle');
  var locButton = byId('loc-button');
  var locLabel = byId('loc-label');
  var locMenu = byId('loc-menu');
  var typeButton = byId('type-button');
  var typeGlyph = /** @type {HTMLImageElement} */ (byId('type-glyph'));
  var typeLabel = byId('type-label');
  var avatarButton = byId('avatar-button');
  var avatarMenu = byId('avatar-menu');
  var menuFollowing = byId('menu-following');
  var langButton = byId('lang-button');
  var langCurrent = byId('lang-current');
  var langList = byId('lang-list');
  var themeToggle = byId('theme-toggle');
  var themeToggleLabel = byId('theme-toggle-label');
  var settingsButton = byId('settings-button');
  var tabsTrack = byId('tabs-track');
  var menuButton = byId('menu-button');
  var subbar = byId('subbar');
  var sectionsRow = byId('sections-row');
  var menuPanel = byId('menu-panel');
  var menuPanelHeading = byId('menu-panel-heading');
  var menuPanelClose = byId('menu-panel-close');
  var panelCategories = byId('panel-categories');
  var panelMore = byId('panel-more');
  var mainEl = byId('main');
  var feedSection = byId('feed-section');
  var feedHeading = byId('feed-heading');
  var resultCount = byId('result-count');
  var actionStatus = byId('action-status');
  var storageHint = byId('storage-hint');
  var feedList = byId('feed-list');
  var emptyState = byId('empty-state');
  var emptyText = byId('empty-text');
  var clearButton = byId('clear-filters');
  var manageFollowingButton = byId('manage-following-button');
  var feedEnd = byId('feed-end');
  var sentinel = byId('feed-sentinel');
  var showMore = byId('show-more');
  var manageSection = byId('manage-section');
  var manageHeading = byId('manage-heading');
  var manageCancel = byId('manage-cancel');
  var manageSave = byId('manage-save');
  var manageSearch = /** @type {HTMLInputElement} */ (byId('manage-search'));
  var manageShowAll = byId('manage-show-all');
  var manageShowFollowing = byId('manage-show-following');
  var manageList = byId('manage-list');
  var manageEmpty = byId('manage-empty');
  var sourcesSection = byId('sources-section');
  var sourcesHeading = byId('sources-heading');
  var sourcesBody = byId('sources-body');
  var sourcesEmpty = byId('sources-empty');
  var aboutSection = byId('about-section');
  var aboutHeading = byId('about-heading');
  var generatedAt = byId('generated-at');
  var toastRegion = byId('toast-region');
  var dialog = /** @type {HTMLDialogElement} */ (byId('profile-panel'));
  var prefLang = /** @type {HTMLSelectElement} */ (byId('pref-lang'));
  var prefLoc = /** @type {HTMLSelectElement} */ (byId('pref-loc'));
  var prefSave = byId('pref-save');
  var prefNote = byId('pref-note');
  var profileClose = byId('profile-close');
  var skipLink = find(document, '.skip-link');

  // ------------------------------------------------------------------ dropdown menus

  /**
   * The one dropdown open right now (location, avatar or a share menu); opening another closes
   * it first. Escape, a click outside, Tab leaving the menu or choosing an item closes a menu;
   * focus goes into the menu on open and back to its trigger on close (unless the choice takes
   * the visitor somewhere else, which then takes the focus).
   * @type {Menu|null}
   */
  var openMenu = null;

  /**
   * @param {HTMLElement} trigger
   * @param {HTMLElement} menu
   * @param {{onOpen?: () => void, onClose?: () => void}} [hooks]
   * @returns {Menu}
   */
  function createMenu(trigger, menu, hooks) {
    /** @type {Menu} */
    var controller = {
      trigger: trigger,
      menu: menu,
      isOpen: function () { return !menu.hidden; },
      open: function () {
        if (openMenu && openMenu !== controller) openMenu.close(false);
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('data-state', 'open');
        menu.setAttribute('data-state', 'open');
        openMenu = controller;
        if (hooks && hooks.onOpen) hooks.onOpen();
        if (siteHeader.contains(menu)) setHeaderHidden(false);
        var current = /** @type {HTMLElement|null} */ (menu.querySelector('[aria-current="true"]'));
        var items = focusableIn(menu);
        focusOn(current || items[0] || menu, true);
      },
      close: function (returnFocus) {
        if (menu.hidden) return;
        menu.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('data-state', 'closed');
        menu.setAttribute('data-state', 'closed');
        if (openMenu === controller) openMenu = null;
        if (hooks && hooks.onClose) hooks.onClose();
        if (returnFocus) focusOn(trigger, true);
      },
    };
    trigger.setAttribute('data-state', 'closed');
    menu.setAttribute('data-state', 'closed');
    trigger.addEventListener('click', function () {
      if (controller.isOpen()) controller.close(true);
      else controller.open();
    });
    menu.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.preventDefault();
        event.stopPropagation();
        controller.close(true);
      }
    });
    // Tab (or a click on another control) moves focus out: the menu closes and focus stays
    // where the visitor sent it. A blur with no destination (window switch) leaves it open.
    menu.addEventListener('focusout', function (event) {
      var next = event.relatedTarget;
      if (next instanceof Node && !menu.contains(next) && !trigger.contains(next)) controller.close(false);
    });
    return controller;
  }

  /** @param {Event} event   A mousedown or touchstart anywhere: closes the open menu when it is outside. */
  function onPointerDownOutside(event) {
    if (!openMenu) return;
    var target = event.target;
    if (!(target instanceof Node)) return;
    if (openMenu.menu.contains(target) || openMenu.trigger.contains(target)) return;
    openMenu.close(false);
  }

  // ------------------------------------------------------------------ header: slide on scroll

  var headerHidden = false;
  var lastScrollY = 0;

  /** Keeps --header-h equal to the visible sticky bars' height so focused items scroll out from under them. */
  function updateHeaderHeight() {
    var height = siteHeader.offsetHeight;
    if (headerHidden) height = Math.max(0, height - topbar.offsetHeight);
    document.documentElement.style.setProperty('--header-h', height + 'px');
  }

  /** @returns {boolean} true while the blue bar must stay in view whatever the scrolling. */
  function headerPinned() {
    if (prefersReducedMotion()) return true;
    var body = document.body.classList;
    if (body.contains('search-open') || body.contains('menu-open')) return true;
    return Boolean(openMenu && siteHeader.contains(openMenu.menu));
  }

  /** @param {boolean} hidden */
  function setHeaderHidden(hidden) {
    if (hidden && headerPinned()) hidden = false;
    if (hidden === headerHidden) return;
    headerHidden = hidden;
    siteHeader.classList.toggle('is-hidden', hidden);
    updateHeaderHeight();
  }

  /** Scrolling down past 100 px slides the blue bar away; any scroll up, or the top, brings it back. */
  function onScroll() {
    var y = window.scrollY || window.pageYOffset || 0;
    var delta = y - lastScrollY;
    lastScrollY = y;
    if (y <= 0 || delta < 0) setHeaderHidden(false);
    else if (delta > 0 && y > HEADER_HIDE_AFTER) setHeaderHidden(true);
  }

  function trackHeaderHeight() {
    updateHeaderHeight();
    if (typeof ResizeObserver === 'function') new ResizeObserver(updateHeaderHeight).observe(siteHeader);
    window.addEventListener('resize', updateHeaderHeight);
    lastScrollY = window.scrollY || 0;
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // ------------------------------------------------------------------ header: search

  /**
   * @param {boolean} open
   * @param {boolean} [moveFocus]   default true: into the field on open, back to the magnifier on close.
   */
  function setSearchOpen(open, moveFocus) {
    searchForm.hidden = !open;
    searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    var label = t(open ? 'closeSearch' : 'search');
    searchToggle.setAttribute('aria-label', label);
    searchToggle.title = label;
    document.body.classList.toggle('search-open', open);
    if (open) {
      setHeaderHidden(false);
      if (moveFocus !== false) focusOn(searchInput, true);
    } else if (moveFocus !== false && (document.activeElement === searchInput || isHiddenAway(document.activeElement))) {
      focusOn(searchToggle, true);
    }
  }

  function applySearch() {
    var words = searchInput.value.trim().slice(0, 200);
    if (words === state.q) return;
    state.q = words;
    refresh(true);
  }

  // ------------------------------------------------------------------ header: location picker

  var locMenuController = createMenu(locButton, locMenu);

  /**
   * One row of the location menu or the language list.
   * @param {string} value
   * @param {string} label
   * @param {(value: string) => void} choose
   * @returns {HTMLElement}
   */
  function makeMenuItem(value, label, choose) {
    var item = cloneTemplate('tpl-menu-item');
    item.setAttribute('data-value', value);
    find(item, '.menu-item-label').textContent = label;
    item.addEventListener('click', function () { choose(value); });
    return item;
  }

  /**
   * Put the check on the row whose data-value is `current` and take it off the others.
   * @param {HTMLElement} list
   * @param {string} current
   */
  function markCurrentItem(list, current) {
    var items = list.querySelectorAll('.menu-item');
    for (var i = 0; i < items.length; i += 1) {
      var item = /** @type {HTMLElement} */ (items[i]);
      var check = find(item, '.menu-item-check');
      clear(check);
      if ((item.getAttribute('data-value') || '') === current) {
        item.setAttribute('aria-current', 'true');
        check.appendChild(cloneTemplate('tpl-check-icon'));
      } else {
        item.removeAttribute('aria-current');
      }
    }
  }

  function buildLocMenu() {
    clear(locMenu);
    locMenu.appendChild(makeMenuItem('', t('world'), chooseLocation));
    namedCodes(DATA.countries, 'region').forEach(function (entry) {
      locMenu.appendChild(makeMenuItem(entry.code, entry.label, chooseLocation));
    });
    syncLocMenu();
  }

  function syncLocMenu() {
    markCurrentItem(locMenu, state.loc);
    locLabel.textContent = state.loc ? displayName('region', state.loc) : t('world');
  }

  /** @param {string} code */
  function chooseLocation(code) {
    locMenuController.close(true);
    var next = code && DATA.countries.indexOf(code) >= 0 ? code : '';
    if (next === state.loc) return;
    state.loc = next;
    syncLocMenu();
    refresh(true);
  }

  // ------------------------------------------------------------------ header: article/video toggle

  function syncTypeButton() {
    typeButton.setAttribute('data-type', state.type);
    var src = typeGlyph.getAttribute('data-src-' + state.type);
    if (src) typeGlyph.setAttribute('src', src);
    var label = t(TYPE_LABELS[state.type]);
    typeButton.title = label;
    typeLabel.textContent = label;
  }

  function cycleType() {
    state.type = H.cycleTypeValue(state.type);
    syncTypeButton();
    refresh(true);
  }

  // ------------------------------------------------------------------ header: avatar menu

  var avatarMenuController = createMenu(avatarButton, avatarMenu, {
    onClose: function () { setLangListOpen(false); },
  });

  /** @param {boolean} open */
  function setLangListOpen(open) {
    langList.hidden = !open;
    langButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function buildLangList() {
    clear(langList);
    langList.appendChild(makeMenuItem('', t('allLanguages'), chooseLanguage));
    namedCodes(DATA.languages, 'language').forEach(function (entry) {
      langList.appendChild(makeMenuItem(entry.code, entry.label, chooseLanguage));
    });
    syncLangList();
  }

  function syncLangList() {
    markCurrentItem(langList, state.lang);
    langCurrent.textContent = state.lang ? displayName('language', state.lang) : t('all');
  }

  /** @param {string} code */
  function chooseLanguage(code) {
    avatarMenuController.close(true);
    var next = code && DATA.languages.indexOf(code) >= 0 ? code : '';
    if (next === state.lang) return;
    state.lang = next;
    syncLangList();
    refresh(true);
  }

  /** The theme row reads "Dark Mode" with a moon on a light page and "Light Mode" with a sun on a dark one. */
  function syncThemeToggle() {
    var dark = effectiveDark();
    themeToggle.classList.toggle('is-dark', dark);
    themeToggleLabel.textContent = t(dark ? 'lightMode' : 'darkMode');
  }

  function toggleTheme() {
    settings.theme = effectiveDark() ? 'light' : 'dark';
    applyTheme();
    saveSettings();
    avatarMenuController.close(true);
  }

  /**
   * An in-page link (avatar menu rows and footer, Menu panel cells, back links, the logo): the
   * click handler opens the view; the #href stays as a fallback without scripts.
   * @param {Element} link
   * @returns {View|null}
   */
  function viewFromLink(link) {
    var href = link.getAttribute('href') || '';
    return href.charAt(0) === '#' ? viewFromToken(href.slice(1)) : null;
  }

  /**
   * @param {View} next
   */
  function openViewFromMenu(next) {
    if (next === 'following' && followingIds.length === 0) next = 'manage';
    if (next === 'feed') { state.c = ''; state.s = ''; }
    goToView(next);
    // Sources, About and Manage focus their heading; a feed view starts at the top of the page.
    if (FEED_VIEWS[next]) focusOn(mainEl, true);
  }

  /**
   * @param {Event} event
   * @param {Element} link
   */
  function onMenuLinkClick(event, link) {
    var next = viewFromLink(link);
    if (!next) return;
    event.preventDefault();
    if (avatarMenuController.isOpen()) avatarMenuController.close(false);
    if (menuPanel.hidden === false) closeMenuPanel(false);
    openViewFromMenu(next);
  }

  // ------------------------------------------------------------------ header: category tabs

  /**
   * @param {string} id
   * @param {string} label
   * @param {boolean} pressed
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function makeTab(id, label, pressed, onClick) {
    var tab = button('tab', label);
    tab.setAttribute('data-id', id);
    tab.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    tab.addEventListener('click', onClick);
    return tab;
  }

  /** @returns {string|null} the data-id of the tab that reads as selected, or null for none. */
  function activeTabId() {
    if (view === 'feed') return state.c;
    if (view === 'saved' || view === 'following' || view === 'manage') return '';
    return null;
  }

  function renderTabs() {
    clear(tabsTrack);
    var active = activeTabId();
    tabsTrack.appendChild(makeTab('', t('home'), active === '', goHome));
    DATA.categories.forEach(function (category) {
      tabsTrack.appendChild(makeTab(category.id, nameOf(category), active === category.id, function () { selectCategory(category.id); }));
    });
  }

  function markActiveTab() {
    var active = activeTabId();
    var tabs = tabsTrack.querySelectorAll('.tab');
    /** @type {HTMLElement|null} */
    var activeTab = null;
    for (var i = 0; i < tabs.length; i += 1) {
      var tab = /** @type {HTMLElement} */ (tabs[i]);
      var pressed = active !== null && (tab.getAttribute('data-id') || '') === active;
      tab.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (pressed) activeTab = tab;
    }
    revealTab(activeTab);
  }

  /**
   * Scroll the track sideways so the active tab is fully in view (the live site leaves it cut
   * off). Never scrolls the page.
   * @param {HTMLElement|null} tab
   */
  function revealTab(tab) {
    if (!tab) return;
    var trackRect = tabsTrack.getBoundingClientRect();
    var tabRect = tab.getBoundingClientRect();
    if (trackRect.width === 0) return;
    if (tabRect.left >= trackRect.left && tabRect.right <= trackRect.right) return;
    var left = tabRect.left - trackRect.left + tabsTrack.scrollLeft - (trackRect.width - tabRect.width) / 2;
    var target = Math.max(0, left);
    try {
      tabsTrack.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      tabsTrack.scrollLeft = target;
    }
  }

  /** Mouse drag-to-scroll on the tabs track (touch and wheel scroll natively); the click that ends a drag is dropped. */
  function setupDragScroll() {
    var dragging = false;
    var moved = false;
    var startX = 0;
    var startLeft = 0;
    var suppressClick = false;
    tabsTrack.addEventListener('mousedown', function (event) {
      if (event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startLeft = tabsTrack.scrollLeft;
    });
    document.addEventListener('mousemove', function (event) {
      if (!dragging) return;
      var dx = event.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      moved = true;
      tabsTrack.scrollLeft = startLeft - dx;
      event.preventDefault();
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      suppressClick = true;
      window.setTimeout(function () { suppressClick = false; }, 0);
    });
    tabsTrack.addEventListener('click', function (event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  // ------------------------------------------------------------------ header: the grey row

  /**
   * @param {string} id
   * @param {string} label
   * @param {boolean} pressed
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function makeSectionLink(id, label, pressed, onClick) {
    var link = button('section-link', label);
    link.setAttribute('data-id', id);
    link.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    link.addEventListener('click', onClick);
    return link;
  }

  /**
   * The grey row depends on the view: All · Saved · Following (· Manage) on Home, All + the
   * subcategories on a category, All · News · Sports · Music in Live, nothing elsewhere.
   */
  function renderSections() {
    clear(sectionsRow);
    var show = true;
    var subcats = false;
    var category = view === 'feed' && state.c ? CATEGORIES[state.c] : null;
    if (category) {
      subcats = true;
      sectionsRow.appendChild(makeSectionLink('', t('all'), state.s === '', function () { selectSubcategory(''); }));
      (category.subcategories || []).forEach(function (sub) {
        sectionsRow.appendChild(makeSectionLink(sub.id, nameOf(sub), state.s === sub.id, function () { selectSubcategory(sub.id); }));
      });
    } else if (view === 'feed' || view === 'saved' || view === 'following') {
      sectionsRow.appendChild(makeSectionLink('', t('all'), view === 'feed', goHome));
      sectionsRow.appendChild(makeSectionLink('saved', t('savedTab'), view === 'saved', function () { goToView('saved'); }));
      sectionsRow.appendChild(makeSectionLink('following', t('followingTab'), view === 'following', function () { goToView('following'); }));
      if (view === 'following') {
        var manage = button('section-link section-manage');
        manage.setAttribute('data-id', 'manage');
        manage.appendChild(cloneTemplate('tpl-gear-icon'));
        manage.appendChild(el('span', 'section-label', t('manage')));
        manage.addEventListener('click', function () { goToView('manage'); });
        sectionsRow.appendChild(manage);
      }
    } else if (view === 'live') {
      sectionsRow.appendChild(makeSectionLink('', t('all'), state.s === '', function () { selectLiveSection(''); }));
      LIVE_SECTIONS.forEach(function (section) {
        sectionsRow.appendChild(makeSectionLink(section, t(LIVE_LABELS[section]), state.s === section, function () { selectLiveSection(section); }));
      });
    } else {
      show = false;
    }
    subbar.hidden = !show;
    subbar.classList.toggle('is-subcats', subcats);
  }

  /** @param {string} activeId */
  function markActiveSection(activeId) {
    var links = sectionsRow.querySelectorAll('.section-link');
    for (var i = 0; i < links.length; i += 1) {
      var link = /** @type {HTMLElement} */ (links[i]);
      if (!link.hasAttribute('aria-pressed')) continue;
      link.setAttribute('aria-pressed', (link.getAttribute('data-id') || '') === activeId ? 'true' : 'false');
    }
  }

  /** @param {string} categoryId */
  function selectCategory(categoryId) {
    var changed = view !== 'feed' || state.c !== categoryId || state.s !== '';
    state.c = CATEGORIES[categoryId] ? categoryId : '';
    state.s = '';
    showView('feed', false);
    if (changed) refresh(true);
  }

  /** @param {string} subcategoryId */
  function selectSubcategory(subcategoryId) {
    var changed = state.s !== subcategoryId;
    state.s = subcategoryOf(state.c, subcategoryId) ? subcategoryId : '';
    markActiveSection(state.s);
    if (changed) refresh(true);
  }

  /** @param {string} section */
  function selectLiveSection(section) {
    var changed = state.s !== section;
    state.s = LIVE_SECTIONS.indexOf(section) >= 0 ? section : '';
    markActiveSection(state.s);
    if (changed) refresh(true);
  }

  // ------------------------------------------------------------------ the Menu panel (≡)

  function buildMenuPanel() {
    clear(panelCategories);
    DATA.categories.forEach(function (category) {
      var cell = button('cell', nameOf(category));
      cell.setAttribute('data-id', category.id);
      cell.addEventListener('click', function () {
        closeMenuPanel(false);
        selectCategory(category.id);
        focusOn(mainEl, true);
      });
      panelCategories.appendChild(cell);
    });
  }

  function openMenuPanel() {
    if (openMenu) openMenu.close(false);
    menuPanel.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    menuButton.setAttribute('aria-label', t('closeMenu'));
    menuButton.title = t('closeMenu');
    document.body.classList.add('menu-open');
    document.documentElement.classList.add('menu-open');
    document.documentElement.style.overflow = 'hidden';
    setHeaderHidden(false);
    focusOn(menuPanelHeading, true);
  }

  /** @param {boolean} returnFocus   false when a choice is taking the visitor to a view. */
  function closeMenuPanel(returnFocus) {
    if (menuPanel.hidden) return;
    menuPanel.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', t('menu'));
    menuButton.title = t('menu');
    document.body.classList.remove('menu-open');
    document.documentElement.classList.remove('menu-open');
    document.documentElement.style.overflow = '';
    if (returnFocus) focusOn(menuButton, true);
  }

  /** Tab wraps inside the panel while it is open (it covers everything but the blue bar). */
  function onMenuPanelKeydown(event) {
    if (event.key !== 'Tab') return;
    var items = focusableIn(menuPanel);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    if (event.shiftKey && (active === first || active === menuPanelHeading)) {
      event.preventDefault();
      focusOn(last, true);
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      focusOn(first, true);
    }
  }

  // ------------------------------------------------------------------ saved + following

  /**
   * @param {string} id
   * @returns {boolean}
   */
  function isSaved(id) {
    return savedIds.indexOf(id) >= 0;
  }

  /**
   * @param {string} id
   * @returns {boolean} the new state.
   */
  function toggleSaved(id) {
    var index = savedIds.indexOf(id);
    if (index >= 0) savedIds.splice(index, 1);
    else savedIds.unshift(id);
    writeStorage(SAVED_KEY, savedIds);
    return index < 0;
  }

  /** @type {Record<string, boolean>} */
  var followingSet = Object.create(null);
  function rebuildFollowingSet() {
    followingSet = Object.create(null);
    followingIds.forEach(function (id) { followingSet[id] = true; });
  }
  rebuildFollowingSet();

  // ------------------------------------------------------------------ toasts

  /**
   * A toast slides in at the bottom right (top on phones), goes away after 5 s or when its X is
   * pressed; at most two are shown at a time. The region is aria-live, so it announces itself.
   * @param {string} title
   * @param {string} [description]
   */
  function showToast(title, description) {
    var toast = cloneTemplate('tpl-toast');
    find(toast, '.toast-title').textContent = title;
    var desc = find(toast, '.toast-desc');
    if (description) desc.textContent = description;
    else if (desc.parentNode) desc.parentNode.removeChild(desc);
    var removed = false;
    var remove = function () {
      if (removed) return;
      removed = true;
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    };
    var timer = window.setTimeout(dismiss, TOAST_MS);
    function dismiss() {
      window.clearTimeout(timer);
      if (removed || !toast.parentNode) return;
      if (prefersReducedMotion()) { remove(); return; }
      toast.classList.add('is-leaving');
      window.setTimeout(remove, TOAST_LEAVE_MS);
    }
    find(toast, '.toast-close').addEventListener('click', function () {
      var hadFocus = document.activeElement && toast.contains(document.activeElement);
      dismiss();
      if (hadFocus) focusOn(mainEl, true);
    });
    while (toastRegion.children.length >= MAX_TOASTS && toastRegion.firstElementChild) {
      toastRegion.removeChild(toastRegion.firstElementChild);
    }
    toastRegion.appendChild(toast);
  }

  // ------------------------------------------------------------------ items

  /**
   * @param {FeedSource} source
   * @param {string} section
   * @returns {boolean}
   */
  function inLiveSection(source, section) {
    if (!section) return true;
    if (section === 'news') return source.category === 'local' || source.category === 'world';
    if (section === 'sports') return source.category === 'sports';
    if (section === 'music') return HAS_MUSIC_SUBCATEGORY ? source.subcategory === 'music' : source.category === 'entertainment';
    return false;
  }

  /**
   * @param {FeedItem} item
   * @returns {boolean}
   */
  function matches(item) {
    var source = SOURCES[item.s];
    if (!source) return false;
    if (view === 'live') {
      if (item.ty !== 'v') return false;
      if (!inLiveSection(source, state.s)) return false;
    } else {
      if (view === 'feed' && state.c && source.category !== state.c) return false;
      if (view === 'feed' && state.s && source.subcategory !== state.s) return false;
      if (view === 'following' && !followingSet[sectionKey(source)]) return false;
      if (state.type === 'articles' && item.ty !== 'a') return false;
      if (state.type === 'videos' && item.ty !== 'v') return false;
    }
    if (state.lang && source.language !== state.lang) return false;
    if (state.loc && source.country !== state.loc) return false;
    var haystack = item._search || '';
    for (var i = 0; i < searchWords.length; i += 1) {
      if (haystack.indexOf(searchWords[i]) === -1) return false;
    }
    return true;
  }

  /**
   * @param {FeedItem} item
   * @returns {string}
   */
  function watchUrl(item) {
    return item.v ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(item.v) : item.l;
  }

  /**
   * The address shared for an item: the original article, or the YouTube watch page of a video.
   * @param {FeedItem} item
   * @returns {string}
   */
  function shareUrl(item) {
    return item.ty === 'v' ? watchUrl(item) : item.l;
  }

  /**
   * The address of an item's thumbnail: a URL, an embedded data URI, or (in the preview) an index
   * into DATA.images when one picture is shared by several items.
   * @param {FeedItem} item
   * @returns {string}
   */
  function thumbSrc(item) {
    if (typeof item.th === 'number') return (DATA.images && DATA.images[item.th]) || '';
    return typeof item.th === 'string' ? item.th : '';
  }

  /**
   * The five share addresses, each carrying the item's original link and title.
   * @param {string} url
   * @param {string} title
   * @returns {Record<string, string>}
   */
  function shareLinks(url, title) {
    var u = encodeURIComponent(url);
    var text = encodeURIComponent(title);
    return {
      facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u,
      twitter: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + text,
      linkedin: 'https://www.linkedin.com/shareArticle?mini=true&url=' + u + '&title=' + text,
      whatsapp: 'https://wa.me/?text=' + text + '%20' + u,
      telegram: 'https://t.me/share/url?url=' + u + '&text=' + text,
    };
  }

  /**
   * Copy through the asynchronous clipboard when the browser has it, otherwise through a hidden
   * text area and execCommand.
   * @param {string} text
   * @param {(ok: boolean) => void} done
   */
  function copyText(text, done) {
    var fallback = function () {
      var ok;
      try {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.setAttribute('aria-hidden', 'true');
        area.style.position = 'fixed';
        area.style.top = '0';
        area.style.left = '0';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        ok = document.execCommand('copy');
        document.body.removeChild(area);
      } catch (e) {
        ok = false;
      }
      done(ok);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        return;
      } catch (e) {
        // Some embeddings throw instead of rejecting; try the text area.
      }
    }
    fallback();
  }

  /**
   * The share menu of one item, built on first use inside .share-wrap: Copy Link and the five
   * services as plain links to their share addresses with the original link and title.
   * @param {HTMLElement} wrap
   * @param {HTMLElement} shareButton
   * @param {FeedItem} item
   * @returns {Menu}
   */
  function createShareMenu(wrap, shareButton, item) {
    var menu = cloneTemplate('tpl-share-menu');
    menu.hidden = true;
    var url = shareUrl(item);
    var links = shareLinks(url, item.t);
    for (var service in links) {
      var link = /** @type {HTMLAnchorElement} */ (find(menu, '.share-' + service));
      link.href = links[service];
    }
    wrap.appendChild(menu);
    var controller = createMenu(shareButton, menu);
    find(menu, '.share-copy').addEventListener('click', function () {
      controller.close(true);
      copyText(url, function (ok) {
        if (ok) showToast(t('linkCopied'), t('linkCopiedDesc'));
        else showToast(t('shareFailed'));
        actionStatus.textContent = t(ok ? 'linkCopied' : 'shareFailed');
        if (document.activeElement === document.body) focusOn(shareButton, true);
      });
    });
    menu.addEventListener('click', function (event) {
      var target = /** @type {Element|null} */ (event.target instanceof Element ? event.target : null);
      if (target && target.closest('a.menu-item')) controller.close(true);
    });
    return controller;
  }

  /**
   * @param {HTMLElement} save
   * @param {boolean} saved
   */
  function paintSaveButton(save, saved) {
    save.setAttribute('aria-pressed', saved ? 'true' : 'false');
    save.classList.toggle('is-saved', saved);
    find(save, '.action-label').textContent = t(saved ? 'savedItem' : 'saveItem');
  }

  /**
   * Save, Share and the heart (disabled until accounts exist).
   * @param {HTMLElement} card
   * @param {FeedItem} item
   */
  function fillActions(card, item) {
    var slot = find(card, '.actions');
    var actions = cloneTemplate('tpl-actions');
    var save = find(actions, '.action-save');
    paintSaveButton(save, isSaved(item.id));
    save.addEventListener('click', function () {
      var saved = toggleSaved(item.id);
      paintSaveButton(save, saved);
      storageHint.hidden = storageOk || !(view === 'saved' || view === 'following');
      if (saved) showToast(t('savedToast'), t('savedToastDesc'));
      else showToast(t('removedToast'));
      actionStatus.textContent = t(saved ? 'savedToast' : 'removedToast');
      if (view === 'saved' && !saved) {
        // Unsaving inside the Saved list removes the item from it. Focus was on the Save button
        // being removed, so it moves to the next item's title (or the feed itself).
        /** @type {Element|null} */
        var nextFocus = null;
        if (card.parentNode) {
          var neighbour = card.nextElementSibling || card.previousElementSibling;
          nextFocus = neighbour ? neighbour.querySelector('.item-link') : null;
          card.parentNode.removeChild(card);
        }
        filtered = filtered.filter(function (entry) { return entry.id !== item.id; });
        shown = Math.max(0, shown - 1);
        emptyState.hidden = filtered.length > 0;
        updateEmptyState();
        updateFeedEnd();
        announceCount();
        focusOn(/** @type {HTMLElement} */ (nextFocus || mainEl), true);
      }
    });

    var wrap = find(actions, '.share-wrap');
    var share = find(actions, '.action-share');
    /** @type {Menu|null} */
    var shareMenu = null;
    share.addEventListener('click', function () {
      if (shareMenu) return; // the controller's own click handler toggles it from now on
      shareMenu = createShareMenu(wrap, share, item);
      shareMenu.open();
    });

    var like = find(actions, '.action-like');
    like.addEventListener('click', function () { showToast(t('likesLater')); });

    if (slot.parentNode) slot.parentNode.replaceChild(actions, slot);
  }

  /**
   * @param {FeedItem} item
   * @param {FeedSource} source
   * @param {number} nowMs
   * @returns {HTMLElement}
   */
  function renderArticle(item, source, nowMs) {
    var card = cloneTemplate('tpl-article');
    var link = /** @type {HTMLAnchorElement} */ (find(card, '.item-link'));
    link.href = item.l;
    find(card, '.publisher-name').textContent = source.name;
    find(card, '.item-title-text').textContent = item.t;
    fillTime(find(card, '.item-time'), item.p, nowMs);
    var thumb = find(card, '.item-thumb');
    var img = /** @type {HTMLImageElement} */ (find(card, '.item-img'));
    var removeThumb = function () {
      card.classList.add('no-thumb');
      if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
    };
    var src = thumbSrc(item);
    if (src) {
      img.addEventListener('error', removeThumb);
      img.src = src;
    } else {
      removeThumb();
    }
    fillActions(card, item);
    return card;
  }

  /**
   * The preview picture and the red play button inside the element that reacts to the click (a
   * button on the hosted site, a link in the preview). Without a picture the box stays black.
   * @param {HTMLElement} box
   * @param {HTMLElement} control
   * @param {FeedItem} item
   */
  function fillPreview(box, control, item) {
    var src = thumbSrc(item);
    if (src) {
      var img = document.createElement('img');
      img.className = 'video-img';
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        box.classList.add('no-thumb');
      });
      img.src = src;
      control.appendChild(img);
    } else {
      box.classList.add('no-thumb');
    }
    control.appendChild(cloneTemplate('tpl-play-button'));
  }

  /**
   * One click replaces the preview with the privacy-enhanced YouTube player (hosted site only).
   * @param {HTMLElement} box
   * @param {FeedItem} item
   */
  function embedPlayer(box, item) {
    if (!item.v) return;
    var frame = document.createElement('iframe');
    frame.className = 'video-frame';
    frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.v) + '?autoplay=1';
    frame.title = t('videoPlayer', { title: item.t });
    frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    box.classList.remove('no-thumb');
    box.classList.add('is-playing');
    clear(box);
    box.appendChild(frame);
    focusOn(frame, true);
  }

  /**
   * @param {FeedItem} item
   * @param {FeedSource} source
   * @param {number} nowMs
   * @returns {HTMLElement}
   */
  function renderVideo(item, source, nowMs) {
    var card = cloneTemplate('tpl-video');
    var link = /** @type {HTMLAnchorElement} */ (find(card, '.item-link'));
    link.href = watchUrl(item);
    find(card, '.publisher-name').textContent = source.name;
    find(card, '.item-title-text').textContent = item.t;
    fillTime(find(card, '.item-time'), item.p, nowMs);
    var box = find(card, '.video-box');
    if (CONFIG.video === 'embed' && item.v) {
      var play = button('video-preview');
      play.setAttribute('aria-label', t('playVideo', { title: item.t }));
      play.addEventListener('click', function () { embedPlayer(box, item); });
      fillPreview(box, play, item);
      box.appendChild(play);
    } else {
      var anchor = document.createElement('a');
      anchor.className = 'video-preview';
      anchor.href = watchUrl(item);
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.setAttribute('aria-describedby', 'new-tab-hint');
      anchor.setAttribute('aria-label', t('watchOnYouTubeTitle', { title: item.t }));
      fillPreview(box, anchor, item);
      box.appendChild(anchor);
    }
    fillActions(card, item);
    return card;
  }

  /**
   * @param {FeedItem} item
   * @param {number} nowMs
   * @returns {HTMLElement}
   */
  function renderItem(item, nowMs) {
    var source = SOURCES[item.s];
    return item.ty === 'v' ? renderVideo(item, source, nowMs) : renderArticle(item, source, nowMs);
  }

  // ------------------------------------------------------------------ feed

  /** @type {FeedItem[]} */
  var filtered = [];
  var shown = 0;
  /** @type {IntersectionObserver|null} */
  var observer = null;

  function announceCount() {
    var n = filtered.length;
    resultCount.textContent = n === 1 ? t('resultsOne') : t('resultsMany', { n: formatNumber(n) });
  }

  /** "You've reached the end." once every item of a non-empty list is on the page. */
  function updateFeedEnd() {
    feedEnd.hidden = !(filtered.length > 0 && shown >= filtered.length);
  }

  function renderMore() {
    var slice = filtered.slice(shown, shown + PAGE_SIZE);
    if (slice.length) {
      var fragment = document.createDocumentFragment();
      var nowMs = Date.now();
      slice.forEach(function (item) { fragment.appendChild(renderItem(item, nowMs)); });
      feedList.appendChild(fragment);
      shown += slice.length;
    }
    var more = shown < filtered.length;
    showMore.hidden = !more || Boolean(observer);
    updateFeedEnd();
    if (more && observer) window.requestAnimationFrame(fillIfSentinelVisible);
  }

  /** Keep loading while the sentinel is still on screen (tall screens, few items per page). */
  function fillIfSentinelVisible() {
    if (!FEED_VIEWS[view] || shown >= filtered.length) return;
    var rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 400) renderMore();
  }

  /** @returns {FeedItem[]} the items of the current view, in the order they are shown. */
  function collectItems() {
    if (view === 'saved') {
      /** @type {FeedItem[]} */
      var out = [];
      savedIds.forEach(function (id) {
        var item = ITEM_BY_ID[id];
        if (item && matches(item)) out.push(item);
      });
      return out;
    }
    return ITEMS.filter(matches);
  }

  /** The empty message depends on why the list is empty. */
  function updateEmptyState() {
    var listEmpty = (view === 'saved' && savedIds.length === 0) || (view === 'following' && followingIds.length === 0);
    var key = 'nothingHere';
    if (view === 'saved' && listEmpty) key = 'nothingSaved';
    else if (view === 'following' && listEmpty) key = 'notFollowing';
    else if (searchWords.length) key = 'noResults';
    emptyText.textContent = t(key);
    clearButton.hidden = listEmpty;
    manageFollowingButton.hidden = !(view === 'following' && listEmpty);
  }

  /**
   * Recompute the list from the current view and filters and render the first page.
   * @param {boolean} [scrollUp]   true when the visitor changed a filter.
   */
  function refresh(scrollUp) {
    searchWords = fold(state.q).split(/\s+/).filter(Boolean);
    filtered = FEED_VIEWS[view] ? collectItems() : [];
    shown = 0;
    clear(feedList);
    emptyState.hidden = filtered.length > 0;
    updateEmptyState();
    storageHint.hidden = storageOk || !(view === 'saved' || view === 'following');
    renderMore();
    announceCount();
    writeUrlState();
    if (scrollUp) scrollToTop();
  }

  function clearFilters() {
    state.c = '';
    state.s = '';
    state.lang = '';
    state.loc = '';
    state.type = 'both';
    state.q = '';
    syncControls();
    markActiveTab();
    renderSections();
    setFeedHeading();
    refresh(true);
    // The button that was pressed disappears with the empty message; keep focus in the page.
    if (emptyState.hidden) focusOn(mainEl, true);
  }

  function setupInfiniteScroll() {
    if (typeof IntersectionObserver !== 'function') {
      showMore.addEventListener('click', renderMore);
      return;
    }
    observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i += 1) {
        if (entries[i].isIntersecting) { renderMore(); return; }
      }
    }, { rootMargin: '800px 0px' });
    observer.observe(sentinel);
    showMore.addEventListener('click', renderMore);
  }

  // ------------------------------------------------------------------ manage following

  /** The edits in progress: "category/subcategory" → true. Discarded by Cancel. */
  /** @type {Record<string, boolean>} */
  var draft = Object.create(null);
  /** @type {ManageRow[]} */
  var manageRows = [];
  var manageShowOnlyFollowing = false;

  /** @returns {number} */
  function draftCount() {
    var n = 0;
    for (var key in draft) if (draft[key]) n += 1;
    return n;
  }

  function updateManageCounts() {
    manageShowFollowing.textContent = t('followingCount', { n: formatNumber(draftCount()) });
    manageRows.forEach(function (row) {
      var n = 0;
      row.boxes.forEach(function (box) { if (draft[box.input.value]) n += 1; });
      row.badge.textContent = formatNumber(n);
      row.badgeText.textContent = t('followedInCategory', { n: formatNumber(n) });
    });
  }

  /**
   * @param {ManageRow} row
   * @param {boolean} open
   */
  function setRowOpen(row, open) {
    row.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    row.body.hidden = !open;
    row.row.classList.toggle('is-open', open);
  }

  /** Apply the search words and the All / Following pills to the accordion. */
  function filterManageRows() {
    var query = fold(manageSearch.value.trim());
    var visible = 0;
    manageRows.forEach(function (row) {
      var categoryMatches = !query || fold(nameOf(row.category)).indexOf(query) >= 0;
      var anyFollowed = false;
      var anySubShown = false;
      row.boxes.forEach(function (box) {
        if (draft[box.input.value]) anyFollowed = true;
        var subMatches = categoryMatches || fold(nameOf(box.sub)).indexOf(query) >= 0;
        box.label.hidden = !subMatches;
        if (subMatches) anySubShown = true;
      });
      var show = (categoryMatches || anySubShown) && (!manageShowOnlyFollowing || anyFollowed);
      row.row.hidden = !show;
      if (show) visible += 1;
      if (show && query && !categoryMatches) setRowOpen(row, true);
    });
    manageEmpty.hidden = visible > 0;
  }

  /**
   * @param {FeedCategory} category
   * @param {number} index
   * @returns {ManageRow}
   */
  function buildManageRow(category, index) {
    var row = cloneTemplate('tpl-acc-row');
    var toggle = find(row, '.acc-button');
    var body = find(row, '.acc-body');
    var bodyId = 'acc-' + String(category.id).replace(/[^a-z0-9_-]/gi, '') + '-' + index;
    body.id = bodyId;
    toggle.setAttribute('aria-controls', bodyId);
    find(row, '.acc-name').textContent = nameOf(category);
    var grid = find(row, '.check-grid');
    /** @type {ManageBox[]} */
    var boxes = [];
    (category.subcategories || []).forEach(function (sub) {
      var label = cloneTemplate('tpl-check-item');
      var input = /** @type {HTMLInputElement} */ (find(label, '.check-input'));
      input.value = category.id + '/' + sub.id;
      input.checked = Boolean(draft[input.value]);
      input.addEventListener('change', function () {
        draft[input.value] = input.checked;
        updateManageCounts();
      });
      find(label, '.check-label').textContent = nameOf(sub);
      grid.appendChild(label);
      boxes.push({ input: input, label: label, sub: sub });
    });
    // Twelve categories mean twelve pairs of these buttons; the accessible name says which one.
    var selectAll = find(row, '.acc-select-all');
    selectAll.setAttribute('aria-label', t('selectAllIn', { category: nameOf(category) }));
    selectAll.addEventListener('click', function () {
      boxes.forEach(function (box) { if (!box.label.hidden) { box.input.checked = true; draft[box.input.value] = true; } });
      updateManageCounts();
    });
    var clearAll = find(row, '.acc-clear');
    clearAll.setAttribute('aria-label', t('clearSelectionIn', { category: nameOf(category) }));
    clearAll.addEventListener('click', function () {
      boxes.forEach(function (box) { if (!box.label.hidden) { box.input.checked = false; draft[box.input.value] = false; } });
      updateManageCounts();
      if (manageShowOnlyFollowing) filterManageRows();
    });
    /** @type {ManageRow} */
    var entry = { category: category, row: row, button: toggle, body: body, badge: find(row, '.acc-badge'), badgeText: find(row, '.acc-badge-text'), boxes: boxes };
    toggle.addEventListener('click', function () { setRowOpen(entry, toggle.getAttribute('aria-expanded') !== 'true'); });
    setRowOpen(entry, index < 2);
    return entry;
  }

  function buildManageList() {
    clear(manageList);
    manageRows = DATA.categories.map(buildManageRow);
    manageRows.forEach(function (entry) { manageList.appendChild(entry.row); });
    updateManageCounts();
    filterManageRows();
  }

  /** @param {boolean} onlyFollowing */
  function setManagePill(onlyFollowing) {
    manageShowOnlyFollowing = onlyFollowing;
    manageShowAll.setAttribute('aria-pressed', onlyFollowing ? 'false' : 'true');
    manageShowFollowing.setAttribute('aria-pressed', onlyFollowing ? 'true' : 'false');
  }

  function openManage() {
    draft = Object.create(null);
    followingIds.forEach(function (id) { draft[id] = true; });
    setManagePill(false);
    manageSearch.value = '';
    buildManageList();
  }

  function saveManage() {
    followingIds = [];
    DATA.categories.forEach(function (category) {
      (category.subcategories || []).forEach(function (sub) {
        var key = category.id + '/' + sub.id;
        if (draft[key]) followingIds.push(key);
      });
    });
    writeStorage(FOLLOWING_KEY, followingIds);
    rebuildFollowingSet();
    goToView('following');
    focusOn(mainEl, true);
  }

  // ------------------------------------------------------------------ sources + about

  /**
   * @param {string} label
   * @param {Node|string} content
   * @returns {HTMLTableCellElement}
   */
  function cell(label, content) {
    var td = document.createElement('td');
    td.setAttribute('data-label', label);
    if (typeof content === 'string') td.textContent = content;
    else td.appendChild(content);
    return td;
  }

  function renderSources() {
    clear(sourcesBody);
    var nowMs = Date.now();
    DATA.sources.forEach(function (source) {
      var row = document.createElement('tr');

      var nameLink = document.createElement('a');
      nameLink.className = 'source-name';
      nameLink.href = source.siteUrl || source.url;
      nameLink.target = '_blank';
      nameLink.rel = 'noopener';
      nameLink.setAttribute('aria-describedby', 'new-tab-hint');
      nameLink.textContent = source.name;
      row.appendChild(cell(t('colName'), nameLink));

      row.appendChild(cell(t('colType'), t(source.type === 'youtube_channel' ? 'typeYoutubeChannel' : 'typeFeed')));

      var category = CATEGORIES[source.category];
      var categoryText = category ? nameOf(category) : source.category;
      var subcategory = subcategoryOf(source.category, source.subcategory);
      if (subcategory) categoryText += ' › ' + nameOf(subcategory);
      else if (source.subcategory) categoryText += ' › ' + source.subcategory;
      row.appendChild(cell(t('colCategory'), categoryText));

      row.appendChild(cell(t('colCountry'), displayName('region', source.country || '')));
      row.appendChild(cell(t('colLanguage'), displayName('language', source.language || '')));

      var status = document.createElement('span');
      status.className = 'status status-' + String(source.status || '').replace(/[^a-z_]/g, '');
      status.textContent = t(STATUS_LABELS[source.status] || 'statusPaused');
      row.appendChild(cell(t('colStatus'), status));

      if (source.lastSuccess) {
        var time = document.createElement('time');
        fillTime(time, source.lastSuccess, nowMs);
        row.appendChild(cell(t('colLastFetch'), time));
      } else {
        row.appendChild(cell(t('colLastFetch'), t('never')));
      }
      sourcesBody.appendChild(row);
    });
    sourcesEmpty.hidden = DATA.sources.length > 0;
  }

  function renderAbout() {
    var when = DATA.generatedAt ? formatAbsolute(DATA.generatedAt) : '';
    generatedAt.textContent = when ? t('generatedAt', { date: when }) : '';
    generatedAt.hidden = !when;
  }

  // ------------------------------------------------------------------ views

  /**
   * The feed's heading (hidden, but it names the landmark and the h1 for screen readers)
   * follows the open view: Latest items, the category, Saved, Following or Live.
   */
  function setFeedHeading() {
    var text;
    if (view === 'saved') text = t('savedTab');
    else if (view === 'following' || view === 'manage') text = t('followingTab');
    else if (view === 'live') text = t('live');
    else text = state.c && CATEGORIES[state.c] ? nameOf(CATEGORIES[state.c]) : t('feedHeading');
    feedHeading.textContent = text;
  }

  /**
   * Show one view: toggles the sections and the bars, marks the tabs and the grey row.
   * @param {View} next
   * @param {boolean} moveFocus   true to put focus on the view's heading; otherwise focus only
   *                              moves (to the feed) when the element that had it is now hidden,
   *                              so the keyboard never falls back to the top of the page.
   */
  function showView(next, moveFocus) {
    view = next;
    var feedVisible = Boolean(FEED_VIEWS[next]);
    var hadFocus = document.activeElement;
    document.body.setAttribute('data-view', next);
    feedSection.hidden = !feedVisible;
    manageSection.hidden = next !== 'manage';
    sourcesSection.hidden = next !== 'sources';
    aboutSection.hidden = next !== 'about';
    typeButton.hidden = next === 'live';
    setFeedHeading();
    if (next === 'sources') renderSources();
    if (next === 'about') renderAbout();
    if (next === 'manage') openManage();
    markActiveTab();
    renderSections();
    if (moveFocus) {
      var heading = next === 'sources' ? sourcesHeading : next === 'about' ? aboutHeading : next === 'manage' ? manageHeading : mainEl;
      focusOn(heading, true);
      window.scrollTo(0, 0);
    } else if (hadFocus && hadFocus !== document.body && isHiddenAway(hadFocus)) {
      focusOn(mainEl, true);
    }
    if (feedVisible && observer) window.requestAnimationFrame(fillIfSentinelVisible);
  }

  /**
   * Switch to a view from a grey-row link, a button or a menu link, and refresh the feed.
   * @param {View} next
   */
  function goToView(next) {
    if (next !== 'feed') { state.c = ''; }
    if (next !== 'live' && next !== 'feed') state.s = '';
    // Entering Live always opens on All: a feed subcategory id such as "news" must not leak in
    // as a Live section. Section links inside Live keep their choice.
    if (next === 'live' && view !== 'live') state.s = '';
    showView(next, next === 'manage' || next === 'sources' || next === 'about');
    refresh(true);
  }

  /** Home: the whole feed, no category. */
  function goHome() {
    selectCategory('');
    scrollToTop();
  }

  /** "Back to the feed" from Sources or About. */
  function backToFeed() {
    state.c = '';
    state.s = '';
    goToView('feed');
  }

  /** A #hash arrived from the address bar (the in-page links are handled by their click handlers). */
  function onHashChange() {
    var next = viewFromHash();
    if (!next) return;
    if (next === 'feed') {
      state.c = '';
      state.s = '';
    }
    goToView(next);
    if (CONFIG.urlState) writeUrlState();
  }

  /**
   * The browser's Back/Forward on the hosted site: rebuild the state from the address. A fragment
   * navigation (#about typed into the address bar) fires popstate first; it belongs to the hash
   * handler, which also writes the canonical ?view= address.
   */
  function onPopState() {
    if (viewFromHash()) {
      onHashChange();
      return;
    }
    state = { c: '', s: '', lang: '', loc: '', type: 'both', q: '' };
    view = 'feed';
    readUrlState();
    syncControls();
    showView(view, false);
    refresh(false);
  }

  /** The header controls follow the state: location label, language hint, toggle glyph, search words. */
  function syncControls() {
    syncLocMenu();
    syncLangList();
    syncTypeButton();
    searchInput.value = state.q;
    if (state.q && searchForm.hidden) setSearchOpen(true, false);
  }

  // ------------------------------------------------------------------ settings dialog

  var supportsDialog = typeof dialog.showModal === 'function';

  function openDialog() {
    /** @type {{lang?: string, loc?: string}} */
    var prefs = loadPrefs() || {};
    prefLang.value = typeof prefs.lang === 'string' && DATA.languages.indexOf(prefs.lang) >= 0 ? prefs.lang : '';
    prefLoc.value = typeof prefs.loc === 'string' && DATA.countries.indexOf(prefs.loc) >= 0 ? prefs.loc : '';
    prefNote.textContent = '';
    var themeRadio = /** @type {HTMLInputElement} */ (byId('theme-' + settings.theme));
    themeRadio.checked = true;
    var barRadio = /** @type {HTMLInputElement} */ (byId('subcat-' + settings.subcatBar));
    barRadio.checked = true;
    if (supportsDialog) {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.classList.add('dialog-fallback');
      dialog.setAttribute('open', '');
      document.addEventListener('keydown', onFallbackKeydown);
      document.addEventListener('click', onFallbackOutsideClick, true);
    }
    focusOn(themeRadio, true);
  }

  function closeDialog() {
    if (supportsDialog) {
      if (dialog.open) dialog.close();
      return;
    }
    dialog.removeAttribute('open');
    document.removeEventListener('keydown', onFallbackKeydown);
    document.removeEventListener('click', onFallbackOutsideClick, true);
    onDialogClosed();
  }

  /** The Settings row that opened the dialog sits in the closed avatar menu, so focus returns to the avatar. */
  function onDialogClosed() {
    focusOn(avatarButton, true);
  }

  /** @param {KeyboardEvent} event */
  function onFallbackKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') closeDialog();
  }

  /** @param {MouseEvent} event */
  function onFallbackOutsideClick(event) {
    var target = /** @type {Node|null} */ (event.target instanceof Node ? event.target : null);
    if (target && !dialog.contains(target) && target !== avatarButton && !avatarButton.contains(target)) closeDialog();
  }

  function savePreferences() {
    var ok = writeStorage(PREFS_KEY, { lang: prefLang.value, loc: prefLoc.value });
    prefNote.textContent = ok ? t('saved') : t('prefsUnavailable');
  }

  /**
   * @param {HTMLSelectElement} select
   * @param {string[]} codes
   * @param {'language'|'region'} kind
   * @param {string} allLabel
   */
  function fillSelect(select, codes, kind, allLabel) {
    clear(select);
    var all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    namedCodes(codes, kind).forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.code;
      option.textContent = entry.label;
      select.appendChild(option);
    });
  }

  // ------------------------------------------------------------------ keyboard

  /** Escape closes whatever is open: the Menu panel, a dropdown, then the search field. */
  function onDocumentKeydown(event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    if (!menuPanel.hidden) {
      event.preventDefault();
      closeMenuPanel(true);
      return;
    }
    if (openMenu) {
      event.preventDefault();
      openMenu.close(true);
      return;
    }
    if (!searchForm.hidden && searchForm.contains(document.activeElement)) {
      event.preventDefault();
      setSearchOpen(false);
    }
  }

  // ------------------------------------------------------------------ wiring

  /**
   * Bind the in-page links under `root` (href="#view") to click handlers. In-page navigation never
   * relies on the #hash: a fragment navigation would be swallowed by popstate on the hosted site
   * and does nothing in the preview once the hash already matches.
   * @param {ParentNode} root
   */
  function bindInPageLinks(root) {
    var links = root.querySelectorAll('a[href^="#"]');
    for (var i = 0; i < links.length; i += 1) {
      (function (link) {
        link.addEventListener('click', function (event) { onMenuLinkClick(event, link); });
      })(links[i]);
    }
  }

  function init() {
    applyTheme();
    applySubcatBarSetting();
    if (!document.documentElement.lang) document.documentElement.lang = UI_LANG;
    applyStrings(document);
    trackHeaderHeight();

    var hadFilters = hasFilterParams();
    readUrlState();
    var hashView = viewFromHash();
    if (hashView && hashView !== 'feed') {
      // A plain #anchor names a view; Live opens on All (a ?s= for Live needs ?view=live).
      view = hashView;
      state.s = '';
      state.c = '';
    }
    if (!hadFilters) {
      var prefs = loadPrefs();
      if (prefs) {
        if (typeof prefs.lang === 'string' && DATA.languages.indexOf(prefs.lang) >= 0) state.lang = prefs.lang;
        if (typeof prefs.loc === 'string' && DATA.countries.indexOf(prefs.loc) >= 0) state.loc = prefs.loc;
      }
    }

    buildLocMenu();
    buildLangList();
    fillSelect(prefLang, DATA.languages, 'language', t('allLanguages'));
    fillSelect(prefLoc, DATA.countries, 'region', t('world'));
    renderTabs();
    buildMenuPanel();
    setupDragScroll();
    syncControls();

    // The blue bar.
    brandLink.addEventListener('click', function (event) { event.preventDefault(); goHome(); });
    searchToggle.addEventListener('click', function () { setSearchOpen(searchForm.hidden); });
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); applySearch(); });
    searchInput.addEventListener('search', applySearch);
    searchInput.addEventListener('input', function () { if (searchInput.value === '' && state.q) applySearch(); });
    typeButton.addEventListener('click', cycleType);
    langButton.addEventListener('click', function () { setLangListOpen(langList.hidden); });
    themeToggle.addEventListener('click', toggleTheme);
    settingsButton.addEventListener('click', function () {
      avatarMenuController.close(false);
      openDialog();
    });
    menuFollowing.addEventListener('click', function (event) {
      event.preventDefault();
      avatarMenuController.close(false);
      openViewFromMenu('following');
    });
    bindInPageLinks(avatarMenu);
    if (darkQuery && typeof darkQuery.addEventListener === 'function') darkQuery.addEventListener('change', syncThemeToggle);
    document.addEventListener('mousedown', onPointerDownOutside);
    document.addEventListener('touchstart', onPointerDownOutside, { passive: true });
    document.addEventListener('keydown', onDocumentKeydown);

    // The tabs bar and the Menu panel.
    menuButton.addEventListener('click', function () {
      if (menuPanel.hidden) openMenuPanel();
      else closeMenuPanel(true);
    });
    menuPanelClose.addEventListener('click', function () { closeMenuPanel(true); });
    menuPanel.addEventListener('keydown', onMenuPanelKeydown);
    bindInPageLinks(panelMore);

    // The feed.
    clearButton.addEventListener('click', clearFilters);
    manageFollowingButton.addEventListener('click', function () { goToView('manage'); });
    var backLinks = document.querySelectorAll('.back-link');
    for (var b = 0; b < backLinks.length; b += 1) {
      backLinks[b].addEventListener('click', function (event) { event.preventDefault(); backToFeed(); });
    }

    // Manage Following.
    manageCancel.addEventListener('click', function () { goToView('following'); focusOn(mainEl, true); });
    manageSave.addEventListener('click', saveManage);
    manageSearch.addEventListener('input', filterManageRows);
    manageShowAll.addEventListener('click', function () { setManagePill(false); filterManageRows(); });
    manageShowFollowing.addEventListener('click', function () { setManagePill(true); filterManageRows(); });

    // The Settings dialog.
    profileClose.addEventListener('click', closeDialog);
    prefSave.addEventListener('click', savePreferences);
    dialog.addEventListener('close', onDialogClosed);
    dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });
    dialog.addEventListener('change', function (event) {
      var target = /** @type {HTMLInputElement} */ (event.target);
      if (!target || target.type !== 'radio') return;
      if (target.name === 'theme' && (target.value === 'light' || target.value === 'dark' || target.value === 'system')) {
        settings.theme = target.value;
        applyTheme();
        saveSettings();
      } else if (target.name === 'subcatBar' && (target.value === 'top' || target.value === 'bottom')) {
        settings.subcatBar = target.value;
        applySubcatBarSetting();
        saveSettings();
      }
    });

    skipLink.addEventListener('click', function (event) {
      event.preventDefault();
      mainEl.focus();
    });
    window.addEventListener('hashchange', onHashChange);
    if (CONFIG.urlState) window.addEventListener('popstate', onPopState);

    setupInfiniteScroll();
    showView(view, false);
    refresh(false);
    if (hashView && CONFIG.urlState) writeUrlState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
