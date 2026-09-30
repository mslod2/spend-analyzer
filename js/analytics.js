/* Pure aggregation over normalized transactions. Spend = charges minus refunds, excluding excluded categories. */
(function (SA) {
  'use strict';
  const U = SA.util;

  const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

  function monthlyIncome(income) {
    if (!income) return null;
    if (income.mode === 'paycheck') {
      const n = Number(income.paycheck);
      return n > 0 && PER_YEAR[income.frequency] ? n * PER_YEAR[income.frequency] / 12 : null;
    }
    const n = Number(income.monthly);
    return n > 0 ? n : null;
  }

  function dataMonths(txns) {
    const s = new Set();
    for (const t of txns) s.add(t.date.slice(0, 7));
    return [...s].sort();
  }

  const PERIODS = [
    ['latest', 'Latest month'], ['prev', 'Previous month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'],
    ['12m', 'Last 12 months'], ['ytd', 'Year to date'], ['all', 'All time'], ['custom', 'Custom…'],
  ];

  // Relative periods anchor on the latest month with data, since exports lag behind today.
  function resolvePeriod(key, custom, allMonths) {
    if (!allMonths.length) return null;
    const first = allMonths[0], last = allMonths[allMonths.length - 1];
    let from = first, to = last;
    switch (key) {
      case 'latest': from = last; break;
      case 'prev': from = to = U.addMonths(last, -1); break;
      case '3m': from = U.addMonths(last, -2); break;
      case '6m': from = U.addMonths(last, -5); break;
      case '12m': from = U.addMonths(last, -11); break;
      case 'ytd': from = last.slice(0, 4) + '-01'; break;
      case 'custom':
        from = (custom && custom.from) || first;
        to = (custom && custom.to) || last;
        if (from > to) [from, to] = [to, from];
        break;
    }
    if (key !== 'custom' && from < first) from = first; // don't count months before any data exists
    const months = U.monthRange(from, to);
    const label = from === to ? U.monthLabel(from) : U.monthLabel(from) + ' – ' + U.monthLabel(to);
    return { from, to, months, label };
  }

  function filterTxns(txns, f) {
    return txns.filter((t) => {
      const ym = t.date.slice(0, 7);
      if (f.from && ym < f.from) return false;
      if (f.to && ym > f.to) return false;
      if (f.account && t.account !== f.account) return false;
      return true;
    });
  }

  function groupSum(txns, keyFn) {
    const m = new Map();
    for (const t of txns) {
      const k = keyFn(t);
      let g = m.get(k);
      if (!g) { g = { key: k, total: 0, charges: 0, credits: 0, count: 0, txns: [] }; m.set(k, g); }
      g.total += t.amount;
      if (t.amount > 0) g.charges += t.amount; else g.credits -= t.amount;
      g.count++;
      g.txns.push(t);
    }
    return [...m.values()];
  }

  /**
   * @param txns   already filtered to the period/account
   * @param opts   { excluded: Set<string>, monthlyIncome: number|null, months: string[] }
   */
  function summarize(txns, opts) {
    const excluded = opts.excluded || new Set();
    const spend = txns.filter((t) => !excluded.has(t.category));
    const excludedTxns = txns.filter((t) => excluded.has(t.category));
    const total = U.round2(U.sum(spend, (t) => t.amount));
    const charges = U.round2(U.sum(spend, (t) => (t.amount > 0 ? t.amount : 0)));
    const credits = U.round2(-U.sum(spend, (t) => (t.amount < 0 ? t.amount : 0)));
    const monthsCount = opts.months.length || 1;
    const incomeForPeriod = opts.monthlyIncome ? opts.monthlyIncome * monthsCount : null;

    const byCategory = groupSum(spend, (t) => t.category)
      .map((g) => ({
        category: g.key, total: U.round2(g.total), charges: U.round2(g.charges), credits: U.round2(g.credits), count: g.count,
        pctSpend: total > 0 ? g.total / total : null,
        pctIncome: incomeForPeriod ? g.total / incomeForPeriod : null,
      }))
      .sort((a, b) => b.total - a.total);

    const byMerchant = groupSum(spend, (t) => t.merchant)
      .map((g) => {
        const catCounts = new Map();
        for (const t of g.txns) catCounts.set(t.category, (catCounts.get(t.category) || 0) + 1);
        const category = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { merchant: g.key, total: U.round2(g.total), count: g.count, category, pctSpend: total > 0 ? g.total / total : null };
      })
      .sort((a, b) => b.total - a.total);

    // month -> total, and category -> month -> total
    const monthTotals = {};
    const catMonth = {};
    for (const ym of opts.months) monthTotals[ym] = 0;
    for (const t of spend) {
      const ym = t.date.slice(0, 7);
      monthTotals[ym] = (monthTotals[ym] || 0) + t.amount;
      const cm = catMonth[t.category] || (catMonth[t.category] = {});
      cm[ym] = (cm[ym] || 0) + t.amount;
    }
    for (const k in monthTotals) monthTotals[k] = U.round2(monthTotals[k]);

    return {
      total, charges, credits, count: spend.length,
      excludedCount: excludedTxns.length,
      excludedTotal: U.round2(-U.sum(excludedTxns, (t) => t.amount)),
      monthsCount, avgMonthly: total / monthsCount,
      monthlyIncome: opts.monthlyIncome, incomeForPeriod,
      pctIncome: incomeForPeriod ? total / incomeForPeriod : null,
      byCategory, byMerchant, monthTotals, catMonth,
    };
  }

  // ---------- Time buckets (month / week / day) ----------
  // Keys: 'YYYY-MM' for months, the Sunday that starts the week ('YYYY-MM-DD') for weeks, the date for days.
  const GRAINS = ['month', 'week', 'day'];

  function weekStart(iso) { return U.addDays(iso, -U.weekday(iso)); }

  function bucketOf(date, grain) {
    if (grain === 'month') return date.slice(0, 7);
    return grain === 'week' ? weekStart(date) : date;
  }

  /** Every bucket key covering [start, end] (ISO dates, inclusive), including empty ones. */
  function bucketKeys(start, end, grain) {
    if (grain === 'month') return U.monthRange(start.slice(0, 7), end.slice(0, 7));
    const keys = [];
    const step = grain === 'week' ? 7 : 1;
    for (let k = bucketOf(start, grain); k <= end; k = U.addDays(k, step)) keys.push(k);
    return keys;
  }

  // Take-home pay scaled to one bucket.
  function incomePerBucket(monthly, grain) {
    if (!monthly) return null;
    return grain === 'month' ? monthly : grain === 'week' ? monthly * 12 / 52 : monthly * 12 / 365;
  }

  /** Net spend per bucket and per category per bucket, for transactions dated within [start, end]. */
  function timeSeries(txns, opts) {
    const { grain, start, end } = opts;
    const excluded = opts.excluded || new Set();
    const keys = bucketKeys(start, end, grain);
    const totals = {};
    const byCat = {};
    for (const k of keys) totals[k] = 0;
    for (const t of txns) {
      if (excluded.has(t.category) || t.date < start || t.date > end) continue;
      const k = bucketOf(t.date, grain);
      totals[k] += t.amount;
      const cm = byCat[t.category] || (byCat[t.category] = {});
      cm[k] = (cm[k] || 0) + t.amount;
    }
    for (const k of keys) totals[k] = U.round2(totals[k]);
    return { grain, start, end, keys, totals, byCat };
  }

  // Stable category order for color assignment: all-time net spend, independent of filters.
  function categoryRank(allTxns, excluded) {
    return groupSum(allTxns.filter((t) => !excluded.has(t.category)), (t) => t.category)
      .sort((a, b) => b.total - a.total)
      .map((g) => g.key);
  }

  SA.analytics = { PER_YEAR, PERIODS, GRAINS, monthlyIncome, dataMonths, resolvePeriod, filterTxns, summarize, categoryRank,
    weekStart, bucketOf, bucketKeys, incomePerBucket, timeSeries };
})(window.SA = window.SA || {});
