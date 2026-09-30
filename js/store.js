/* In-memory app state mirrored to IndexedDB. Views read SA.store.state and call mutators; mutators persist and emit 'change'. */
(function (SA) {
  'use strict';
  const D = SA.defaults;

  const state = { transactions: [], rules: [], mappings: [], imports: [], settings: null };
  const listeners = new Set();
  let byId = new Map();

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit(what) { for (const fn of listeners) fn(what); }
  function reindex() { byId = new Map(state.transactions.map((t) => [t.id, t])); }

  async function load() {
    const [transactions, rules, mappings, imports, settings] = await Promise.all([
      SA.db.getAll('transactions'), SA.db.getAll('rules'), SA.db.getAll('mappings'), SA.db.getAll('imports'),
      SA.db.get('settings', 'settings'),
    ]);
    Object.assign(state, { transactions, rules, mappings, imports });
    state.settings = Object.assign(D.defaultSettings(), settings || {});
    state.transactions.sort(byDateDesc);
    reindex();
    // Data from an older version (settings may never have been saved) is re-categorized under the current engine.
    if (!(settings && settings.schema >= D.SETTINGS_SCHEMA) && (settings || transactions.length)) await migrateSettings();
  }

  // Existing installs pick up categories added to the defaults, then re-run categorization under the new engine.
  async function migrateSettings() {
    const s = state.settings;
    if (!s.categories.includes(D.REWARDS)) {
      s.categories.splice(Math.max(0, s.categories.indexOf(D.PAYMENTS)), 0, D.REWARDS);
      if (!s.excludedCategories.includes(D.REWARDS)) s.excludedCategories.push(D.REWARDS);
    }
    s.schema = D.SETTINGS_SCHEMA;
    await SA.db.put('settings', s, 'settings');
    await recategorizeAll();
  }

  function byDateDesc(a, b) { return b.date < a.date ? -1 : b.date > a.date ? 1 : a.description.localeCompare(b.description); }

  function ctx() { return SA.rules.buildContext(state.rules, state.settings, state.transactions); }
  function excludedSet() { return new Set(state.settings.excludedCategories); }
  function getTxn(id) { return byId.get(id); }

  // Settings order first, then any categories only present on transactions (e.g. unmapped issuer categories).
  function categories() {
    const list = state.settings.categories.slice();
    const seen = new Set(list);
    const extra = new Set();
    for (const t of state.transactions) if (t.category && !seen.has(t.category)) extra.add(t.category);
    for (const r of state.rules) if (!seen.has(r.category)) extra.add(r.category);
    return list.concat([...extra].sort());
  }

  function accounts() { return [...new Set(state.transactions.map((t) => t.account))].sort(); }

  async function saveSettings(patch) {
    Object.assign(state.settings, patch);
    await SA.db.put('settings', state.settings, 'settings');
    emit('settings');
  }

  // Two passes: the second lets "learned" categories see what the first pass assigned via rules/issuers.
  async function recategorizeAll() {
    const changed = new Set(SA.rules.recategorize(state.transactions, ctx()));
    for (const t of SA.rules.recategorize(state.transactions, ctx())) changed.add(t);
    await SA.db.putMany('transactions', [...changed]);
    return changed.size;
  }

  function findMapping(signature) { return state.mappings.find((m) => m.signature === signature) || null; }

  /** Adds new transactions (skipping ids already stored), records the import and remembers the mapping. */
  async function importTransactions(txns, meta, mapping) {
    const c = ctx();
    const fresh = [];
    let duplicates = 0;
    const seen = new Set();
    for (const t of txns) {
      if (byId.has(t.id) || seen.has(t.id)) { duplicates++; continue; }
      seen.add(t.id);
      Object.assign(t, SA.rules.categorize(t, c));
      fresh.push(t);
    }
    const record = Object.assign({}, meta, { added: fresh.length, duplicates, importedAt: new Date().toISOString() });
    await SA.db.putMany('transactions', fresh);
    await SA.db.put('imports', record);
    await SA.db.put('mappings', mapping);
    state.transactions.push(...fresh);
    state.transactions.sort(byDateDesc);
    state.imports.push(record);
    const i = state.mappings.findIndex((m) => m.id === mapping.id);
    i >= 0 ? (state.mappings[i] = mapping) : state.mappings.push(mapping);
    reindex();
    // New issuer categories can teach merchants on cards that have no category column, in either direction.
    await recategorizeAll();
    emit('transactions');
    return record;
  }

  async function deleteImport(importId) {
    const doomed = state.transactions.filter((t) => t.importId === importId).map((t) => t.id);
    await SA.db.delMany('transactions', doomed);
    await SA.db.del('imports', importId);
    state.transactions = state.transactions.filter((t) => t.importId !== importId);
    state.imports = state.imports.filter((i) => i.id !== importId);
    reindex();
    emit('transactions');
    return doomed.length;
  }

  /** category=null resets the transaction to automatic categorization. */
  async function setCategory(txnId, category) {
    const t = byId.get(txnId);
    if (!t) return;
    if (category == null) {
      t.categorySource = null;
      Object.assign(t, SA.rules.categorize(t, ctx()));
    } else {
      Object.assign(t, { category, categorySource: 'manual', ruleId: null });
    }
    await SA.db.put('transactions', t);
    emit('transactions');
  }

  /**
   * Upserts a rule and re-runs categorization. `releaseTxnIds` are manually-categorized transactions that should
   * hand control to this rule (the one the user just recategorized when they chose "save as rule").
   */
  async function saveRule(rule, releaseTxnIds) {
    rule = Object.assign({ createdAt: new Date().toISOString() }, rule, { id: rule.id || SA.util.uid('r') });
    await SA.db.put('rules', rule);
    const i = state.rules.findIndex((r) => r.id === rule.id);
    i >= 0 ? (state.rules[i] = rule) : state.rules.push(rule);
    for (const id of releaseTxnIds || []) {
      const t = byId.get(id);
      if (t && t.categorySource === 'manual' && t.category === rule.category && SA.rules.ruleMatches(rule, t)) t.categorySource = null;
    }
    const changed = await recategorizeAll();
    emit('rules');
    return { rule, changed };
  }

  async function deleteRule(id) {
    await SA.db.del('rules', id);
    state.rules = state.rules.filter((r) => r.id !== id);
    const changed = await recategorizeAll();
    emit('rules');
    return changed;
  }

  // Preview helper: how many non-manual transactions would a rule move to a different category?
  function ruleImpact(rule) {
    let matches = 0, changes = 0;
    for (const t of state.transactions) {
      if (!SA.rules.ruleMatches(rule, t)) continue;
      matches++;
      if (t.categorySource !== 'manual' && t.categorySource !== 'payment' && t.category !== rule.category) changes++; // rules beat reward/issuer/learned
    }
    return { matches, changes };
  }

  async function setIssuerMapping(issuerCat, category) {
    const map = Object.assign({}, state.settings.issuerCategoryMap);
    const key = issuerCat.trim().toLowerCase();
    if (category) map[key] = category; else delete map[key];
    await saveSettings({ issuerCategoryMap: map });
    await recategorizeAll();
    emit('transactions');
  }

  async function addCategory(name) {
    name = name.trim();
    if (!name || state.settings.categories.includes(name)) return false;
    await saveSettings({ categories: state.settings.categories.concat(name) });
    return true;
  }

  async function renameCategory(from, to) {
    to = to.trim();
    if (!to || from === to) return;
    const s = state.settings;
    const cats = s.categories.includes(to) ? s.categories.filter((c) => c !== from) : s.categories.map((c) => (c === from ? to : c));
    const map = {};
    for (const [k, v] of Object.entries(s.issuerCategoryMap)) map[k] = v === from ? to : v;
    // Unmapped issuer categories pass through verbatim, so renaming one means adding a mapping for it.
    for (const t of state.transactions) {
      if (t.category === from && t.categorySource === 'issuer' && t.issuerCategory) map[t.issuerCategory.trim().toLowerCase()] = to;
    }
    const excluded = s.excludedCategories.map((c) => (c === from ? to : c));
    await saveSettings({ categories: cats, issuerCategoryMap: map, excludedCategories: [...new Set(excluded)] });
    const rules = state.rules.filter((r) => r.category === from);
    for (const r of rules) r.category = to;
    await SA.db.putMany('rules', rules);
    const txns = state.transactions.filter((t) => t.category === from);
    for (const t of txns) t.category = to;
    await SA.db.putMany('transactions', txns);
    await recategorizeAll();
    emit('transactions');
  }

  /** Removes a category; its rules are deleted and its transactions fall back to automatic categorization. */
  async function deleteCategory(name) {
    const s = state.settings;
    const map = {};
    for (const [k, v] of Object.entries(s.issuerCategoryMap)) if (v !== name) map[k] = v;
    await saveSettings({
      categories: s.categories.filter((c) => c !== name),
      excludedCategories: s.excludedCategories.filter((c) => c !== name),
      issuerCategoryMap: map,
    });
    const doomedRules = state.rules.filter((r) => r.category === name).map((r) => r.id);
    await SA.db.delMany('rules', doomedRules);
    state.rules = state.rules.filter((r) => r.category !== name);
    for (const t of state.transactions) if (t.category === name && t.categorySource === 'manual') t.categorySource = null;
    await SA.db.putMany('transactions', state.transactions.filter((t) => t.category === name));
    await recategorizeAll();
    // Anything still landing on the deleted name (e.g. a verbatim issuer category) becomes Uncategorized.
    const leftovers = state.transactions.filter((t) => t.category === name);
    for (const t of leftovers) Object.assign(t, { category: D.UNCATEGORIZED, categorySource: 'none', ruleId: null });
    await SA.db.putMany('transactions', leftovers);
    emit('transactions');
  }

  async function setExcluded(name, excluded) {
    const set = new Set(state.settings.excludedCategories);
    excluded ? set.add(name) : set.delete(name);
    await saveSettings({ excludedCategories: [...set] });
  }

  async function exportBackup() { return SA.db.exportAll(); }

  async function restoreBackup(data, mode) {
    await SA.db.importAll(data, mode);
    await load();
    emit('all');
  }

  async function clearAll() {
    await SA.db.clearAll();
    await load();
    emit('all');
  }

  SA.store = {
    state, load, onChange, ctx, excludedSet, getTxn, categories, accounts, saveSettings, recategorizeAll, findMapping,
    importTransactions, deleteImport, setCategory, saveRule, deleteRule, ruleImpact, setIssuerMapping,
    addCategory, renameCategory, deleteCategory, setExcluded, exportBackup, restoreBackup, clearAll,
  };
})(window.SA = window.SA || {});
