/* Settings: take-home pay, categories, issuer category mapping, backup/restore. */
(function (SA) {
  'use strict';
  const U = SA.util, esc = U.esc;

  let root = null;
  const FREQ = [['weekly', 'Weekly'], ['biweekly', 'Every two weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly']];

  function incomeSummary(income) {
    const m = SA.analytics.monthlyIncome(income);
    return m ? '≈ ' + U.money(m) + ' per month · ' + U.money(m * 12, { whole: true }) + ' per year' : 'Not set — dashboard percentages of take-home pay will be hidden.';
  }

  function renderIncome(s) {
    const inc = s.income;
    return '<div class="card"><div class="card-head"><div><h2>Take-home pay</h2><p class="small muted">After taxes and deductions — what lands in your bank account.</p></div></div>' +
      '<div class="row" style="margin-bottom:12px"><div class="seg" role="radiogroup" aria-label="Income entry mode">' +
      '<label><input type="radio" name="inc-mode" value="monthly"' + (inc.mode !== 'paycheck' ? ' checked' : '') + '>Monthly amount</label>' +
      '<label><input type="radio" name="inc-mode" value="paycheck"' + (inc.mode === 'paycheck' ? ' checked' : '') + '>Per paycheck</label></div></div>' +
      (inc.mode === 'paycheck'
        ? '<div class="row"><label class="field"><span>Amount per paycheck</span><input type="number" min="0" step="0.01" data-inc="paycheck" value="' + esc(inc.paycheck ?? '') + '" placeholder="3000"></label>' +
          '<label class="field"><span>Paid</span><select data-inc="frequency">' + SA.ui.options(FREQ, inc.frequency) + '</select></label></div>'
        : '<label class="field" style="max-width:240px"><span>Monthly take-home</span><input type="number" min="0" step="0.01" data-inc="monthly" value="' + esc(inc.monthly ?? '') + '" placeholder="6500"></label>') +
      '<p class="small secondary" style="margin:10px 0 0" data-inc-summary>' + esc(incomeSummary(inc)) + '</p></div>';
  }

  function renderCategories(s) {
    const counts = new Map();
    for (const t of SA.store.state.transactions) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    const excluded = new Set(s.excludedCategories);
    const cats = SA.store.categories();
    return '<div class="card"><div class="card-head"><div><h2>Categories</h2><p class="small muted">Excluded categories don’t count as spending (payments, transfers, reimbursables).</p></div></div>' +
      '<div class="cat-list">' + cats.map((c) => '<div class="cat-row">' +
        '<span class="name">' + esc(c) + (s.categories.includes(c) ? '' : ' <span class="badge">from issuer</span>') + '</span>' +
        '<span class="small muted num">' + (counts.get(c) || 0) + ' txns</span>' +
        '<label class="check small"><input type="checkbox" data-excl="' + esc(c) + '"' + (excluded.has(c) ? ' checked' : '') + '> Exclude</label>' +
        (c === SA.defaults.UNCATEGORIZED ? '<span style="width:124px"></span>' :
          '<button class="btn btn-ghost btn-sm" data-rename="' + esc(c) + '">Rename</button><button class="btn btn-ghost btn-sm btn-danger" data-delcat="' + esc(c) + '">Delete</button>') +
        '</div>').join('') + '</div>' +
      '<div class="row" style="margin-top:12px"><input type="text" data-newcat placeholder="New category" style="flex:1 1 180px" aria-label="New category name"><button class="btn" data-act="addcat">Add</button></div></div>';
  }

  function renderIssuerMap(s) {
    const seen = new Map();
    for (const t of SA.store.state.transactions) if (t.issuerCategory) seen.set(t.issuerCategory, (seen.get(t.issuerCategory) || 0) + 1);
    if (!seen.size) return '';
    const cats = SA.store.state.settings.categories;
    const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
    return '<div class="card"><div class="card-head"><div><h2>Issuer categories</h2><p class="small muted">How your card issuers’ categories translate into yours. Rules and manual changes still take priority.</p></div></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Issuer says</th><th class="num">Txns</th><th>Your category</th></tr></thead><tbody>' +
      rows.map(([ic, n]) => {
        const mapped = SA.rules.mapIssuerCategory(ic, s.issuerCategoryMap);
        return '<tr><td>' + esc(ic) + '</td><td class="num">' + n + '</td><td><select class="input-sm" data-imap="' + esc(ic) + '">' +
          SA.ui.options([['', 'Keep as “' + ic + '”']].concat(cats), mapped || '') + '</select>' +
          (mapped ? '' : ' <span class="badge badge-warn">unmapped</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function renderBackup() {
    const st = SA.store.state;
    return '<div class="card"><div class="card-head"><div><h2>Backup</h2><p class="small muted">Your data lives only in this browser’s IndexedDB. Clearing site data deletes it — export a backup regularly.</p></div></div>' +
      '<p class="small secondary" style="margin:0 0 12px">' + st.transactions.length.toLocaleString() + ' transactions · ' + st.rules.length + ' rules · ' + st.imports.length + ' imports · ' + st.mappings.length + ' saved column mappings</p>' +
      '<div class="row"><button class="btn btn-primary" data-act="export">Export backup (JSON)</button>' +
      '<button class="btn" data-act="restore">Restore from backup…</button>' +
      '<select data-restore-mode aria-label="Restore mode">' + SA.ui.options([['merge', 'Merge with current data'], ['replace', 'Replace current data']], 'merge') + '</select>' +
      '<input type="file" accept=".json,application/json" class="hidden" data-restore-file></div>' +
      '<div class="row" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)"><button class="btn btn-danger" data-act="clear">Delete all data…</button></div></div>';
  }

  function render(el) {
    root = el;
    const s = SA.store.state.settings;
    const c = document.createElement('div');
    c.innerHTML = '<div class="page-head"><h1>Settings</h1></div><div class="stack">' +
      '<div class="grid-2">' + renderIncome(s) + renderBackup() + '</div>' +
      '<div class="grid-2">' + renderCategories(s) + (renderIssuerMap(s) || '<div></div>') + '</div></div>';
    el.replaceChildren(c);
    bind(c);
  }

  const saveIncome = U.debounce(async (income) => { await SA.store.saveSettings({ income }); }, 300);

  function bind(c) {
    c.addEventListener('input', (e) => {
      const k = e.target.dataset.inc;
      if (!k) return;
      const income = Object.assign({}, SA.store.state.settings.income, { [k]: e.target.value === '' ? null : k === 'frequency' ? e.target.value : +e.target.value });
      SA.store.state.settings.income = income;
      c.querySelector('[data-inc-summary]').textContent = incomeSummary(income);
      saveIncome(income);
    });
    c.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.name === 'inc-mode') {
        await SA.store.saveSettings({ income: Object.assign({}, SA.store.state.settings.income, { mode: t.value }) });
        render(root);
      } else if (t.dataset.inc === 'frequency') {
        await SA.store.saveSettings({ income: Object.assign({}, SA.store.state.settings.income, { frequency: t.value }) });
        c.querySelector('[data-inc-summary]').textContent = incomeSummary(SA.store.state.settings.income);
      } else if (t.dataset.excl) {
        await SA.store.setExcluded(t.dataset.excl, t.checked);
      } else if (t.matches('[data-imap]')) {
        await SA.store.setIssuerMapping(t.dataset.imap, t.value);
        SA.ui.toast('Mapping saved.');
        render(root);
      } else if (t.matches('[data-restore-file]') && t.files[0]) {
        await restore(t.files[0], c.querySelector('[data-restore-mode]').value);
        t.value = '';
      }
    });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-newcat]')) addCategory(c); });
    c.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'addcat') return addCategory(c);
      if (b.dataset.rename) {
        const to = prompt('Rename “' + b.dataset.rename + '” to:', b.dataset.rename);
        if (to && to.trim() && to.trim() !== b.dataset.rename) { await SA.store.renameCategory(b.dataset.rename, to.trim()); render(root); }
        return;
      }
      if (b.dataset.delcat) {
        const name = b.dataset.delcat;
        const nRules = SA.store.state.rules.filter((r) => r.category === name).length;
        if (!confirm('Delete category “' + name + '”?' + (nRules ? ' Its ' + nRules + ' rule(s) will be deleted too.' : '') + ' Its transactions fall back to automatic categorization.')) return;
        await SA.store.deleteCategory(name);
        render(root);
        return;
      }
      if (b.dataset.act === 'export') {
        const data = await SA.store.exportBackup();
        U.download('spend-analyzer-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data));
        SA.ui.toast('Backup downloaded.');
      } else if (b.dataset.act === 'restore') {
        c.querySelector('[data-restore-file]').click();
      } else if (b.dataset.act === 'clear') {
        if (!confirm('Delete ALL transactions, rules, mappings and settings from this browser? Export a backup first if you might want them back.')) return;
        await SA.store.clearAll();
        SA.ui.toast('All data deleted.');
      }
    });
  }

  async function addCategory(c) {
    const input = c.querySelector('[data-newcat]');
    if (await SA.store.addCategory(input.value)) render(root);
    else if (input.value.trim()) SA.ui.toast('That category already exists.');
  }

  async function restore(file, mode) {
    let data;
    try { data = JSON.parse(await U.readFileText(file)); SA.db.validateBackup(data); }
    catch (e) { SA.ui.toast('Can’t restore: ' + (e instanceof SyntaxError ? 'file is not valid JSON.' : e.message)); return; }
    const n = (data.transactions || []).length;
    if (mode === 'replace' && !confirm('Replace everything in this browser with the backup (' + n + ' transactions)?')) return;
    await SA.store.restoreBackup(data, mode);
    SA.ui.toast('Restored ' + n + ' transactions (' + (mode === 'replace' ? 'replaced' : 'merged') + ').');
  }

  SA.views = SA.views || {};
  SA.views.settings = { render };
})(window.SA = window.SA || {});
