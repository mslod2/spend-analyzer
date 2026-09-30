/* Transactions view: filterable list with inline recategorization and a "save as rule" prompt. */
(function (SA) {
  'use strict';
  const U = SA.util, esc = U.esc;

  let root = null;
  let f = {};           // current filters (mirrors URL params)
  let limit = SA.ui.PAGE_SIZE;
  let prompt = null;    // pending "save as rule?" offer

  const SOURCE_LABEL = { manual: 'Manual', rule: 'Rule', issuer: 'Issuer', payment: 'Payment', reward: 'Reward', learned: 'Learned', keyword: 'Guess', none: '' };
  const SOURCES = [['', 'Any source'], ['review', 'Uncategorized'], ['manual', 'Set manually'], ['rule', 'From a rule'],
    ['issuer', 'From issuer category'], ['learned', 'Learned from other cards'], ['keyword', 'Guessed from merchant name'], ['payment', 'Detected payment'], ['reward', 'Detected reward/credit']];

  // Sortable columns. `first` is the direction used when a column is first clicked:
  // newest / largest first for dates and amounts, A–Z for text.
  const COLUMNS = [
    { key: 'date', label: 'Date', get: (t) => t.date, first: 'desc' },
    { key: 'merchant', label: 'Merchant', get: (t) => t.merchant, first: 'asc' },
    { key: 'account', label: 'Account', get: (t) => t.account, first: 'asc' },
    { key: 'category', label: 'Category', get: (t) => t.category, first: 'asc' },
    { key: 'amount', label: 'Amount', get: (t) => t.amount, first: 'desc', num: true },
  ];
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

  function currentSort() {
    const col = COLUMNS.find((c) => c.key === f.sort) || COLUMNS[0];
    const dir = f.dir === 'asc' || f.dir === 'desc' ? f.dir : col.first;
    return { col, dir };
  }

  // The store keeps transactions newest-first and Array#sort is stable, so ties stay in date order.
  function sorted(list) {
    const { col, dir } = currentSort();
    if (col.key === 'date' && dir === 'desc') return list;
    const sign = dir === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      return sign * (col.num ? va - vb : collator.compare(va, vb));
    });
  }

  function headerCell(col, sort) {
    const active = col.key === sort.col.key;
    const next = active ? (sort.dir === 'asc' ? 'descending' : 'ascending') : (col.first === 'asc' ? 'ascending' : 'descending');
    return '<th' + (col.num ? ' class="num"' : '') + ' aria-sort="' + (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '">' +
      '<button type="button" class="sort-btn' + (active ? ' active' : '') + '" data-sort="' + col.key + '" title="Sort by ' + col.label.toLowerCase() + ', ' + next + '">' +
      col.label + '<span class="sort-ind" aria-hidden="true">' + (active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕') + '</span></button></th>';
  }

  function filtered() {
    const q = (f.q || '').toLowerCase().trim();
    const excluded = SA.store.excludedSet();
    let from = f.from, to = f.to;
    if (f.month) from = to = f.month;
    return SA.store.state.transactions.filter((t) => {
      const ym = t.date.slice(0, 7);
      if (from && ym < from) return false;
      if (to && ym > to) return false;
      if (f.category && t.category !== f.category) return false;
      if (f.account && t.account !== f.account) return false;
      if (f.start && t.date < f.start) return false;
      if (f.end && t.date > f.end) return false;
      if (f.merchant && t.merchant !== f.merchant) return false;
      if (f.rule && t.ruleId !== f.rule) return false;
      if (f.source === 'review' ? t.category !== SA.defaults.UNCATEGORIZED : f.source && t.categorySource !== f.source) return false;
      if (f.hideExcluded === '1' && excluded.has(t.category)) return false;
      if (q && !t.merchant.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function ruleLabel(id) {
    const r = SA.store.state.rules.find((x) => x.id === id);
    return r ? 'Rule: ' + SA.rules.describeRule(r) : 'Rule (deleted)';
  }

  function syncUrl() { history.replaceState(null, '', SA.ui.href('transactions', f)); }

  function categorySelect(t, cats) {
    const opts = (t.categorySource === 'manual' ? [['__auto__', '↺ Reset to automatic']] : []).concat(cats);
    return '<select class="input-sm" data-txn="' + esc(t.id) + '" aria-label="Category for ' + esc(t.merchant) + '">' + SA.ui.options(opts, t.category) + '</select>';
  }

  function renderRows(list, cats, excluded) {
    return list.slice(0, limit).map((t) => {
      const src = SOURCE_LABEL[t.categorySource] || '';
      const rule = t.ruleId && SA.store.state.rules.find((r) => r.id === t.ruleId);
      return '<tr' + (excluded.has(t.category) ? ' class="excluded"' : '') + '>' +
        '<td class="num" style="text-align:left">' + esc(U.formatDate(t.date)) + '</td>' +
        '<td class="merchant-cell"><div>' + esc(t.merchant) + '</div><div class="desc" title="' + esc(t.description) + '">' + esc(t.description) + '</div></td>' +
        '<td class="secondary">' + esc(t.account) + '</td>' +
        '<td><div class="row" style="flex-wrap:nowrap">' + categorySelect(t, cats) +
        (src ? '<span class="badge' + (t.categorySource === 'manual' ? ' badge-manual' : '') + '"' + (rule ? ' title="' + esc(SA.rules.describeRule(rule)) + '"' : t.issuerCategory ? ' title="Issuer: ' + esc(t.issuerCategory) + '"'
          : t.categorySource === 'learned' ? ' title="' + esc(t.merchant) + ' has this category on your other transactions"'
          : t.categorySource === 'keyword' ? ' title="Guessed from the merchant name. Pick a category to correct it."' : '') + '>' + src + '</span>' : '') +
        '</div></td>' +
        '<td class="num' + (t.amount < 0 ? ' credit' : '') + '">' + U.money(t.amount) + '</td></tr>';
    }).join('');
  }

  function renderPrompt() {
    if (!prompt) return '';
    const impact = SA.store.ruleImpact(prompt);
    const others = Math.max(0, impact.changes);
    return '<div class="rule-prompt" role="dialog" aria-label="Save a rule">' +
      '<div>Moved <strong>' + esc(prompt.merchant) + '</strong> to <strong>' + esc(prompt.category) + '</strong>. Always categorize it this way?</div>' +
      '<div class="row">' +
      '<select class="input-sm" data-p="field">' + SA.ui.options([['merchant', 'Merchant'], ['description', 'Description']], prompt.field) + '</select>' +
      '<select class="input-sm" data-p="matchType">' + SA.ui.options([['contains', 'contains'], ['equals', 'is exactly'], ['startsWith', 'starts with'], ['regex', 'matches regex']], prompt.matchType) + '</select>' +
      '<input type="text" class="input-sm" data-p="pattern" value="' + esc(prompt.pattern) + '" style="flex:1 1 180px">' +
      '<span class="small secondary" data-impact>' + impactText(impact, others) + '</span></div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn btn-ghost btn-sm" data-act="dismiss-prompt">Just this one</button>' +
      '<button class="btn btn-primary btn-sm" data-act="save-rule">Save rule</button></div></div>';
  }
  function impactText(impact, others) {
    return impact.matches + ' match' + (impact.matches === 1 ? '' : 'es') + (others ? ' · recategorizes ' + others + ' other' + (others === 1 ? '' : 's') : '');
  }

  function render(el, params) {
    root = el;
    if (params) { f = Object.assign({}, params); limit = SA.ui.PAGE_SIZE; }
    const st = SA.store.state;
    if (!st.transactions.length) {
      el.innerHTML = '<div class="card empty"><h2>No transactions yet</h2><p>Import a CSV export from your card issuer to get started.</p><a class="btn btn-primary" href="#/import">Import CSV</a></div>';
      return;
    }
    const cats = SA.store.categories();
    const excluded = SA.store.excludedSet();
    const months = SA.analytics.dataMonths(st.transactions).reverse();
    const list = sorted(filtered());
    const sort = currentSort();
    const spend = list.filter((t) => !excluded.has(t.category));
    const net = U.sum(spend, (t) => t.amount);
    const uncategorized = st.transactions.filter((t) => t.category === SA.defaults.UNCATEGORIZED).length;

    const periodOpts = [['', 'All months']];
    if (f.from && f.to && f.from !== f.to) periodOpts.push([f.from + '..' + f.to, U.monthLabel(f.from) + ' – ' + U.monthLabel(f.to)]);
    for (const m of months) periodOpts.push([m, U.monthLabel(m)]);
    const periodVal = f.month || (f.from && f.to ? (f.from === f.to ? f.from : f.from + '..' + f.to) : '');

    const c = document.createElement('div');
    c.innerHTML = '<div class="page-head"><h1>Transactions</h1>' +
      (uncategorized ? '<a class="small" href="' + SA.ui.href('transactions', { source: 'review' }) + '">' + uncategorized + ' uncategorized →</a>' : '') + '</div>' +
      '<div class="filters">' +
      '<input type="search" class="grow" data-f="q" placeholder="Search merchant or description" value="' + esc(f.q || '') + '" aria-label="Search">' +
      '<select data-f="period" aria-label="Month">' + SA.ui.options(periodOpts, periodVal) + '</select>' +
      '<select data-f="category" aria-label="Category">' + SA.ui.options([['', 'All categories']].concat(cats), f.category || '') + '</select>' +
      (SA.store.accounts().length > 1 ? '<select data-f="account" aria-label="Account">' + SA.ui.options([['', 'All accounts']].concat(SA.store.accounts()), f.account || '') + '</select>' : '') +
      '<select data-f="source" aria-label="Categorized by">' + SA.ui.options(SOURCES, f.source || '') + '</select>' +
      '<label class="check small"><input type="checkbox" data-f="hideExcluded"' + (f.hideExcluded === '1' ? ' checked' : '') + '> Hide payments</label>' +
      (f.start || f.end ? '<span class="badge badge-manual">' + esc(f.start ? U.formatDate(f.start) : 'Start') + ' – ' + esc(f.end ? U.formatDate(f.end) : 'today') +
        ' <a href="#" data-act="clear" data-key="start,end" aria-label="Clear date range">×</a></span>' : '') +
      (f.merchant ? '<span class="badge badge-manual">Merchant: ' + esc(f.merchant) + ' <a href="#" data-act="clear" data-key="merchant" aria-label="Clear merchant filter">×</a></span>' : '') +
      (f.rule ? '<span class="badge badge-manual">' + esc(ruleLabel(f.rule)) + ' <a href="#" data-act="clear" data-key="rule" aria-label="Clear rule filter">×</a></span>' : '') +
      '</div>' +
      '<div class="card" style="padding:8px 12px 12px">' +
      '<p class="small secondary" style="margin:6px 10px 8px">' + list.length.toLocaleString() + ' transaction' + (list.length === 1 ? '' : 's') +
      ' · net spend ' + U.money(net) + (list.length > spend.length ? ' <span class="muted">(excludes ' + (list.length - spend.length) + ' payments, transfers &amp; rewards)</span>' : '') + '</p>' +
      (list.length ? '<div class="table-wrap"><table class="data"><thead><tr>' + COLUMNS.map((col) => headerCell(col, sort)).join('') + '</tr></thead><tbody>' +
        renderRows(list, cats, excluded) + '</tbody></table></div>' : '<div class="empty">No transactions match these filters.</div>') +
      (list.length > limit ? '<div class="row" style="justify-content:center;margin-top:12px"><button class="btn" data-act="more">Show more (' + (list.length - limit).toLocaleString() + ' remaining)</button></div>' : '') +
      '</div>' + renderPrompt();
    el.replaceChildren(c);
    bind(c);
  }

  function rerender() {
    const y = window.scrollY;
    render(root);
    window.scrollTo(0, y);
  }

  function bind(c) {
    c.addEventListener('input', U.debounce((e) => {
      if (e.target.dataset.f !== 'q') return;
      f.q = e.target.value;
      limit = SA.ui.PAGE_SIZE;
      syncUrl();
      rerender();
      const input = root.querySelector('[data-f=q]');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 200));
    c.addEventListener('input', (e) => {
      if (!e.target.dataset.p || !prompt) return;
      prompt[e.target.dataset.p] = e.target.value;
      const impact = SA.store.ruleImpact(prompt);
      c.querySelector('[data-impact]').textContent = SA.rules.isValidRule(prompt) || impactText(impact, impact.changes);
    });
    c.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.txn) return onRecategorize(t.dataset.txn, t.value);
      if (t.dataset.p) return; // handled on input
      const k = t.dataset.f;
      if (!k || k === 'q') return;
      if (k === 'period') {
        delete f.month; delete f.from; delete f.to;
        if (t.value.includes('..')) [f.from, f.to] = t.value.split('..');
        else if (t.value) f.month = t.value;
      } else if (k === 'hideExcluded') {
        f.hideExcluded = t.checked ? '1' : '';
      } else {
        f[k] = t.value;
      }
      limit = SA.ui.PAGE_SIZE;
      syncUrl();
      rerender();
    });
    c.addEventListener('click', async (e) => {
      const sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) {
        const { col, dir } = currentSort();
        const key = sortBtn.dataset.sort;
        const nextDir = key === col.key ? (dir === 'asc' ? 'desc' : 'asc') : COLUMNS.find((x) => x.key === key).first;
        // Keep the URL clean for the default order (newest first).
        if (key === 'date' && nextDir === 'desc') { delete f.sort; delete f.dir; } else { f.sort = key; f.dir = nextDir; }
        limit = SA.ui.PAGE_SIZE;
        syncUrl();
        rerender();
        root.querySelector('[data-sort="' + key + '"]').focus();
        return;
      }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      e.preventDefault();
      const act = a.dataset.act;
      if (act === 'more') { limit += SA.ui.PAGE_SIZE * 2; rerender(); }
      else if (act === 'clear') { for (const k of a.dataset.key.split(',')) delete f[k]; syncUrl(); rerender(); }
      else if (act === 'dismiss-prompt') { prompt = null; rerender(); }
      else if (act === 'save-rule') {
        const err = SA.rules.isValidRule(prompt);
        if (err) { SA.ui.toast(err); return; }
        const { changed } = await SA.store.saveRule({ field: prompt.field, matchType: prompt.matchType, pattern: prompt.pattern.trim(), category: prompt.category }, [prompt.txnId]);
        SA.ui.toast('Rule saved' + (changed ? ' · ' + changed + ' transaction' + (changed === 1 ? '' : 's') + ' recategorized' : '') + '.');
        prompt = null;
        rerender();
      }
    });
  }

  async function onRecategorize(txnId, value) {
    const t = SA.store.getTxn(txnId);
    if (!t) return;
    if (value === '__auto__') {
      await SA.store.setCategory(txnId, null);
      prompt = null;
      rerender();
      return;
    }
    await SA.store.setCategory(txnId, value);
    const alreadyRuled = SA.store.state.rules.some((r) => r.category === value && SA.rules.ruleMatches(r, t));
    prompt = alreadyRuled ? null : { txnId, merchant: t.merchant, category: value, field: 'merchant', matchType: 'contains', pattern: t.merchant.toLowerCase() };
    rerender();
  }

  function destroy() { prompt = null; }

  SA.views = SA.views || {};
  SA.views.transactions = { render, destroy };
})(window.SA = window.SA || {});
