/*
  Curanet browser app. One plain script shared by the hosted site and the private preview.
  It reads CURANET_CONFIG (injected by the build) and the JSON in #curanet-data, then renders
  everything with createElement and textContent: no markup is ever built from feed data.

  CURANET_CONFIG: { mode: 'hosted'|'preview', urlState: boolean, thumbnails: 'remote'|'embedded',
                    video: 'embed'|'link', uiLang: 'en'|'fr' }

  Views: 'feed' (Home or a category), 'saved' and 'following' (My Hub), 'manage' (the Manage
  Following panel), 'live' (latest videos), 'sources', 'about'. Saved items, followed sections
  and settings live in the visitor's browser (localStorage) and fall back to memory when storage
  is refused.
*/

/* == pure helpers begin ==
   Small functions with no DOM and no translation table, kept together so test/build.test.js can
   evaluate this block on its own (it slices the file between the "pure helpers" markers and runs
   it in a vm). app.js reads them through CURANET_HELPERS below. */
/* exported CURANET_HELPERS */
var CURANET_HELPERS = (function () {
  'use strict';

  var TYPE_CYCLE = ['both', 'articles', 'videos'];
  var RELATIVE_LIMIT_MS = 7 * 86400 * 1000;

  /**
   * The next value of the article/video control: both → articles → videos → both.
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
   * The publisher monogram: the name's first character and one of 8 colour tones picked by
   * hashing the source id, so a source always gets the same colour. A name with nothing in it
   * shows a dot.
   * @param {string} sourceId
   * @param {string} name
   * @returns {{letter: string, tone: number}}
   */
  function monogramFor(sourceId, name) {
    var hash = 0;
    var id = String(sourceId || '');
    for (var i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    var first = firstGrapheme(String(name || '').trim());
    var letter = first ? first.toUpperCase() : '•';
    return { letter: letter, tone: hash % 8 };
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

  return { cycleTypeValue: cycleTypeValue, formatRelativeOrDate: formatRelativeOrDate, monogramFor: monogramFor, firstGrapheme: firstGrapheme, fold: fold, TYPE_CYCLE: TYPE_CYCLE };
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
   */

  var H = window['CURANET_HELPERS'];
  var DEFAULT_CONFIG = { mode: 'hosted', urlState: true, thumbnails: 'remote', video: 'embed', uiLang: 'en' };
  var CONFIG = Object.assign({}, DEFAULT_CONFIG, window['CURANET_CONFIG'] || {});
  /** The translation table from strings.js (loaded before this script). */
  var STRINGS = window['CURANET_STRINGS'] || { en: {}, fr: {} };
  var UI_LANG = typeof CONFIG.uiLang === 'string' && CONFIG.uiLang ? CONFIG.uiLang : 'en';
  var PAGE_SIZE = 30;
  var PREFS_KEY = 'curanet.prefs';
  var SAVED_KEY = 'curanet.saved';
  var FOLLOWING_KEY = 'curanet.following';
  var SETTINGS_KEY = 'curanet.settings';
  var TYPE_LABELS = { both: 'typeBoth', articles: 'typeArticles', videos: 'typeVideos' };
  var STATUS_LABELS = { active: 'statusActive', paused: 'statusPaused', blocked: 'statusBlocked', waiting_for_key: 'statusWaitingForKey' };
  var FILTER_PARAMS = ['view', 'c', 's', 'lang', 'loc', 'type', 'q'];
  var LIVE_SECTIONS = ['news', 'sports', 'music'];
  var LIVE_LABELS = { news: 'liveNews', sports: 'liveSports', music: 'liveMusic' };
  /** Views that show the feed column. */
  var FEED_VIEWS = { feed: true, saved: true, following: true, live: true };
  /** URL tokens (hash or ?view=) for the views that have one. */
  var VIEW_TOKENS = { saved: 'saved', following: 'following', manage: 'following-manage', live: 'live', sources: 'sources', about: 'about' };
  var PHONE_QUERY = '(max-width: 920px)';
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
   * Fill every element under `root` that carries data-t (text) or data-t-<attribute>.
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

  /** @returns {boolean} true on phones and small tablets (the mobile layout). */
  function isPhone() {
    try {
      return window.matchMedia(PHONE_QUERY).matches;
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

  /**
   * Theme at start-up and on change: an explicit light or dark attribute, or none for "system".
   * The build puts the same decision in a tiny inline script at the top of the page so the first
   * paint is already right; running it again here is harmless.
   */
  function applyTheme() {
    var root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }

  function applySubcatBarSetting() {
    document.body.classList.toggle('subbar-bottom', settings.subcatBar === 'bottom');
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
  var brandLink = byId('brand-link');
  var ribbonCategories = byId('ribbon-categories');
  var ribbonSubcategories = byId('ribbon-subcategories');
  var subbar = byId('subbar');
  var navArrows = byId('nav-arrows');
  var navPrev = byId('nav-prev');
  var navNext = byId('nav-next');
  var searchToggle = byId('search-toggle');
  var mobileSearch = byId('mobile-search');
  var tools = byId('tools');
  var toolsSearch = byId('tools-search');
  var toolsFilters = byId('tools-filters');
  var panelFilters = byId('panel-filters');
  var panelFilterSlot = byId('panel-filter-slot');
  var langWrap = byId('filter-lang-wrap');
  var locWrap = byId('filter-loc-wrap');
  var langSelect = /** @type {HTMLSelectElement} */ (byId('filter-lang'));
  var locSelect = /** @type {HTMLSelectElement} */ (byId('filter-loc'));
  var typeButton = byId('type-button');
  var typeLabel = byId('type-label');
  var searchForm = /** @type {HTMLFormElement} */ (byId('search-form'));
  var searchInput = /** @type {HTMLInputElement} */ (byId('search-input'));
  var profileButton = byId('profile-button');
  var panel = /** @type {HTMLDialogElement} */ (byId('profile-panel'));
  var prefLang = /** @type {HTMLSelectElement} */ (byId('pref-lang'));
  var prefLoc = /** @type {HTMLSelectElement} */ (byId('pref-loc'));
  var prefSave = byId('pref-save');
  var prefNote = byId('pref-note');
  var profileClose = byId('profile-close');
  var feedSection = byId('feed-section');
  var feedHeading = byId('feed-heading');
  var feedPanel = byId('feed-panel');
  var feedList = byId('feed-list');
  var emptyState = byId('empty-state');
  var emptyText = byId('empty-text');
  var clearButton = byId('clear-filters');
  var manageFollowingButton = byId('manage-following-button');
  var storageHint = byId('storage-hint');
  var actionStatus = byId('action-status');
  var resultCount = byId('result-count');
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
  var sourcesBody = byId('sources-body');
  var sourcesEmpty = byId('sources-empty');
  var aboutSection = byId('about-section');
  var generatedAt = byId('generated-at');
  var mainEl = byId('main');
  var skipLink = find(document, '.skip-link');

  // ------------------------------------------------------------------ tabs (both bars)

  /**
   * @param {string} label
   * @param {boolean} pressed
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function makeTab(label, pressed, onClick) {
    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    tab.appendChild(el('span', 'tab-label', label));
    tab.addEventListener('click', onClick);
    return tab;
  }

  /**
   * @param {HTMLElement} ribbon
   * @param {string} activeId   data-id of the tab to mark.
   */
  function markActiveTab(ribbon, activeId) {
    var tabs = ribbon.querySelectorAll('.tab');
    /** @type {HTMLElement|null} */
    var active = null;
    for (var i = 0; i < tabs.length; i += 1) {
      var tab = /** @type {HTMLElement} */ (tabs[i]);
      var pressed = (tab.getAttribute('data-id') || '') === activeId;
      tab.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (pressed) active = tab;
    }
    revealTab(ribbon, active);
  }

  /**
   * The ribbon's end padding: on phones the top ribbon keeps 100px free under the pinned
   * avatar/magnifier block, so that strip is not usable space.
   * @param {HTMLElement} ribbon
   * @returns {number}
   */
  function ribbonEndPadding(ribbon) {
    try {
      var style = window.getComputedStyle(ribbon);
      return parseFloat(style.paddingInlineEnd || style.paddingRight) || 0;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Scroll the ribbon sideways so the active (or focused) tab is fully in view, outside the
   * padding under the pinned block. Never scrolls the page.
   * @param {HTMLElement} ribbon
   * @param {HTMLElement|null} tab
   */
  function revealTab(ribbon, tab) {
    if (!tab) return;
    var ribbonRect = ribbon.getBoundingClientRect();
    var tabRect = tab.getBoundingClientRect();
    var usableWidth = ribbonRect.width - ribbonEndPadding(ribbon);
    if (tabRect.left >= ribbonRect.left && tabRect.right <= ribbonRect.left + usableWidth) return;
    var left = tabRect.left - ribbonRect.left + ribbon.scrollLeft - (usableWidth - tabRect.width) / 2;
    var target = Math.max(0, left);
    try {
      ribbon.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      ribbon.scrollLeft = target;
    }
  }

  /** @returns {string} the data-id of the top tab that should read as selected. */
  function activeTopId() {
    if (view === 'saved' || view === 'following' || view === 'manage') return '__hub';
    if (view === 'live') return '__live';
    if (view === 'feed') return state.c || '__home';
    return '__none';
  }

  function renderCategoryRibbon() {
    clear(ribbonCategories);
    var fixed = [
      { id: '__hub', label: t('myHub'), go: function () { goToView('saved'); } },
      { id: '__live', label: t('live'), go: function () { goToView('live'); } },
      { id: '__home', label: t('home'), go: function () { selectCategory(''); } },
    ];
    var active = activeTopId();
    fixed.forEach(function (entry) {
      var tab = makeTab(entry.label, active === entry.id, entry.go);
      tab.setAttribute('data-id', entry.id);
      ribbonCategories.appendChild(tab);
    });
    DATA.categories.forEach(function (category) {
      var tab = makeTab(nameOf(category), active === category.id, function () { selectCategory(category.id); });
      tab.setAttribute('data-id', category.id);
      ribbonCategories.appendChild(tab);
    });
    updateArrows();
  }

  /** The second bar depends on the view: subcategories, My Hub tabs, Live sections, or nothing. */
  function renderSubcategoryRibbon() {
    clear(ribbonSubcategories);
    var show = true;
    if (view === 'feed') {
      var category = state.c ? CATEGORIES[state.c] : null;
      if (!category) {
        show = false;
      } else {
        var all = makeTab(t('all'), state.s === '', function () { selectSubcategory(''); });
        all.setAttribute('data-id', '');
        ribbonSubcategories.appendChild(all);
        (category.subcategories || []).forEach(function (sub) {
          var tab = makeTab(nameOf(sub), state.s === sub.id, function () { selectSubcategory(sub.id); });
          tab.setAttribute('data-id', sub.id);
          ribbonSubcategories.appendChild(tab);
        });
      }
    } else if (view === 'saved' || view === 'following' || view === 'manage') {
      var savedTab = makeTab(t('savedTab'), view === 'saved', function () { goToView('saved'); });
      savedTab.setAttribute('data-id', 'saved');
      ribbonSubcategories.appendChild(savedTab);
      // "Following ⚙": the tab opens the Following feed, the gear beside it is its own button
      // and opens Manage Following from any My Hub state.
      var group = el('span', 'tab-group');
      var followingTab = makeTab(t('followingTab'), view !== 'saved', function () { goToView('following'); });
      followingTab.setAttribute('data-id', 'following');
      group.appendChild(followingTab);
      var gear = document.createElement('button');
      gear.type = 'button';
      gear.className = 'tab-gear';
      gear.setAttribute('aria-label', t('manageFollowing'));
      gear.title = t('manageFollowing');
      gear.setAttribute('aria-pressed', view === 'manage' ? 'true' : 'false');
      gear.appendChild(cloneTemplate('tpl-gear-icon'));
      gear.addEventListener('click', function () { goToView('manage'); });
      group.appendChild(gear);
      ribbonSubcategories.appendChild(group);
    } else if (view === 'live') {
      var liveAll = makeTab(t('all'), state.s === '', function () { selectLiveSection(''); });
      liveAll.setAttribute('data-id', '');
      ribbonSubcategories.appendChild(liveAll);
      LIVE_SECTIONS.forEach(function (section) {
        var tab = makeTab(t(LIVE_LABELS[section]), state.s === section, function () { selectLiveSection(section); });
        tab.setAttribute('data-id', section);
        ribbonSubcategories.appendChild(tab);
      });
    } else {
      show = false;
    }
    subbar.hidden = !show;
    document.body.classList.toggle('has-subbar', show);
  }

  /** @param {string} categoryId */
  function selectCategory(categoryId) {
    var changed = view !== 'feed' || state.c !== categoryId || state.s !== '';
    state.c = CATEGORIES[categoryId] ? categoryId : '';
    state.s = '';
    view = 'feed';
    showView('feed', false);
    if (changed) refresh(true);
  }

  /** @param {string} subcategoryId */
  function selectSubcategory(subcategoryId) {
    var changed = state.s !== subcategoryId;
    state.s = subcategoryOf(state.c, subcategoryId) ? subcategoryId : '';
    markActiveTab(ribbonSubcategories, state.s);
    if (changed) refresh(true);
  }

  /** @param {string} section */
  function selectLiveSection(section) {
    var changed = state.s !== section;
    state.s = LIVE_SECTIONS.indexOf(section) >= 0 ? section : '';
    markActiveTab(ribbonSubcategories, state.s);
    if (changed) refresh(true);
  }

  // ------------------------------------------------------------------ arrows

  /** Grey the prev/next buttons at the ends; hide both when every tab fits. */
  function updateArrows() {
    var overflow = ribbonCategories.scrollWidth - ribbonCategories.clientWidth;
    navArrows.hidden = overflow <= 1 || isPhone();
    if (navArrows.hidden) return;
    var left = ribbonCategories.scrollLeft;
    navPrev.setAttribute('aria-disabled', left <= 1 ? 'true' : 'false');
    navNext.setAttribute('aria-disabled', left >= overflow - 1 ? 'true' : 'false');
  }

  /** @param {number} direction  -1 or 1 */
  function scrollRibbon(direction) {
    var target = ribbonCategories.scrollLeft + direction * ribbonCategories.clientWidth;
    try {
      ribbonCategories.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      ribbonCategories.scrollLeft = Math.max(0, target);
    }
  }

  // ------------------------------------------------------------------ controls

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
    var options = codes.map(function (code) { return { code: code, label: displayName(kind, code) }; });
    options.sort(function (a, b) { return a.label.localeCompare(b.label, UI_LANG); });
    options.forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.code;
      option.textContent = entry.label;
      select.appendChild(option);
    });
  }

  function syncControls() {
    langSelect.value = state.lang;
    locSelect.value = state.loc;
    syncTypeButton();
    searchInput.value = state.q;
  }

  function syncTypeButton() {
    typeLabel.textContent = t(TYPE_LABELS[state.type]);
    typeButton.setAttribute('data-type', state.type);
  }

  function cycleType() {
    state.type = H.cycleTypeValue(state.type);
    syncTypeButton();
    refresh(true);
  }

  function applySearch() {
    var words = searchInput.value.trim().slice(0, 200);
    if (words === state.q) return;
    state.q = words;
    refresh(true);
  }

  function clearFilters() {
    state.c = '';
    state.s = '';
    state.lang = '';
    state.loc = '';
    state.type = 'both';
    state.q = '';
    renderCategoryRibbon();
    markActiveTab(ribbonCategories, activeTopId());
    renderSubcategoryRibbon();
    syncControls();
    setFeedHeading();
    refresh(true);
    // The button that was pressed disappears with the empty message; keep focus in the page.
    if (emptyState.hidden) focusOn(mainEl, true);
  }

  /**
   * The tools row shows the article/video bar and, on desktop, the filters and search. In Live
   * the bar is hidden, and on phones (where the filters live elsewhere) that leaves the row empty,
   * so the whole row goes and the first video sits 16px under the bars like every other view.
   */
  function updateToolsRow() {
    var feedVisible = Boolean(FEED_VIEWS[view]);
    typeButton.hidden = view === 'live';
    tools.hidden = !feedVisible || (view === 'live' && isPhone());
  }

  /**
   * Move the search form and the two filter selects between their desktop slots (tools row) and
   * their phone slots (under the bars, and inside the settings panel). One set of controls, one
   * set of ids, whatever the width.
   */
  function placeControls() {
    var phone = isPhone();
    if (phone) {
      if (searchForm.parentNode !== mobileSearch) mobileSearch.appendChild(searchForm);
      if (langWrap.parentNode !== panelFilterSlot) { panelFilterSlot.appendChild(langWrap); panelFilterSlot.appendChild(locWrap); }
      panelFilters.hidden = false;
      mobileSearch.hidden = !(searchToggle.getAttribute('aria-expanded') === 'true' || state.q !== '');
      searchToggle.setAttribute('aria-expanded', mobileSearch.hidden ? 'false' : 'true');
    } else {
      if (searchForm.parentNode !== toolsSearch) toolsSearch.appendChild(searchForm);
      if (langWrap.parentNode !== toolsFilters) { toolsFilters.insertBefore(locWrap, toolsSearch); toolsFilters.insertBefore(langWrap, locWrap); }
      panelFilters.hidden = true;
      mobileSearch.hidden = true;
    }
    updateToolsRow();
    updateArrows();
  }

  function toggleMobileSearch() {
    var open = mobileSearch.hidden;
    mobileSearch.hidden = !open;
    searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) focusOn(searchInput, true);
    else if (state.q) { searchInput.value = ''; applySearch(); }
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

  /** @returns {HTMLElement} */
  function playIcon() {
    return cloneTemplate('tpl-play-icon');
  }

  /**
   * @param {HTMLElement} card
   * @param {FeedSource} source
   */
  function fillPublisher(card, source) {
    var mono = H.monogramFor(source.id, source.name);
    var monogram = find(card, '.monogram');
    monogram.textContent = mono.letter;
    monogram.classList.add('tone-' + mono.tone);
    find(card, '.publisher-name').textContent = source.name;
  }

  /**
   * Share through the browser's own sheet when it has one, otherwise copy the link.
   * @param {FeedItem} item
   * @param {HTMLElement} button
   */
  function shareItem(item, button) {
    var url = item.ty === 'v' ? watchUrl(item) : item.l;
    var label = find(button, '.action-label');
    var original = t('share');
    var flash = function (text) {
      label.textContent = text;
      button.setAttribute('aria-label', text);
      actionStatus.textContent = text;
      window.setTimeout(function () {
        label.textContent = original;
        button.setAttribute('aria-label', original);
      }, 2000);
    };
    var copy = function () {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(url).then(function () { flash(t('linkCopied')); }, function () { flash(t('shareFailed')); });
      } else {
        flash(t('shareFailed'));
      }
    };
    if (typeof navigator.share === 'function') {
      try {
        navigator.share({ title: item.t, url: url }).then(function () {}, function (error) {
          if (!error || error.name !== 'AbortError') copy();
        });
        return;
      } catch (e) {
        // fall through to copying
      }
    }
    copy();
  }

  /**
   * @param {HTMLElement} button
   * @param {boolean} saved
   */
  function paintSaveButton(button, saved) {
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    var text = t(saved ? 'savedItem' : 'saveItem');
    find(button, '.action-label').textContent = text;
    button.setAttribute('aria-label', text);
  }

  /**
   * Like, Comment (both disabled until accounts exist), Share and Save.
   * @param {HTMLElement} card
   * @param {FeedItem} item
   */
  function fillActions(card, item) {
    var slot = find(card, '.actions');
    var actions = cloneTemplate('tpl-actions');
    var like = find(actions, '.action-like');
    find(like, '.action-label').textContent = t('like');
    find(like, '.action-hint').textContent = t('comingLater');
    like.title = t('comingLater');
    var comment = find(actions, '.action-comment');
    find(comment, '.action-label').textContent = t('comment');
    find(comment, '.action-hint').textContent = t('comingLater');
    comment.title = t('comingLater');
    var share = find(actions, '.action-share');
    find(share, '.action-label').textContent = t('share');
    share.setAttribute('aria-label', t('share'));
    share.addEventListener('click', function () { shareItem(item, share); });
    var save = find(actions, '.action-save');
    paintSaveButton(save, isSaved(item.id));
    save.addEventListener('click', function () {
      var saved = toggleSaved(item.id);
      paintSaveButton(save, saved);
      storageHint.hidden = storageOk || !(view === 'saved' || view === 'following');
      if (view === 'saved' && !saved) {
        // Unsaving inside the Saved list removes the item from it. Focus was on the Save button
        // being removed, so it moves to the next item's title (or the feed itself).
        var li = card.parentNode ? card : null;
        /** @type {Element|null} */
        var nextFocus = null;
        if (li && li.parentNode) {
          var neighbour = li.nextElementSibling || li.previousElementSibling;
          nextFocus = neighbour ? neighbour.querySelector('.item-link') : null;
          li.parentNode.removeChild(li);
        }
        filtered = filtered.filter(function (entry) { return entry.id !== item.id; });
        shown = Math.max(0, shown - 1);
        emptyState.hidden = filtered.length > 0;
        updateEmptyState();
        announceCount();
        focusOn(/** @type {HTMLElement} */ (nextFocus || mainEl), true);
      }
    });
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
    find(link, '.item-title-text').textContent = item.t;
    fillPublisher(card, source);
    fillTime(find(card, '.item-time'), item.p, nowMs);
    var thumb = /** @type {HTMLAnchorElement} */ (find(card, '.item-thumb'));
    var img = /** @type {HTMLImageElement} */ (find(card, '.item-img'));
    if (thumbSrc(item)) {
      thumb.href = item.l;
      // The title link already leads there, so the image link stays out of the tab order and the
      // screen-reader flow; the alt still describes the picture for everyone else.
      img.alt = item.t;
      img.addEventListener('error', function () {
        card.classList.add('no-thumb');
        if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
      });
      img.src = thumbSrc(item);
    } else {
      card.classList.add('no-thumb');
      if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
    }
    fillActions(card, item);
    return card;
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
   * Put the preview image (or a compact play row when there is none) and the play badge into the
   * element that reacts to the click (a link or a button).
   * @param {HTMLElement} box
   * @param {HTMLElement} control
   * @param {FeedItem} item
   * @param {string} textWhenNoImage
   */
  function fillPreview(box, control, item, textWhenNoImage) {
    var label = document.createElement('span');
    label.textContent = textWhenNoImage;
    var showTextRow = function () {
      box.classList.add('no-thumb');
      if (!label.parentNode) control.appendChild(label);
    };
    if (thumbSrc(item)) {
      var img = document.createElement('img');
      img.className = 'video-img';
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.setAttribute('decoding', 'async');
      img.setAttribute('referrerpolicy', 'no-referrer');
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        showTextRow();
      });
      img.src = thumbSrc(item);
      control.appendChild(img);
      control.appendChild(el('span', 'video-scrim'));
      control.appendChild(playIcon());
    } else {
      control.appendChild(playIcon());
      showTextRow();
    }
  }

  /**
   * @param {HTMLElement} box
   * @param {FeedItem} item
   */
  function embedPlayer(box, item) {
    if (!item.v) return;
    var frame = document.createElement('iframe');
    frame.className = 'video-frame';
    frame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(item.v) + '?autoplay=1';
    frame.title = t('videoPlayer', { title: item.t });
    frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    frame.setAttribute('allowfullscreen', '');
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    box.classList.remove('no-thumb');
    clear(box);
    box.appendChild(frame);
    frame.focus();
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
    find(link, '.item-title-text').textContent = item.t;
    fillPublisher(card, source);
    // One <time> sits beside the channel name (desktop), one in the bottom row (phones); CSS shows one.
    fillTime(find(card, '.item-time-inline'), item.p, nowMs);
    fillTime(find(card, '.item-time-foot'), item.p, nowMs);
    var box = find(card, '.video-box');
    if (CONFIG.video === 'embed' && item.v) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'video-preview';
      button.setAttribute('aria-label', t('playVideo', { title: item.t }));
      button.addEventListener('click', function () { embedPlayer(box, item); });
      fillPreview(box, button, item, t('play'));
      box.appendChild(button);
    } else {
      var anchor = document.createElement('a');
      anchor.className = 'video-preview';
      anchor.href = watchUrl(item);
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.setAttribute('aria-describedby', 'new-tab-hint');
      anchor.setAttribute('aria-label', t('watchOnYouTubeTitle', { title: item.t }));
      fillPreview(box, anchor, item, t('watchOnYouTube'));
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
    emptyText.textContent = t(view === 'saved' && listEmpty ? 'nothingSaved' : view === 'following' && listEmpty ? 'notFollowing' : 'emptyTitle');
    clearButton.hidden = listEmpty;
    manageFollowingButton.hidden = !(view === 'following' && listEmpty);
    feedPanel.hidden = filtered.length === 0;
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
    if (scrollUp && window.scrollY > 0) {
      try {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    }
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
  /** @type {{category: FeedCategory, row: HTMLElement, button: HTMLElement, body: HTMLElement, badge: HTMLElement, boxes: {input: HTMLInputElement, label: HTMLElement, sub: Named}[]}[]} */
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
      row.badge.textContent = String(n);
      row.badge.setAttribute('aria-label', t('followedInCategory', { n: formatNumber(n) }));
    });
  }

  /**
   * @param {{category: FeedCategory, row: HTMLElement, button: HTMLElement, body: HTMLElement, badge: HTMLElement, boxes: {input: HTMLInputElement, label: HTMLElement, sub: Named}[]}} row
   * @param {boolean} open
   */
  function setRowOpen(row, open) {
    row.button.setAttribute('aria-expanded', open ? 'true' : 'false');
    row.body.hidden = !open;
    row.row.classList.toggle('is-open', open);
  }

  /** Apply the search words and the All / Following toggle to the accordion. */
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

  function buildManageList() {
    clear(manageList);
    manageRows = [];
    DATA.categories.forEach(function (category, index) {
      var row = el('div', 'acc');
      var heading = el('h2', 'acc-heading');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'acc-button';
      var bodyId = 'acc-' + String(category.id).replace(/[^a-z0-9_-]/gi, '');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', bodyId);
      button.appendChild(el('span', 'acc-name', nameOf(category)));
      var badge = el('span', 'acc-badge', '0');
      button.appendChild(badge);
      button.appendChild(cloneTemplate('tpl-chevron-icon'));
      heading.appendChild(button);
      row.appendChild(heading);

      var body = el('div', 'acc-body');
      body.id = bodyId;
      body.hidden = true;
      var grid = el('div', 'check-grid');
      /** @type {{input: HTMLInputElement, label: HTMLElement, sub: Named}[]} */
      var boxes = [];
      (category.subcategories || []).forEach(function (sub) {
        var label = el('label', 'check');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'check-input';
        input.value = category.id + '/' + sub.id;
        input.checked = Boolean(draft[input.value]);
        input.addEventListener('change', function () {
          draft[input.value] = input.checked;
          updateManageCounts();
        });
        label.appendChild(input);
        label.appendChild(el('span', 'check-box'));
        label.appendChild(el('span', 'check-label', nameOf(sub)));
        grid.appendChild(label);
        boxes.push({ input: input, label: label, sub: sub });
      });
      body.appendChild(grid);
      var foot = el('div', 'acc-foot');
      // Twelve categories mean twelve pairs of these buttons; the accessible name says which one.
      var selectAll = document.createElement('button');
      selectAll.type = 'button';
      selectAll.className = 'text-button';
      selectAll.textContent = t('selectAll');
      selectAll.setAttribute('aria-label', t('selectAllIn', { category: nameOf(category) }));
      selectAll.addEventListener('click', function () {
        boxes.forEach(function (box) { if (!box.label.hidden) { box.input.checked = true; draft[box.input.value] = true; } });
        updateManageCounts();
      });
      var clearAll = document.createElement('button');
      clearAll.type = 'button';
      clearAll.className = 'text-button';
      clearAll.textContent = t('clearSelection');
      clearAll.setAttribute('aria-label', t('clearSelectionIn', { category: nameOf(category) }));
      clearAll.addEventListener('click', function () {
        boxes.forEach(function (box) { if (!box.label.hidden) { box.input.checked = false; draft[box.input.value] = false; } });
        updateManageCounts();
        if (manageShowOnlyFollowing) filterManageRows();
      });
      foot.appendChild(selectAll);
      foot.appendChild(clearAll);
      body.appendChild(foot);
      row.appendChild(body);
      manageList.appendChild(row);

      var entry = { category: category, row: row, button: button, body: body, badge: badge, boxes: boxes };
      button.addEventListener('click', function () { setRowOpen(entry, button.getAttribute('aria-expanded') !== 'true'); });
      setRowOpen(entry, index < 2);
      manageRows.push(entry);
    });
    updateManageCounts();
    filterManageRows();
  }

  function openManage() {
    draft = Object.create(null);
    followingIds.forEach(function (id) { draft[id] = true; });
    manageShowOnlyFollowing = false;
    manageShowAll.setAttribute('aria-pressed', 'true');
    manageShowFollowing.setAttribute('aria-pressed', 'false');
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
   * The feed column's heading (hidden, but it names the landmark and the h1 for screen readers)
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
   * Show one view: toggles the sections, the bars and the tools row, and marks the tabs.
   * @param {View} next
   * @param {boolean} moveFocus   true to put focus on the view's heading; otherwise focus only
   *                              moves (to the feed) when the element that had it is now hidden,
   *                              so the keyboard never falls back to the top of the page.
   */
  function showView(next, moveFocus) {
    view = next;
    var feedVisible = Boolean(FEED_VIEWS[next]);
    var hadFocus = document.activeElement;
    feedSection.hidden = !feedVisible;
    manageSection.hidden = next !== 'manage';
    sourcesSection.hidden = next !== 'sources';
    aboutSection.hidden = next !== 'about';
    updateToolsRow();
    setFeedHeading();
    if (next === 'sources') renderSources();
    if (next === 'about') renderAbout();
    if (next === 'manage') openManage();
    markActiveTab(ribbonCategories, activeTopId());
    renderSubcategoryRibbon();
    if (next === 'feed') markActiveTab(ribbonSubcategories, state.s);
    else if (next === 'live') markActiveTab(ribbonSubcategories, state.s);
    else if (next === 'saved' || next === 'following' || next === 'manage') markActiveTab(ribbonSubcategories, next === 'saved' ? 'saved' : 'following');
    if (moveFocus) {
      var heading = next === 'sources' ? byId('sources-heading') : next === 'about' ? byId('about-heading') : next === 'manage' ? manageHeading : mainEl;
      focusOn(heading, true);
      window.scrollTo(0, 0);
    } else if (hadFocus && hadFocus !== document.body && isHiddenAway(hadFocus)) {
      focusOn(mainEl, true);
    }
    if (feedVisible && observer) window.requestAnimationFrame(fillIfSentinelVisible);
  }

  /**
   * Switch to a view from a tab, a button or a panel link, and refresh the feed.
   * @param {View} next
   */
  function goToView(next) {
    if (next !== 'feed') { state.c = ''; }
    if (next !== 'live' && next !== 'feed') state.s = '';
    // Entering Live always opens on All: a feed subcategory id such as "news" must not leak in
    // as a Live section. Section tabs inside Live keep their choice.
    if (next === 'live' && view !== 'live') state.s = '';
    showView(next, next === 'manage' || next === 'sources' || next === 'about');
    refresh(true);
  }

  /** Home: the whole feed, no category. */
  function goHome() {
    selectCategory('');
    if (window.scrollY > 0) {
      try {
        window.scrollTo({ top: 0, behavior: 'auto' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    }
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

  /**
   * A link's #token (a panel link or a back link), as a view.
   * @param {Element} link
   * @returns {View|null}
   */
  function viewFromLink(link) {
    var href = link.getAttribute('href') || '';
    return href.charAt(0) === '#' ? viewFromToken(href.slice(1)) : null;
  }

  // ------------------------------------------------------------------ settings panel

  var supportsDialog = typeof panel.showModal === 'function';

  function openPanel() {
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
      if (!panel.open) panel.showModal();
    } else {
      panel.classList.add('panel-fallback');
      panel.setAttribute('open', '');
      document.addEventListener('keydown', onFallbackKeydown);
      document.addEventListener('click', onFallbackOutsideClick, true);
    }
    profileButton.setAttribute('aria-expanded', 'true');
    focusOn(themeRadio, true);
  }

  function closePanel() {
    if (supportsDialog) {
      if (panel.open) panel.close();
      return;
    }
    panel.removeAttribute('open');
    document.removeEventListener('keydown', onFallbackKeydown);
    document.removeEventListener('click', onFallbackOutsideClick, true);
    onPanelClosed();
  }

  /** True while a panel link is taking the visitor to a view, so focus goes there and not back to the avatar. */
  var leavingPanelForView = false;

  function onPanelClosed() {
    profileButton.setAttribute('aria-expanded', 'false');
    if (!leavingPanelForView) profileButton.focus();
    leavingPanelForView = false;
  }

  /**
   * A Settings link (Saved, Following, Sources, About): close the panel and open the view directly.
   * @param {Event} event
   * @param {Element} link
   */
  function onPanelLinkClick(event, link) {
    var next = viewFromLink(link);
    if (!next) { closePanel(); return; }
    event.preventDefault();
    // With a real <dialog> the close event (which returns focus to the avatar) is still to come
    // after close(); without one, closePanel runs onPanelClosed right away.
    var closeEventPending = supportsDialog && panel.open;
    leavingPanelForView = true;
    closePanel();
    leavingPanelForView = closeEventPending;
    goToView(next);
    if (next === 'saved' || next === 'following') focusOn(mainEl, true);
  }

  /** @param {KeyboardEvent} event */
  function onFallbackKeydown(event) {
    if (event.key === 'Escape' || event.key === 'Esc') closePanel();
  }

  /** @param {MouseEvent} event */
  function onFallbackOutsideClick(event) {
    var target = /** @type {Node|null} */ (event.target);
    if (target && !panel.contains(target) && target !== profileButton && !profileButton.contains(target)) closePanel();
  }

  function savePreferences() {
    var ok = writeStorage(PREFS_KEY, { lang: prefLang.value, loc: prefLoc.value });
    prefNote.textContent = ok ? t('saved') : t('prefsUnavailable');
  }

  function saveSettings() {
    writeStorage(SETTINGS_KEY, settings);
  }

  // ------------------------------------------------------------------ wiring

  /** Keeps --header-h equal to the sticky bars' height so focused items scroll out from under them. */
  function trackHeaderHeight() {
    var apply = function () { document.documentElement.style.setProperty('--header-h', siteHeader.offsetHeight + 'px'); };
    apply();
    if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(siteHeader);
    else window.addEventListener('resize', apply);
  }

  function init() {
    applyTheme();
    applySubcatBarSetting();
    trackHeaderHeight();
    if (!document.documentElement.lang) document.documentElement.lang = UI_LANG;
    applyStrings(document);

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

    fillSelect(langSelect, DATA.languages, 'language', t('allLanguages'));
    fillSelect(locSelect, DATA.countries, 'region', t('allLocations'));
    fillSelect(prefLang, DATA.languages, 'language', t('allLanguages'));
    fillSelect(prefLoc, DATA.countries, 'region', t('allLocations'));
    renderCategoryRibbon();
    syncControls();
    placeControls();

    langSelect.addEventListener('change', function () { state.lang = langSelect.value; refresh(true); });
    locSelect.addEventListener('change', function () { state.loc = locSelect.value; refresh(true); });
    typeButton.addEventListener('click', cycleType);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); applySearch(); });
    searchInput.addEventListener('search', applySearch);
    searchInput.addEventListener('input', function () { if (searchInput.value === '' && state.q) applySearch(); });
    searchToggle.addEventListener('click', toggleMobileSearch);
    clearButton.addEventListener('click', clearFilters);
    manageFollowingButton.addEventListener('click', function () { goToView('manage'); });
    navPrev.addEventListener('click', function () { if (navPrev.getAttribute('aria-disabled') !== 'true') scrollRibbon(-1); });
    navNext.addEventListener('click', function () { if (navNext.getAttribute('aria-disabled') !== 'true') scrollRibbon(1); });
    ribbonCategories.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', function () { placeControls(); });
    try {
      var mq = window.matchMedia(PHONE_QUERY);
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', placeControls);
    } catch (e) {
      // resize covers it
    }

    manageCancel.addEventListener('click', function () { goToView('following'); });
    manageSave.addEventListener('click', saveManage);
    manageSearch.addEventListener('input', filterManageRows);
    manageShowAll.addEventListener('click', function () {
      manageShowOnlyFollowing = false;
      manageShowAll.setAttribute('aria-pressed', 'true');
      manageShowFollowing.setAttribute('aria-pressed', 'false');
      filterManageRows();
    });
    manageShowFollowing.addEventListener('click', function () {
      manageShowOnlyFollowing = true;
      manageShowAll.setAttribute('aria-pressed', 'false');
      manageShowFollowing.setAttribute('aria-pressed', 'true');
      filterManageRows();
    });

    profileButton.addEventListener('click', function () {
      if (profileButton.getAttribute('aria-expanded') === 'true') closePanel();
      else openPanel();
    });
    profileClose.addEventListener('click', closePanel);
    prefSave.addEventListener('click', savePreferences);
    panel.addEventListener('close', onPanelClosed);
    panel.addEventListener('click', function (event) { if (event.target === panel) closePanel(); });
    panel.addEventListener('change', function (event) {
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
    // In-page navigation goes through click handlers, never through the #hash: a fragment
    // navigation would be swallowed by popstate on the hosted site and does nothing in the preview
    // once the hash already matches. The hrefs stay as a fallback without scripts.
    var panelLinks = panel.querySelectorAll('.panel-link');
    for (var i = 0; i < panelLinks.length; i += 1) {
      (function (link) {
        link.addEventListener('click', function (event) { onPanelLinkClick(event, link); });
      })(panelLinks[i]);
    }
    var backLinks = document.querySelectorAll('.back-link');
    for (var b = 0; b < backLinks.length; b += 1) {
      backLinks[b].addEventListener('click', function (event) { event.preventDefault(); backToFeed(); });
    }
    brandLink.addEventListener('click', function (event) { event.preventDefault(); goHome(); });
    // A tab reached with the keyboard must not sit under the pinned avatar block on phones.
    ribbonCategories.addEventListener('focusin', function (event) {
      var target = /** @type {Element|null} */ (event.target instanceof Element ? event.target : null);
      var tab = target ? target.closest('.tab') : null;
      if (tab) revealTab(ribbonCategories, /** @type {HTMLElement} */ (tab));
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
