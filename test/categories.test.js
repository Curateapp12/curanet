import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCategory,
  findSubcategory,
  resolveCategoryPath,
  categoryName,
  makeId,
  addCategory,
  renameCategory,
} from '../src/lib/categories.js';

/** A small tree with an ambiguous subcategory name ("Politics" under news and under business). */
function sampleDoc() {
  return {
    version: 1,
    categories: [
      {
        id: 'news',
        name: { en: 'News', fr: 'Actualités' },
        subcategories: [
          { id: 'top-stories', name: { en: 'Top Stories', fr: 'À la une' } },
          { id: 'politics', name: { en: 'Politics', fr: 'Politique' } },
        ],
      },
      {
        id: 'business',
        name: { en: 'Business', fr: 'Affaires' },
        subcategories: [
          { id: 'economy', name: { en: 'Economy', fr: 'Économie' } },
          { id: 'politics', name: { en: 'Politics', fr: 'Politique' } },
        ],
      },
      { id: 'culture', name: { en: 'Culture' }, subcategories: [] },
    ],
  };
}

test('findCategory matches by id, English name and French name', () => {
  const doc = sampleDoc();
  assert.equal(findCategory(doc, 'news')?.id, 'news');
  assert.equal(findCategory(doc, 'News')?.id, 'news');
  assert.equal(findCategory(doc, 'Actualités')?.id, 'news');
  assert.equal(findCategory(doc, 'Affaires')?.id, 'business');
});

test('findCategory ignores case, accents and extra spaces', () => {
  const doc = sampleDoc();
  assert.equal(findCategory(doc, 'ACTUALITÉS')?.id, 'news');
  assert.equal(findCategory(doc, 'actualites')?.id, 'news');
  assert.equal(findCategory(doc, '  Actualités  ')?.id, 'news');
  assert.equal(findCategory(doc, 'NEWS')?.id, 'news');
});

test('findCategory returns null for unknown or empty input and bad documents', () => {
  const doc = sampleDoc();
  assert.equal(findCategory(doc, 'nope'), null);
  assert.equal(findCategory(doc, ''), null);
  assert.equal(findCategory(doc, '   '), null);
  assert.equal(findCategory(doc, null), null);
  assert.equal(findCategory(doc, undefined), null);
  assert.equal(findCategory(null, 'news'), null);
  assert.equal(findCategory({ version: 1 }, 'news'), null);
});

test('findSubcategory matches "Économie" against "economie" and other spellings', () => {
  const business = findCategory(sampleDoc(), 'business');
  assert.ok(business);
  assert.equal(findSubcategory(business, 'Économie')?.id, 'economy');
  assert.equal(findSubcategory(business, 'economie')?.id, 'economy');
  assert.equal(findSubcategory(business, 'ECONOMIE')?.id, 'economy');
  assert.equal(findSubcategory(business, 'economy')?.id, 'economy');
  assert.equal(findSubcategory(business, 'Economy')?.id, 'economy');
  assert.equal(findSubcategory(business, 'markets'), null);
  assert.equal(findSubcategory(null, 'economy'), null);
  assert.equal(findSubcategory({ id: 'x', name: { en: 'X' } }, 'economy'), null);
});

test('resolveCategoryPath reads "Category / Subcategory" in English, French or by id', () => {
  const doc = sampleDoc();
  const a = resolveCategoryPath(doc, 'News / Politics');
  assert.equal(a?.category?.id, 'news');
  assert.equal(a?.subcategory?.id, 'politics');
  const b = resolveCategoryPath(doc, 'news/politics');
  assert.equal(b?.category?.id, 'news');
  assert.equal(b?.subcategory?.id, 'politics');
  const c = resolveCategoryPath(doc, 'Actualités / Politique');
  assert.equal(c?.category?.id, 'news');
  assert.equal(c?.subcategory?.id, 'politics');
  const d = resolveCategoryPath(doc, 'affaires / economie');
  assert.equal(d?.category?.id, 'business');
  assert.equal(d?.subcategory?.id, 'economy');
});

test('resolveCategoryPath resolves a bare subcategory name when it is unique', () => {
  const doc = sampleDoc();
  for (const text of ['Economy', 'Économie', 'economie', 'economy']) {
    const found = resolveCategoryPath(doc, text);
    assert.equal(found?.category?.id, 'business', text);
    assert.equal(found?.subcategory?.id, 'economy', text);
    assert.equal(found?.ambiguous, undefined, text);
  }
  const top = resolveCategoryPath(doc, 'à la une');
  assert.equal(top?.category?.id, 'news');
  assert.equal(top?.subcategory?.id, 'top-stories');
});

test('resolveCategoryPath reports an ambiguous bare subcategory name', () => {
  const found = resolveCategoryPath(sampleDoc(), 'Politics');
  assert.deepEqual(found, { category: null, subcategory: null, ambiguous: ['news/politics', 'business/politics'] });
  const fr = resolveCategoryPath(sampleDoc(), 'politique');
  assert.deepEqual(fr?.ambiguous, ['news/politics', 'business/politics']);
});

test('resolveCategoryPath returns the category alone for a bare category name', () => {
  const found = resolveCategoryPath(sampleDoc(), 'News');
  assert.equal(found?.category?.id, 'news');
  assert.equal(found?.subcategory, null);
  assert.equal(found?.ambiguous, undefined);
});

test('resolveCategoryPath returns null when nothing matches', () => {
  const doc = sampleDoc();
  assert.equal(resolveCategoryPath(doc, 'Nope'), null);
  assert.equal(resolveCategoryPath(doc, 'News / Nope'), null);
  assert.equal(resolveCategoryPath(doc, 'Nope / Politics'), null);
  assert.equal(resolveCategoryPath(doc, 'a / b / c'), null);
  assert.equal(resolveCategoryPath(doc, ''), null);
  assert.equal(resolveCategoryPath(doc, null), null);
  assert.equal(resolveCategoryPath(null, 'News'), null);
});

test('categoryName returns the requested language and falls back to English', () => {
  const doc = sampleDoc();
  const news = findCategory(doc, 'news');
  const culture = findCategory(doc, 'culture');
  assert.equal(categoryName(news), 'News');
  assert.equal(categoryName(news, 'fr'), 'Actualités');
  assert.equal(categoryName(culture, 'fr'), 'Culture');
  assert.equal(categoryName(news, 'de'), 'News');
  assert.equal(categoryName(findSubcategory(news, 'politics'), 'fr'), 'Politique');
  assert.equal(categoryName(null), '');
});

test('makeId turns a display name into a slug', () => {
  assert.equal(makeId('Économie & Finance'), 'economie-finance');
  assert.equal(makeId('  Top Stories '), 'top-stories');
  assert.equal(makeId('Science'), 'science');
  assert.equal(makeId(''), '');
  assert.equal(makeId('!!!'), '');
});

test('addCategory appends a category without changing the original document', () => {
  const doc = sampleDoc();
  const before = JSON.stringify(doc);
  const next = addCategory(doc, { name: 'Sports', nameFr: 'Sports' });
  assert.equal(JSON.stringify(doc), before, 'original document must not change');
  assert.equal(next.categories.length, 4);
  assert.deepEqual(next.categories[3], { id: 'sports', name: { en: 'Sports', fr: 'Sports' }, subcategories: [] });
  const noFrench = addCategory(doc, { name: 'Life' });
  assert.deepEqual(noFrench.categories[3], { id: 'life', name: { en: 'Life' }, subcategories: [] });
});

test('addCategory appends a subcategory to a parent given by id or by name', () => {
  const doc = sampleDoc();
  const byId = addCategory(doc, { name: 'Markets', nameFr: 'Marchés', parentId: 'business' });
  assert.deepEqual(byId.categories[1].subcategories[2], { id: 'markets', name: { en: 'Markets', fr: 'Marchés' } });
  assert.equal(doc.categories[1].subcategories.length, 2, 'original document must not change');
  const byName = addCategory(doc, { name: 'Markets', parentId: 'Affaires' });
  assert.equal(byName.categories[1].subcategories[2].id, 'markets');
});

test('addCategory refuses duplicates, unknown parents and empty names with plain messages', () => {
  const doc = sampleDoc();
  assert.throws(() => addCategory(doc, { name: 'News' }), /already/);
  assert.throws(() => addCategory(doc, { name: 'actualites' }), /already/);
  assert.throws(() => addCategory(doc, { name: 'Politics', parentId: 'news' }), /already/);
  assert.throws(() => addCategory(doc, { name: 'Économie', parentId: 'business' }), /already/);
  assert.throws(() => addCategory(doc, { name: 'Markets', parentId: 'nope' }), /No category called "nope"/);
  assert.throws(() => addCategory(doc, { name: '' }), /name/);
  assert.throws(() => addCategory(doc, { name: '   ' }), /name/);
  assert.throws(() => addCategory(doc, { name: '???' }), /id/);
  assert.throws(() => addCategory(null, { name: 'News' }), /categories/);
});

test('renameCategory changes display names only and never the id', () => {
  const doc = sampleDoc();
  const before = JSON.stringify(doc);
  const next = renameCategory(doc, { id: 'news', name: 'Headlines', nameFr: 'Manchettes' });
  assert.equal(JSON.stringify(doc), before, 'original document must not change');
  assert.deepEqual(next.categories[0].name, { en: 'Headlines', fr: 'Manchettes' });
  assert.equal(next.categories[0].id, 'news');
  assert.equal(next.categories[0].subcategories.length, 2);

  const onlyFrench = renameCategory(doc, { id: 'culture', nameFr: 'Culture et arts' });
  assert.deepEqual(onlyFrench.categories[2].name, { en: 'Culture', fr: 'Culture et arts' });

  const dropFrench = renameCategory(doc, { id: 'news', nameFr: '' });
  assert.deepEqual(dropFrench.categories[0].name, { en: 'News' });
});

test('renameCategory renames a subcategory inside its parent', () => {
  const doc = sampleDoc();
  const next = renameCategory(doc, { id: 'economy', parentId: 'business', name: 'The Economy' });
  assert.deepEqual(next.categories[1].subcategories[0], { id: 'economy', name: { en: 'The Economy', fr: 'Économie' } });
  assert.equal(doc.categories[1].subcategories[0].name.en, 'Economy', 'original document must not change');
});

test('renameCategory refuses unknown ids, empty renames and name clashes', () => {
  const doc = sampleDoc();
  assert.throws(() => renameCategory(doc, { id: 'nope', name: 'X' }), /No category called "nope"/);
  assert.throws(() => renameCategory(doc, { id: 'nope', parentId: 'news', name: 'X' }), /no subcategory/);
  assert.throws(() => renameCategory(doc, { id: 'economy', parentId: 'nope', name: 'X' }), /No category called "nope"/);
  assert.throws(() => renameCategory(doc, { id: 'news' }), /Nothing to rename/);
  assert.throws(() => renameCategory(doc, { id: 'news', name: 'Business' }), /already/);
  assert.throws(() => renameCategory(doc, { id: 'economy', parentId: 'business', name: 'Politics' }), /already/);
});
