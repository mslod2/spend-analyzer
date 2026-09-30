/* Rules view: list, add, edit and delete merchant rules. */
(function (SA) {
  'use strict';
  const U = SA.util, esc = U.esc;

  let root = null;
  let draft = { field: 'merchant', matchType: 'contains', pattern: '', category: '' };

  const MATCH_OPTS = [['contains', 'contains'], ['equals', 'is exactly'], ['startsWith', 'starts with'], ['regex', 'matches regex']];
  const FIELD_OPTS = [['merchant', 'Merchant'], ['description', 'Description']];

  function draftStatus() {
    if (!draft.pattern.trim()) return 'Type a pattern to preview matches.';
    const err = SA.rules.isValidRule(Object.assign({}, draft, { category: draft.category || 'x' }));
    if (err) return err;
    const imp = SA.store.ruleImpact(draft);
    const sample = SA.store.state.transactions.filter((t) => SA.rules.ruleMatches(draft, t)).map((t) => t.merchant);
    const uniq = [...new Set(sample)].slice(0, 4);
    return imp.matches + ' matching transaction' + (imp.matches === 1 ? '' : 's') + (uniq.length ? ' — ' + uniq.join(', ') + (new Set(sample).size > 4 ? '…' : '') : '');
  }

  function render(el) {
    root = el;
    const st = SA.store.state;
    const cats = SA.store.categories();
    const sorted = SA.rules.sortRules(st.rules);
    const counts = new Map(sorted.map((r) => [r.id, 0]));
    for (const t of st.transactions) if (t.ruleId && counts.has(t.ruleId)) counts.set(t.ruleId, counts.get(t.ruleId) + 1);

    const c = document.createElement('div');
    c.innerHTML = '<div class="page-head"><h1>Rules</h1><span class="small secondary">Rules override the issuer’s category. Manual changes override rules.</span></div>' +
      '<div class="stack">' +
      '<div class="card"><div class="card-head"><h2>Add a rule</h2></div>' +
      '<div class="row">' +
      '<select data-d="field" aria-label="Field">' + SA.ui.options(FIELD_OPTS, draft.field) + '</select>' +
      '<select data-d="matchType" aria-label="Match type">' + SA.ui.options(MATCH_OPTS, draft.matchType) + '</select>' +
      '<input type="text" data-d="pattern" placeholder="e.g. blue bottle" value="' + esc(draft.pattern) + '" style="flex:1 1 200px" aria-label="Pattern">' +
      '<span class="secondary">→</span>' +
      '<select data-d="category" aria-label="Category">' + SA.ui.options([['', 'Choose category…']].concat(cats), draft.category) + '</select>' +
      '<button class="btn btn-primary" data-act="add">Add rule</button></div>' +
      '<p class="small muted" style="margin:8px 0 0" data-status>' + esc(draftStatus()) + '</p></div>' +
      '<div class="card"><div class="card-head"><div><h2>Your rules</h2><p class="small muted">Most specific first: exact matches, then starts-with, contains and regex; longer patterns before shorter ones.</p></div></div>' +
      (sorted.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Category</th><th class="num">Applied to</th><th></th></tr></thead><tbody>' +
        sorted.map((r) => '<tr><td>' + esc(SA.rules.describeRule(r)) + '</td>' +
          '<td><select class="input-sm" data-rule="' + esc(r.id) + '" aria-label="Category">' + SA.ui.options(cats, r.category) + '</select></td>' +
          '<td class="num"><a href="' + SA.ui.href('transactions', { rule: r.id }) + '">' + counts.get(r.id) + '</a></td>' +
          '<td class="num"><button class="btn btn-ghost btn-sm btn-danger" data-del="' + esc(r.id) + '">Delete</button></td></tr>').join('') +
        '</tbody></table></div>'
        : '<div class="empty"><p>No rules yet. Change a transaction’s category and choose “Save rule”, or add one above.</p></div>') +
      '</div></div>';
    el.replaceChildren(c);
    bind(c);
  }

  function bind(c) {
    c.addEventListener('input', (e) => {
      const k = e.target.dataset.d;
      if (!k) return;
      draft[k] = e.target.value;
      c.querySelector('[data-status]').textContent = draftStatus();
    });
    c.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.d) { draft[t.dataset.d] = t.value; c.querySelector('[data-status]').textContent = draftStatus(); return; }
      if (t.dataset.rule) {
        const rule = SA.store.state.rules.find((r) => r.id === t.dataset.rule);
        const { changed } = await SA.store.saveRule(Object.assign({}, rule, { category: t.value }));
        SA.ui.toast('Rule updated · ' + changed + ' transaction' + (changed === 1 ? '' : 's') + ' recategorized.');
        render(root);
      }
    });
    c.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'add') {
        const rule = { field: draft.field, matchType: draft.matchType, pattern: draft.pattern.trim(), category: draft.category };
        const err = SA.rules.isValidRule(rule);
        if (err) { SA.ui.toast(err); return; }
        const { changed } = await SA.store.saveRule(rule);
        SA.ui.toast('Rule added · ' + changed + ' transaction' + (changed === 1 ? '' : 's') + ' recategorized.');
        draft = { field: draft.field, matchType: draft.matchType, pattern: '', category: '' };
        render(root);
      } else if (b.dataset.del) {
        const rule = SA.store.state.rules.find((r) => r.id === b.dataset.del);
        if (!confirm('Delete rule: ' + SA.rules.describeRule(rule) + ' → ' + rule.category + '?')) return;
        const changed = await SA.store.deleteRule(rule.id);
        SA.ui.toast('Rule deleted · ' + changed + ' transaction' + (changed === 1 ? '' : 's') + ' recategorized.');
        render(root);
      }
    });
  }

  SA.views = SA.views || {};
  SA.views.rules = { render };
})(window.SA = window.SA || {});
