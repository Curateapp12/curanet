/**
 * Category lookup and editing. The owner refers to categories by whatever they type ("News",
 * "actualités", "news/politics"), so every lookup accepts an id or a display name in English or
 * French, ignoring case, accents and extra spaces. Editing functions never change the input
 * document: they return a changed deep copy.
 */
import { slugify } from './sanitize.js';

/** @typedef {import('./types.js').Category} Category */
/** @typedef {import('./types.js').Subcategory} Subcategory */

/**
 * @typedef {Object} CategoriesDoc
 * @property {number} version
 * @property {Category[]} categories
 *
 * @typedef {Object} CategoryPath
 * @property {Category|null} category
 * @property {Subcategory|null} subcategory
 * @property {string[]} [ambiguous]   "category/subcategory" ids when a bare name matched several.
 */

/**
 * Comparable form of a name: no accents, no case, single spaces.
 * @param {unknown} text
 * @returns {string}
 */
function normalizeName(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * @param {unknown} doc
 * @returns {Category[]}
 */
function categoriesOf(doc) {
  if (!doc || typeof doc !== 'object') return [];
  const list = /** @type {any} */ (doc).categories;
  return Array.isArray(list) ? list.filter((c) => c && typeof c === 'object') : [];
}

/**
 * @param {unknown} category
 * @returns {Subcategory[]}
 */
function subcategoriesOf(category) {
  if (!category || typeof category !== 'object') return [];
  const list = /** @type {any} */ (category).subcategories;
  return Array.isArray(list) ? list.filter((s) => s && typeof s === 'object') : [];
}

/**
 * @param {Category|Subcategory} node
 * @param {string} query   Already normalised.
 * @returns {boolean}
 */
function matchesId(node, query) {
  return typeof node.id === 'string' && normalizeName(node.id) === query;
}

/**
 * @param {Category|Subcategory} node
 * @param {string} query   Already normalised.
 * @returns {boolean}
 */
function matchesName(node, query) {
  const name = node.name;
  if (!name || typeof name !== 'object') return false;
  return normalizeName(name.en) === query || (name.fr !== undefined && normalizeName(name.fr) === query);
}

/**
 * Find a node by id first, then by English or French name.
 * @template {Category|Subcategory} T
 * @param {T[]} nodes
 * @param {unknown} idOrName
 * @returns {T|null}
 */
function findNode(nodes, idOrName) {
  const query = normalizeName(idOrName);
  if (!query) return null;
  return nodes.find((node) => matchesId(node, query)) || nodes.find((node) => matchesName(node, query)) || null;
}

/**
 * Find a category by id, or by its English or French name (case, accents and spacing ignored).
 * @param {unknown} categoriesDoc   The parsed categories.json.
 * @param {unknown} idOrName
 * @returns {Category|null}
 */
export function findCategory(categoriesDoc, idOrName) {
  return findNode(categoriesOf(categoriesDoc), idOrName);
}

/**
 * Find a subcategory of one category by id, or by its English or French name.
 * @param {unknown} category
 * @param {unknown} idOrName
 * @returns {Subcategory|null}
 */
export function findSubcategory(category, idOrName) {
  return findNode(subcategoriesOf(category), idOrName);
}

/**
 * Resolve text such as "News / Politics", "news/politics", "Politics" or "News" to the matching
 * category and subcategory. A bare name is tried as a category first, then as a subcategory
 * anywhere in the tree; when several subcategories share that name the result has both nodes set
 * to null and lists the candidates in `ambiguous` ("news/politics", "business/politics").
 * @param {unknown} categoriesDoc
 * @param {unknown} text
 * @returns {CategoryPath|null}  null when nothing matches.
 */
export function resolveCategoryPath(categoriesDoc, text) {
  if (typeof text !== 'string') return null;
  const parts = text.split(/[/>›»]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return null;
  if (parts.length === 2) {
    const category = findCategory(categoriesDoc, parts[0]);
    if (!category) return null;
    const subcategory = findSubcategory(category, parts[1]);
    return subcategory ? { category, subcategory } : null;
  }
  const category = findCategory(categoriesDoc, parts[0]);
  if (category) return { category, subcategory: null };
  /** @type {{category: Category, subcategory: Subcategory}[]} */
  const hits = [];
  for (const candidate of categoriesOf(categoriesDoc)) {
    const subcategory = findSubcategory(candidate, parts[0]);
    if (subcategory) hits.push({ category: candidate, subcategory });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  return { category: null, subcategory: null, ambiguous: hits.map((hit) => `${hit.category.id}/${hit.subcategory.id}`) };
}

/**
 * Display name of a category or subcategory in the given language, falling back to English.
 * @param {Category|Subcategory|null|undefined} catOrSub
 * @param {string} [lang]
 * @returns {string}
 */
export function categoryName(catOrSub, lang = 'en') {
  if (!catOrSub || typeof catOrSub !== 'object' || !catOrSub.name) return '';
  const names = /** @type {Record<string, unknown>} */ (catOrSub.name);
  const wanted = names[lang];
  if (typeof wanted === 'string' && wanted) return wanted;
  return typeof names.en === 'string' ? names.en : '';
}

/**
 * Id for a new category from its display name: "Économie & Finance" becomes "economie-finance".
 * Returns '' when the name has nothing usable (slugify would otherwise fall back to "source").
 * @param {unknown} name
 * @returns {string}
 */
export function makeId(name) {
  const text = typeof name === 'string' ? name : '';
  const usable = text.normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '');
  return usable ? slugify(text) : '';
}

/**
 * @param {unknown} doc
 * @returns {CategoriesDoc}
 */
function cloneDoc(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(/** @type {any} */ (doc).categories)) {
    throw new Error('The categories file is not usable: it needs a "categories" list.');
  }
  return structuredClone(/** @type {CategoriesDoc} */ (doc));
}

/**
 * @param {unknown} name
 * @returns {string}
 */
function requireName(name) {
  const text = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!text) throw new Error('A category needs a name.');
  return text;
}

/**
 * @param {string} name
 * @param {unknown} nameFr
 * @returns {{en: string, fr?: string}}
 */
function makeNames(name, nameFr) {
  const fr = typeof nameFr === 'string' ? nameFr.trim().replace(/\s+/g, ' ') : '';
  return fr ? { en: name, fr } : { en: name };
}

/**
 * @param {CategoriesDoc} doc
 * @param {unknown} parentId
 * @returns {Category}
 */
function requireParent(doc, parentId) {
  const parent = findCategory(doc, parentId);
  if (!parent) throw new Error(`No category called "${String(parentId)}" exists. Check the spelling or add it first.`);
  return parent;
}

/**
 * Add a category, or a subcategory when `parentId` names an existing category (by id or name).
 * Returns a changed deep copy; the input document is left untouched.
 * @param {unknown} categoriesDoc
 * @param {{name: string, nameFr?: string|null, parentId?: string|null}} input
 * @returns {CategoriesDoc}
 * @throws {Error} plain-language message when the name is empty, already used, or the parent is unknown.
 */
export function addCategory(categoriesDoc, input) {
  const doc = cloneDoc(categoriesDoc);
  const name = requireName(input && input.name);
  const id = makeId(name);
  if (!id) throw new Error(`The name "${name}" has no letters or digits to make an id from.`);
  const names = makeNames(name, input.nameFr);
  if (input.parentId) {
    const parent = requireParent(doc, input.parentId);
    const clash = findSubcategory(parent, id) || findSubcategory(parent, name) || (names.fr && findSubcategory(parent, names.fr));
    if (clash) throw new Error(`"${categoryName(parent)}" already has a subcategory "${categoryName(clash)}" (id "${clash.id}").`);
    if (!Array.isArray(parent.subcategories)) parent.subcategories = [];
    parent.subcategories.push({ id, name: names });
    return doc;
  }
  const clash = findCategory(doc, id) || findCategory(doc, name) || (names.fr && findCategory(doc, names.fr));
  if (clash) throw new Error(`A category "${categoryName(clash)}" (id "${clash.id}") already exists.`);
  doc.categories.push({ id, name: names, subcategories: [] });
  return doc;
}

/**
 * Rename a category, or a subcategory when `parentId` is given. Only the display names change:
 * ids never change, because every source in sources.json points at a category by its id and the
 * site's filter links do too. Pass `nameFr: ''` to drop the French name. Returns a changed deep
 * copy; the input document is left untouched.
 * @param {unknown} categoriesDoc
 * @param {{id: string, parentId?: string|null, name?: string|null, nameFr?: string|null}} input
 * @returns {CategoriesDoc}
 * @throws {Error} plain-language message when the category is unknown, nothing is given to rename,
 *   or the new name is already used by a sibling.
 */
export function renameCategory(categoriesDoc, input) {
  const doc = cloneDoc(categoriesDoc);
  const hasName = typeof input.name === 'string' && input.name.trim() !== '';
  const hasFrench = typeof input.nameFr === 'string' || input.nameFr === null;
  if (!hasName && !hasFrench) throw new Error('Nothing to rename: give a new English name, a new French name, or both.');

  /** @type {Category|Subcategory|null} */
  let node;
  /** @type {(Category|Subcategory)[]} */
  let siblings;
  if (input.parentId) {
    const parent = requireParent(doc, input.parentId);
    node = findSubcategory(parent, input.id);
    if (!node) throw new Error(`"${categoryName(parent)}" has no subcategory called "${String(input.id)}".`);
    siblings = subcategoriesOf(parent);
  } else {
    node = findCategory(doc, input.id);
    if (!node) throw new Error(`No category called "${String(input.id)}" exists.`);
    siblings = categoriesOf(doc);
  }

  const target = node;
  const others = siblings.filter((sibling) => sibling !== target);
  const newEn = hasName ? requireName(input.name) : target.name.en;
  const newFr = hasFrench ? (typeof input.nameFr === 'string' ? input.nameFr.trim().replace(/\s+/g, ' ') : '') : target.name.fr;
  for (const candidate of [newEn, newFr]) {
    if (!candidate) continue;
    const clash = findNode(others, candidate);
    if (clash) throw new Error(`The name "${candidate}" is already used by "${categoryName(clash)}" (id "${clash.id}").`);
  }
  target.name = newFr ? { en: newEn, fr: newFr } : { en: newEn };
  return doc;
}
