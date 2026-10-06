#!/usr/bin/env node
/**
 * Manage the category tree.
 *
 *   node scripts/category.js list
 *   node scripts/category.js add "<Name>" [--fr "<Nom>"] [--parent "<Category>"]
 *   node scripts/category.js rename "<Category [/ Subcategory]>" [--name "<New name>"] [--fr "<Nouveau nom>"]
 */
import { parseArgs, fail, formatTree } from '../src/lib/cli.js';
import { dataPaths, loadCategories, writeJson } from '../src/lib/store.js';
import { addCategory, renameCategory, resolveCategoryPath, findCategory } from '../src/lib/categories.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const dataDir = String(flags.data || 'data');
const [command, text] = positional;
const doc = loadCategories(dataDir);

try {
  if (!command || command === 'list') {
    console.log(formatTree(doc));
  } else if (command === 'add') {
    if (!text) throw new Error('give the new name, e.g. add "Robotics" --parent "Technology".');
    let name = text;
    let parentId;
    if (flags.parent) {
      const parent = findCategory(doc, String(flags.parent));
      if (!parent) throw new Error(`no category named "${flags.parent}".`);
      parentId = parent.id;
    } else if (text.includes('/')) {
      const [parentText, childText] = text.split('/').map((s) => s.trim());
      const parent = findCategory(doc, parentText);
      if (!parent) throw new Error(`no category named "${parentText}".`);
      parentId = parent.id;
      name = childText;
    }
    const next = addCategory(doc, { name, nameFr: flags.fr ? String(flags.fr) : undefined, parentId });
    writeJson(dataPaths(dataDir).categories, next);
    console.log(parentId ? `Added subcategory "${name}" under ${parentId}.` : `Added category "${name}".`);
    console.log(formatTree(next));
  } else if (command === 'rename') {
    if (!text) throw new Error('give the category (or "Category / Subcategory") to rename.');
    if (!flags.name && !flags.fr) throw new Error('pass --name and/or --fr with the new name.');
    const path = resolveCategoryPath(doc, text);
    let next;
    if (path && path.category && path.subcategory && text.includes('/')) {
      next = renameCategory(doc, { id: path.subcategory.id, parentId: path.category.id, name: flags.name ? String(flags.name) : undefined, nameFr: flags.fr ? String(flags.fr) : undefined });
    } else {
      const cat = findCategory(doc, text);
      if (!cat) throw new Error(`no category named "${text}".`);
      next = renameCategory(doc, { id: cat.id, name: flags.name ? String(flags.name) : undefined, nameFr: flags.fr ? String(flags.fr) : undefined });
    }
    writeJson(dataPaths(dataDir).categories, next);
    console.log(`Renamed "${text}"${flags.name ? ` → "${flags.name}"` : ''}${flags.fr ? ` (fr: "${flags.fr}")` : ''}. Ids are unchanged, so sources keep their place.`);
  } else {
    throw new Error(`unknown command "${command}". Use list, add or rename.`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
