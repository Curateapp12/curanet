/*
  Curanet browser app. One plain script shared by the hosted site and the private preview.
  It reads CURANET_CONFIG (injected by the build) and the JSON in #curanet-data, then renders
  everything with createElement and textContent: no markup is ever built from feed data.

  CURANET_CONFIG: { mode: 'hosted'|'preview', urlState: boolean, thumbnails: 'remote'|'embedded',
                    video: 'embed'|'link', uiLang: 'en'|'fr' }
*/
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
   * @typedef {Object} FilterState
   * @property {string} c        Category id or '' for all.
   * @property {string} s        Subcategory id or ''.
   * @property {string} lang     Language code or ''.
   * @property {string} loc      Country code or ''.
   * @property {'both'|'articles'|'videos'} type
   * @property {string} q        Search words.
   */

  var DEFAULT_CONFIG = { mode: 'hosted', urlState: true, thumbnails: 'remote', video: 'embed', uiLang: 'en' };
  var CONFIG = Object.assign({}, DEFAULT_CONFIG, window['CURANET_CONFIG'] || {});
  /** The translation table from strings.js (loaded before this script). */
  var STRINGS = window['CURANET_STRINGS'] || { en: {}, fr: {} };
  var UI_LANG = typeof CONFIG.uiLang === 'string' && CONFIG.uiLang ? CONFIG.uiLang : 'en';
  var PAGE_SIZE = 30;
  var PREFS_KEY = 'curanet.prefs';
  var TYPE_CYCLE = ['both', 'articles', 'videos'];
  var TYPE_LABELS = { both: 'typeBoth', articles: 'typeArticles', videos: 'typeVideos' };
  var STATUS_LABELS = { active: 'statusActive', paused: 'statusPaused', blocked: 'statusBlocked', waiting_for_key: 'statusWaitingForKey' };
  var FILTER_PARAMS = ['c', 's', 'lang', 'loc', 'type', 'q'];

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
   * @param {string} id
   * @returns {HTMLElement}
   */
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

  // ------------------------------------------------------------------ data

  /** @returns {FeedData} */
  function readData() {
    /** @type {FeedData} */
    var empty = { generatedAt: '', categories: [], sources: [], items: [], languages: [], countries: [] };
    var el = document.getElementById('curanet-data');
    if (!el) return empty;
    try {
      var parsed = JSON.parse(el.textContent || '');
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

  /**
   * Lower-case text without accents, for search.
   * @param {string} text
   * @returns {string}
   */
  function fold(text) {
    var out = String(text || '').toLowerCase();
    try {
      out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
      // Older engines without normalize: accents stay significant.
    }
    return out;
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
  ITEMS.forEach(function (item) {
    item._search = fold(item.t + ' ' + item.x + ' ' + SOURCES[item.s].name);
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

  /** @type {Intl.RelativeTimeFormat|null} */
  var relativeFormat = null;
  /** @type {Intl.DateTimeFormat|null} */
  var absoluteFormat = null;
  /** @type {Intl.NumberFormat|null} */
  var numberFormat = null;
  try {
    if (typeof Intl !== 'undefined') {
      if (Intl.RelativeTimeFormat) relativeFormat = new Intl.RelativeTimeFormat(UI_LANG, { numeric: 'auto' });
      absoluteFormat = new Intl.DateTimeFormat(UI_LANG, { dateStyle: 'medium', timeStyle: 'short' });
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
   * "3 hours ago", "yesterday", "2 weeks ago" — through Intl.RelativeTimeFormat when available.
   * @param {string} iso
   * @param {number} nowMs
   * @returns {string}
   */
  function formatRelative(iso, nowMs) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    var ago = (nowMs - date.getTime()) / 1000;
    if (ago < 45) return t('justNow');
    /** @type {Intl.RelativeTimeFormatUnit} */
    var unit;
    var seconds;
    var fallbackKey;
    if (ago < 3600) { unit = 'minute'; seconds = 60; fallbackKey = 'minutesAgo'; }
    else if (ago < 86400) { unit = 'hour'; seconds = 3600; fallbackKey = 'hoursAgo'; }
    else if (ago < 7 * 86400) { unit = 'day'; seconds = 86400; fallbackKey = 'daysAgo'; }
    else if (ago < 30 * 86400) { unit = 'week'; seconds = 7 * 86400; fallbackKey = 'weeksAgo'; }
    else if (ago < 365 * 86400) { unit = 'month'; seconds = 30 * 86400; fallbackKey = 'monthsAgo'; }
    else return formatAbsolute(iso);
    var value = Math.floor(ago / seconds);
    if (relativeFormat) {
      try {
        return relativeFormat.format(-value, unit);
      } catch (e) {
        // fall through to the plain strings
      }
    }
    return t(fallbackKey, { n: value });
  }

  /**
   * @param {HTMLElement} timeEl
   * @param {string} iso
   * @param {number} nowMs
   */
  function fillTime(timeEl, iso, nowMs) {
    timeEl.setAttribute('datetime', iso);
    timeEl.textContent = formatRelative(iso, nowMs);
    var absolute = formatAbsolute(iso);
    if (absolute) timeEl.title = t('publishedOn', { date: absolute });
  }

  // ------------------------------------------------------------------ state

  /** @type {FilterState} */
  var state = { c: '', s: '', lang: '', loc: '', type: 'both', q: '' };
  /** @type {string[]} */
  var searchWords = [];
  var view = 'feed';

  /** @returns {boolean} true when the address carries any filter, valid or not. */
  function hasFilterParams() {
    if (!CONFIG.urlState) return false;
    var params = new URLSearchParams(location.search);
    for (var i = 0; i < FILTER_PARAMS.length; i += 1) {
      if (params.has(FILTER_PARAMS[i])) return true;
    }
    return false;
  }

  /** Read filters from the query string (hosted site only). Unknown values are ignored. */
  function readUrlState() {
    if (!CONFIG.urlState) return;
    var params = new URLSearchParams(location.search);
    var c = params.get('c') || '';
    if (c && CATEGORIES[c]) state.c = c;
    var s = params.get('s') || '';
    if (s && state.c && subcategoryOf(state.c, s)) state.s = s;
    var lang = params.get('lang') || '';
    if (lang && DATA.languages.indexOf(lang) >= 0) state.lang = lang;
    var loc = (params.get('loc') || '').toUpperCase();
    if (loc && DATA.countries.indexOf(loc) >= 0) state.loc = loc;
    var type = params.get('type') || '';
    if (type === 'articles' || type === 'videos') state.type = type;
    state.q = (params.get('q') || '').trim().slice(0, 200);
  }

  /** Mirror the filters into the address (hosted site only), without adding history entries. */
  function writeUrlState() {
    if (!CONFIG.urlState || !window.history || typeof history.replaceState !== 'function') return;
    var params = new URLSearchParams();
    if (state.c) params.set('c', state.c);
    if (state.s) params.set('s', state.s);
    if (state.lang) params.set('lang', state.lang);
    if (state.loc) params.set('loc', state.loc);
    if (state.type !== 'both') params.set('type', state.type);
    if (state.q) params.set('q', state.q);
    var query = params.toString();
    var url = location.pathname + (query ? '?' + query : '') + location.hash;
    try {
      history.replaceState(history.state, '', url);
    } catch (e) {
      // Some embeddings refuse address changes; the page still works.
    }
  }

  /** @returns {'feed'|'sources'|'about'} */
  function viewFromHash() {
    var hash = (location.hash || '').replace(/^#/, '');
    return hash === 'sources' || hash === 'about' ? hash : 'feed';
  }

  /** @returns {{lang?: string, loc?: string}|null} */
  function loadPrefs() {
    try {
      var raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * @param {{lang: string, loc: string}} prefs
   * @returns {boolean} false when the browser refused.
   */
  function savePrefs(prefs) {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      return window.localStorage.getItem(PREFS_KEY) !== null;
    } catch (e) {
      return false;
    }
  }

  // ------------------------------------------------------------------ elements

  var ribbonCategories = byId('ribbon-categories');
  var ribbonSubcategories = byId('ribbon-subcategories');
  var controlsWrap = find(document, '.controls-wrap');
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
  var feedList = byId('feed-list');
  var emptyState = byId('empty-state');
  var clearButton = byId('clear-filters');
  var resultCount = byId('result-count');
  var sentinel = byId('feed-sentinel');
  var showMore = byId('show-more');
  var sourcesSection = byId('sources-section');
  var sourcesBody = byId('sources-body');
  var sourcesEmpty = byId('sources-empty');
  var aboutSection = byId('about-section');
  var generatedAt = byId('generated-at');
  var mainEl = byId('main');
  var skipLink = find(document, '.skip-link');

  // ------------------------------------------------------------------ ribbons

  /**
   * @param {string} label
   * @param {boolean} pressed
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  function makeChip(label, pressed, onClick) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    chip.textContent = label;
    chip.addEventListener('click', onClick);
    return chip;
  }

  /**
   * @param {HTMLElement} ribbon
   * @param {string} activeId   data-id of the chip to mark.
   */
  function markActiveChip(ribbon, activeId) {
    var chips = ribbon.querySelectorAll('.chip');
    /** @type {HTMLElement|null} */
    var active = null;
    for (var i = 0; i < chips.length; i += 1) {
      var chip = /** @type {HTMLElement} */ (chips[i]);
      var pressed = (chip.getAttribute('data-id') || '') === activeId;
      chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (pressed) active = chip;
    }
    revealChip(ribbon, active);
  }

  /**
   * Scroll the ribbon sideways so the active chip is in view. Never scrolls the page.
   * @param {HTMLElement} ribbon
   * @param {HTMLElement|null} chip
   */
  function revealChip(ribbon, chip) {
    if (!chip) return;
    var ribbonRect = ribbon.getBoundingClientRect();
    var chipRect = chip.getBoundingClientRect();
    var left = chipRect.left - ribbonRect.left + ribbon.scrollLeft - (ribbonRect.width - chipRect.width) / 2;
    var target = Math.max(0, left);
    try {
      ribbon.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    } catch (e) {
      ribbon.scrollLeft = target;
    }
  }

  function renderCategoryRibbon() {
    clear(ribbonCategories);
    var all = makeChip(t('all'), state.c === '', function () { selectCategory(''); });
    all.setAttribute('data-id', '');
    ribbonCategories.appendChild(all);
    DATA.categories.forEach(function (category) {
      var chip = makeChip(nameOf(category), state.c === category.id, function () { selectCategory(category.id); });
      chip.setAttribute('data-id', category.id);
      ribbonCategories.appendChild(chip);
    });
  }

  function renderSubcategoryRibbon() {
    clear(ribbonSubcategories);
    var category = state.c ? CATEGORIES[state.c] : null;
    if (!category) {
      var hint = document.createElement('p');
      hint.className = 'ribbon-hint';
      hint.textContent = t('pickCategoryHint');
      ribbonSubcategories.appendChild(hint);
      return;
    }
    var all = makeChip(t('all'), state.s === '', function () { selectSubcategory(''); });
    all.setAttribute('data-id', '');
    ribbonSubcategories.appendChild(all);
    (category.subcategories || []).forEach(function (sub) {
      var chip = makeChip(nameOf(sub), state.s === sub.id, function () { selectSubcategory(sub.id); });
      chip.setAttribute('data-id', sub.id);
      ribbonSubcategories.appendChild(chip);
    });
  }

  /** @param {string} categoryId */
  function selectCategory(categoryId) {
    var changed = state.c !== categoryId;
    state.c = CATEGORIES[categoryId] ? categoryId : '';
    state.s = '';
    markActiveChip(ribbonCategories, state.c);
    renderSubcategoryRibbon();
    goToFeed();
    if (changed) refresh(true);
  }

  /** @param {string} subcategoryId */
  function selectSubcategory(subcategoryId) {
    var changed = state.s !== subcategoryId;
    state.s = subcategoryOf(state.c, subcategoryId) ? subcategoryId : '';
    markActiveChip(ribbonSubcategories, state.s);
    goToFeed();
    if (changed) refresh(true);
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
    typeLabel.textContent = t(TYPE_LABELS[state.type]);
    searchInput.value = state.q;
  }

  function cycleType() {
    var index = TYPE_CYCLE.indexOf(state.type);
    var next = TYPE_CYCLE[(index + 1) % TYPE_CYCLE.length];
    state.type = /** @type {'both'|'articles'|'videos'} */ (next);
    typeLabel.textContent = t(TYPE_LABELS[state.type]);
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
    markActiveChip(ribbonCategories, '');
    renderSubcategoryRibbon();
    syncControls();
    refresh(true);
  }

  // ------------------------------------------------------------------ cards

  /**
   * @param {FeedItem} item
   * @returns {boolean}
   */
  function matches(item) {
    var source = SOURCES[item.s];
    if (!source) return false;
    if (state.c && source.category !== state.c) return false;
    if (state.s && source.subcategory !== state.s) return false;
    if (state.lang && source.language !== state.lang) return false;
    if (state.loc && source.country !== state.loc) return false;
    if (state.type === 'articles' && item.ty !== 'a') return false;
    if (state.type === 'videos' && item.ty !== 'v') return false;
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
   * @param {FeedItem} item
   * @param {FeedSource} source
   * @param {number} nowMs
   * @returns {HTMLElement}
   */
  function renderArticle(item, source, nowMs) {
    var card = cloneTemplate('tpl-article');
    var link = /** @type {HTMLAnchorElement} */ (find(card, '.card-link'));
    link.href = item.l;
    link.textContent = item.t;
    find(card, '.card-source').textContent = source.name;
    fillTime(find(card, '.card-time'), item.p, nowMs);
    var thumb = /** @type {HTMLAnchorElement} */ (find(card, '.card-thumb'));
    var img = /** @type {HTMLImageElement} */ (find(card, '.card-img'));
    if (thumbSrc(item)) {
      thumb.href = item.l;
      // The title link already leads there, so the image link stays out of the tab order and the
      // screen-reader flow; the alt still describes the picture for everyone else.
      thumb.setAttribute('aria-hidden', 'true');
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
    return card;
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
    var link = /** @type {HTMLAnchorElement} */ (find(card, '.card-link'));
    link.href = watchUrl(item);
    link.textContent = item.t;
    find(card, '.card-source').textContent = source.name;
    fillTime(find(card, '.card-time'), item.p, nowMs);
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
    if (view !== 'feed' || shown >= filtered.length) return;
    var rect = sentinel.getBoundingClientRect();
    if (rect.top < window.innerHeight + 400) renderMore();
  }

  /**
   * Recompute the list from the current filters and render the first page.
   * @param {boolean} [scrollUp]   true when the visitor changed a filter.
   */
  function refresh(scrollUp) {
    searchWords = fold(state.q).split(/\s+/).filter(Boolean);
    filtered = ITEMS.filter(matches);
    shown = 0;
    clear(feedList);
    emptyState.hidden = filtered.length > 0;
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

  /**
   * @param {'feed'|'sources'|'about'} next
   * @param {boolean} moveFocus
   */
  function showView(next, moveFocus) {
    view = next;
    feedSection.hidden = next !== 'feed';
    sourcesSection.hidden = next !== 'sources';
    aboutSection.hidden = next !== 'about';
    controlsWrap.hidden = next !== 'feed';
    if (next === 'sources') renderSources();
    if (next === 'about') renderAbout();
    if (moveFocus) {
      var heading = next === 'sources' ? byId('sources-heading') : next === 'about' ? byId('about-heading') : mainEl;
      try {
        heading.focus({ preventScroll: true });
      } catch (e) {
        heading.focus();
      }
      window.scrollTo(0, 0);
    }
    if (next === 'feed' && observer) window.requestAnimationFrame(fillIfSentinelVisible);
  }

  /** Switch to the feed when a filter is used from the Sources or About section. */
  function goToFeed() {
    if (view === 'feed') return;
    if (location.hash && location.hash !== '#feed') {
      location.hash = 'feed';
    } else {
      showView('feed', false);
    }
  }

  // ------------------------------------------------------------------ profile panel

  var supportsDialog = typeof panel.showModal === 'function';

  function openPanel() {
    /** @type {{lang?: string, loc?: string}} */
    var prefs = loadPrefs() || {};
    prefLang.value = typeof prefs.lang === 'string' && DATA.languages.indexOf(prefs.lang) >= 0 ? prefs.lang : '';
    prefLoc.value = typeof prefs.loc === 'string' && DATA.countries.indexOf(prefs.loc) >= 0 ? prefs.loc : '';
    prefNote.textContent = '';
    if (supportsDialog) {
      if (!panel.open) panel.showModal();
    } else {
      panel.classList.add('panel-fallback');
      panel.setAttribute('open', '');
      document.addEventListener('keydown', onFallbackKeydown);
      document.addEventListener('click', onFallbackOutsideClick, true);
    }
    profileButton.setAttribute('aria-expanded', 'true');
    prefLang.focus();
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

  function onPanelClosed() {
    profileButton.setAttribute('aria-expanded', 'false');
    profileButton.focus();
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
    var ok = savePrefs({ lang: prefLang.value, loc: prefLoc.value });
    prefNote.textContent = ok ? t('saved') : t('prefsUnavailable');
  }

  // ------------------------------------------------------------------ wiring

  /** Keeps --header-h equal to the sticky header's height so focused cards scroll out from under it. */
  function trackHeaderHeight() {
    var found = /** @type {HTMLElement|null} */ (document.querySelector('.site-header'));
    if (!found) return;
    var header = found;
    var apply = function () { document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px'); };
    apply();
    if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(header);
    else window.addEventListener('resize', apply);
  }

  function init() {
    trackHeaderHeight();
    if (!document.documentElement.lang) document.documentElement.lang = UI_LANG;
    applyStrings(document);

    var hadFilters = hasFilterParams();
    readUrlState();
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
    renderSubcategoryRibbon();
    syncControls();

    langSelect.addEventListener('change', function () { state.lang = langSelect.value; refresh(true); });
    locSelect.addEventListener('change', function () { state.loc = locSelect.value; refresh(true); });
    typeButton.addEventListener('click', cycleType);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); applySearch(); });
    searchInput.addEventListener('search', applySearch);
    searchInput.addEventListener('input', function () { if (searchInput.value === '' && state.q) applySearch(); });
    clearButton.addEventListener('click', clearFilters);

    profileButton.addEventListener('click', function () {
      if (profileButton.getAttribute('aria-expanded') === 'true') closePanel();
      else openPanel();
    });
    profileClose.addEventListener('click', closePanel);
    prefSave.addEventListener('click', savePreferences);
    panel.addEventListener('close', onPanelClosed);
    panel.addEventListener('click', function (event) { if (event.target === panel) closePanel(); });
    var panelLinks = panel.querySelectorAll('.panel-link');
    for (var i = 0; i < panelLinks.length; i += 1) panelLinks[i].addEventListener('click', function () { closePanel(); });

    skipLink.addEventListener('click', function (event) {
      event.preventDefault();
      mainEl.focus();
    });
    window.addEventListener('hashchange', function () { showView(viewFromHash(), true); });

    setupInfiniteScroll();
    showView(viewFromHash(), false);
    refresh(false);
    markActiveChip(ribbonCategories, state.c);
    if (state.c) markActiveChip(ribbonSubcategories, state.s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
