/*
 * Categorization engine. Precedence, highest first:
 *   1. manual     - the user picked a category for this transaction
 *   2. payment    - money in whose description/type says it's a card payment
 *   3. rule       - user merchant rules; most specific wins (equals > starts with > contains > regex, then longer pattern)
 *   4. reward     - money in that looks like a rewards redemption or card-perk credit
 *   5. issuer     - issuer's category column, translated through the issuer-category map
 *   6. learned    - the category this merchant most often has on other transactions (for issuers with no category column)
 *   7. keyword    - a guess from the merchant name (restaurant POS prefixes, chains, words like TAVERN or PARKING)
 *   8. none       - Uncategorized
 */
(function (SA) {
  'use strict';
  const D = SA.defaults;

  const MATCH_RANK = { equals: 0, startsWith: 1, contains: 2, regex: 3 };
  const regexCache = new Map();

  function compileRegex(pattern) {
    if (!regexCache.has(pattern)) {
      let re = null;
      try { re = new RegExp(pattern, 'i'); } catch (e) { re = null; }
      regexCache.set(pattern, re);
    }
    return regexCache.get(pattern);
  }

  function sortRules(rules) {
    return rules.slice().sort((a, b) =>
      (MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType]) ||
      (b.pattern.length - a.pattern.length) ||
      String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function ruleMatches(rule, txn) {
    const text = String(rule.field === 'description' ? txn.description : txn.merchant).toLowerCase();
    const p = String(rule.pattern || '').toLowerCase().trim();
    if (!p) return false;
    switch (rule.matchType) {
      case 'equals': return text === p;
      case 'startsWith': return text.startsWith(p);
      case 'contains': return text.includes(p);
      case 'regex': { const re = compileRegex(rule.pattern); return !!re && re.test(text); }
      default: return false;
    }
  }

  // Amex-style "Group-Subgroup" strings try the subgroup, then the group.
  function mapIssuerCategory(issuerCat, map) {
    if (!issuerCat) return null;
    const key = issuerCat.trim().toLowerCase();
    if (map[key]) return map[key];
    if (key.includes('-')) {
      const parts = key.split('-').map((s) => s.trim()).filter(Boolean);
      for (const p of parts.reverse()) if (map[p]) return map[p];
    }
    return null;
  }

  function isStrongPayment(txn) {
    return txn.amount < 0 && (D.PAYMENT_TYPE.test(txn.issuerType || '') || D.PAYMENT_DESC.test(txn.description || ''));
  }

  // Learned categories come only from manual/rule/issuer sources, never from other learned ones, so they can't drift.
  const TEACHING_SOURCES = new Set(['manual', 'rule', 'issuer']);
  function learnMerchants(txns, excluded) {
    const counts = new Map();
    for (const t of txns || []) {
      if (!TEACHING_SOURCES.has(t.categorySource) || excluded.has(t.category) || t.category === D.UNCATEGORIZED) continue;
      const key = t.merchant.toLowerCase();
      const m = counts.get(key) || new Map();
      m.set(t.category, (m.get(t.category) || 0) + 1);
      counts.set(key, m);
    }
    const learned = new Map();
    for (const [k, m] of counts) learned.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    return learned;
  }

  function buildContext(rules, settings, txns) {
    const excluded = new Set(settings.excludedCategories || []);
    return { rules: sortRules(rules), issuerMap: settings.issuerCategoryMap || {}, learned: learnMerchants(txns, excluded),
      categories: new Set(settings.categories || D.CATEGORIES) };
  }

  // Guesses only land in categories the user still has (a renamed or deleted default is skipped).
  function guessCategory(txn, categories) {
    const text = (txn.merchant + ' | ' + (txn.description || '')).toUpperCase();
    for (const [re, cat] of D.KEYWORD_CATEGORIES) {
      if (re.test(text)) return categories && !categories.has(cat) ? null : cat;
    }
    return null;
  }

  function categorize(txn, ctx) {
    if (txn.categorySource === 'manual' && txn.category) {
      return { category: txn.category, categorySource: 'manual', ruleId: null };
    }
    if (isStrongPayment(txn)) return { category: D.PAYMENTS, categorySource: 'payment', ruleId: null };
    for (const r of ctx.rules) {
      if (ruleMatches(r, txn)) return { category: r.category, categorySource: 'rule', ruleId: r.id };
    }
    if (txn.amount < 0 && D.REWARD_DESC.test(txn.description || '')) return { category: D.REWARDS, categorySource: 'reward', ruleId: null };
    if (txn.issuerCategory) {
      const mapped = mapIssuerCategory(txn.issuerCategory, ctx.issuerMap);
      // Unmapped issuer categories pass through verbatim; Settings lists them for mapping.
      return { category: mapped || txn.issuerCategory.trim(), categorySource: 'issuer', ruleId: null };
    }
    const learned = ctx.learned && ctx.learned.get(txn.merchant.toLowerCase());
    if (learned) return { category: learned, categorySource: 'learned', ruleId: null };
    const guess = guessCategory(txn, ctx.categories);
    if (guess) return { category: guess, categorySource: 'keyword', ruleId: null };
    return { category: D.UNCATEGORIZED, categorySource: 'none', ruleId: null };
  }

  // Mutates txns in place; returns the ones whose category/source changed.
  function recategorize(txns, ctx) {
    const changed = [];
    for (const t of txns) {
      const r = categorize(t, ctx);
      if (r.category !== t.category || r.categorySource !== t.categorySource || r.ruleId !== t.ruleId) {
        Object.assign(t, r);
        changed.push(t);
      }
    }
    return changed;
  }

  function isValidRule(rule) {
    if (!rule.pattern || !rule.pattern.trim()) return 'Pattern is empty.';
    if (!rule.category) return 'Pick a category.';
    if (rule.matchType === 'regex' && !compileRegex(rule.pattern)) return 'Invalid regular expression.';
    return null;
  }

  function describeRule(rule) {
    const verb = { equals: 'is', startsWith: 'starts with', contains: 'contains', regex: 'matches' }[rule.matchType];
    return (rule.field === 'description' ? 'Description' : 'Merchant') + ' ' + verb + ' “' + rule.pattern + '”';
  }

  SA.rules = { guessCategory, sortRules, ruleMatches, mapIssuerCategory, isStrongPayment, buildContext, categorize, recategorize, isValidRule, describeRule };
})(window.SA = window.SA || {});
