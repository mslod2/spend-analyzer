/* Import view: drop CSVs, confirm/adjust the column mapping with a live preview, then import. */
(function (SA) {
  'use strict';
  const U = SA.util, I = SA.importer, esc = U.esc;

  let root = null;
  const pending = []; // files awaiting mapping confirmation (survive re-renders while the tab is open)

  const COLUMN_FIELDS = [
    ['date', 'Date', true], ['description', 'Description', true], ['merchant', 'Merchant name', false],
    ['category', 'Issuer category', false], ['type', 'Transaction type', false], ['status', 'Status (pending rows skipped)', false],
  ];

  // Issuer names in file names ("amex_statement.csv", "Chase1234_Activity.csv").
  const FILE_ISSUERS = [[/amex|american.?express/i, 'Amex'], [/chase/i, 'Chase'], [/citi/i, 'Citi'], [/discover/i, 'Discover'],
    [/capital.?one/i, 'Capital One'], [/apple/i, 'Apple Card'], [/wells.?fargo/i, 'Wells Fargo'], [/bofa|bank.?of.?america/i, 'Bank of America']];
  function issuerFromFileName(fileName) {
    const hit = FILE_ISSUERS.find(([re]) => re.test(fileName));
    return hit ? hit[1] : null;
  }

  // Generic layouts ("Date,Description,Amount") are shared by several issuers, so a saved mapping's account name is
  // only reused when the file name doesn't point at a different issuer.
  function accountFor(saved, sig, fileName) {
    const fromFile = issuerFromFileName(fileName);
    if (saved && (!fromFile || saved.account.toLowerCase().includes(fromFile.toLowerCase()))) return saved.account;
    return fromFile || guessAccount(sig, fileName);
  }

  // Friendly default account names for well-known header layouts.
  function guessAccount(sig, fileName) {
    const has = (s) => sig.includes(s);
    if (has('card member')) return 'Amex';
    if (has('clearing date')) return 'Apple Card';
    if (has('card no.')) return 'Capital One';
    if (has('trans. date')) return 'Discover';
    if (has('post date') && has('type') && has('memo')) return 'Chase';
    if (has('status') && has('debit') && has('credit')) return 'Citi';
    return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Card';
  }

  async function addFiles(files) {
    for (const file of files) {
      if (!/\.(csv|txt)$/i.test(file.name) && file.type && !/csv|text/.test(file.type)) {
        SA.ui.toast(file.name + ' doesn’t look like a CSV file — skipped.');
        continue;
      }
      try {
        const text = await U.readFileText(file);
        const rows = I.parseCsv(text);
        if (!rows.length) { SA.ui.toast(file.name + ' is empty.'); continue; }
        const headerRow = I.detectHeaderRow(rows);
        const sig = I.signature(rows, headerRow);
        const saved = SA.store.findMapping(sig);
        const width = I.headersFor(rows, headerRow).length;
        const savedFits = saved && Object.values(saved.columns).every((i) => i == null || i < width);
        const mapping = savedFits ? JSON.parse(JSON.stringify({ headerRow: saved.headerRow, columns: saved.columns, amountMode: saved.amountMode,
          dateFormat: saved.dateFormat, chargesArePositive: saved.chargesArePositive })) : I.guessMapping(rows, headerRow);
        pending.push({
          key: U.uid('f'), fileName: file.name, rows, mapping, recognized: !!savedFits,
          account: accountFor(savedFits ? saved : null, sig, file.name), result: null,
        });
      } catch (e) {
        SA.ui.toast('Couldn’t read ' + file.name + ': ' + e.message);
      }
    }
    if (SA.ui.parseHash().name === 'import') render(root || document.getElementById('view'));
  }

  function preview(item) {
    const errors = I.validateMapping(item.mapping);
    if (errors.length) return { errors };
    const res = I.applyMapping(item.rows, item.mapping, item.account.trim() || 'Card', 'preview');
    const ctx = SA.store.ctx();
    const excluded = SA.store.excludedSet();
    let dupes = 0, payments = 0, charges = 0, credits = 0, nCharges = 0, nCredits = 0;
    const fresh = [];
    for (const t of res.transactions) {
      Object.assign(t, SA.rules.categorize(t, ctx));
      if (SA.store.getTxn(t.id)) { dupes++; continue; }
      fresh.push(t);
      if (excluded.has(t.category)) { payments++; continue; }
      if (t.amount > 0) { charges += t.amount; nCharges++; } else { credits -= t.amount; nCredits++; }
    }
    const dates = res.transactions.map((t) => t.date).sort();
    return { errors: [], res, fresh, dupes, payments, charges, credits, nCharges, nCredits, first: dates[0], last: dates[dates.length - 1] };
  }

  function colSelect(item, field, headers, required) {
    const opts = [['', required ? 'Choose…' : '— none —']].concat(headers.map((h, i) => [i, h]));
    const v = item.mapping.columns[field];
    return '<select data-col="' + field + '">' + SA.ui.options(opts, v == null ? '' : v) + '</select>';
  }

  function renderItem(item) {
    if (item.result) {
      const r = item.result;
      return '<div class="card" data-key="' + item.key + '"><div class="card-head"><div><h2>' + esc(item.fileName) + '</h2></div>' +
        '<button class="btn btn-ghost btn-sm" data-act="dismiss">Dismiss</button></div>' +
        '<div class="notice ok">Imported <strong>' + r.added + '</strong> new transaction' + (r.added === 1 ? '' : 's') + ' into “' + esc(r.account) + '”' +
        (r.duplicates ? ' · ' + r.duplicates + ' already imported, skipped' : '') + (r.skipped ? ' · ' + r.skipped + ' unreadable rows skipped' : '') + '.' +
        ' <a href="#/dashboard">View dashboard</a> · <a href="' + SA.ui.href('transactions', { account: r.account }) + '">Review transactions</a></div></div>';
    }
    const m = item.mapping;
    const headers = I.headersFor(item.rows, m.headerRow);
    const headerOpts = [[-1, 'No header row']].concat(item.rows.slice(0, 15).map((r, i) => [i, 'Row ' + (i + 1) + ': ' + r.filter(Boolean).slice(0, 3).join(', ').slice(0, 50)]));
    const p = preview(item);
    const accounts = SA.store.accounts();

    let html = '<div class="card" data-key="' + item.key + '">' +
      '<div class="card-head"><div><h2>' + esc(item.fileName) + '</h2>' +
      '<p class="small muted">' + (item.rows.length - (m.headerRow + 1)) + ' data rows' +
      (item.recognized ? ' · <span class="badge badge-manual">Recognized format — using your saved mapping</span>' : ' · Check the column mapping below') + '</p></div>' +
      '<button class="btn btn-ghost btn-sm" data-act="remove">Remove</button></div>' +
      '<div class="mapping-grid">' +
      '<label class="field"><span>Account name</span><input type="text" data-f="account" value="' + esc(item.account) + '" list="acct-list-' + item.key + '">' +
      '<datalist id="acct-list-' + item.key + '">' + accounts.map((a) => '<option value="' + esc(a) + '">').join('') + '</datalist></label>' +
      '<label class="field"><span>Header row</span><select data-f="headerRow">' + SA.ui.options(headerOpts, m.headerRow) + '</select></label>';
    for (const [field, label, req] of COLUMN_FIELDS) {
      html += '<label class="field"><span>' + label + (req ? '' : ' (optional)') + '</span>' + colSelect(item, field, headers, req) + '</label>';
      if (field === 'date') {
        html += '<label class="field"><span>Date format</span><select data-f="dateFormat">' +
          SA.ui.options([['MDY', 'MM/DD/YYYY'], ['DMY', 'DD/MM/YYYY'], ['YMD', 'YYYY-MM-DD']], m.dateFormat) + '</select></label>';
      }
    }
    html += '<label class="field"><span>Amounts are in</span><select data-f="amountMode">' +
      SA.ui.options([['single', 'One amount column'], ['split', 'Separate debit & credit columns']], m.amountMode) + '</select></label>';
    if (m.amountMode === 'single') {
      html += '<label class="field"><span>Amount column</span>' + colSelect(item, 'amount', headers, true) + '</label>' +
        '<label class="field"><span>Purchases appear as</span><select data-f="chargesArePositive">' +
        SA.ui.options([['true', 'Positive numbers'], ['false', 'Negative numbers']], String(m.chargesArePositive)) + '</select></label>';
    } else {
      html += '<label class="field"><span>Debit (purchases) column</span>' + colSelect(item, 'debit', headers, false) + '</label>' +
        '<label class="field"><span>Credit (payments/refunds) column</span>' + colSelect(item, 'credit', headers, false) + '</label>';
    }
    html += '</div>';

    if (p.errors.length) {
      html += '<div class="notice warn">' + p.errors.map(esc).join(' ') + '</div>';
    } else {
      const warnSign = p.nCredits > p.nCharges ? '<div class="notice warn" style="margin-bottom:10px">Refunds/credits outnumber purchases — check “Purchases appear as”.</div>' : '';
      html += warnSign + '<div class="preview-summary">' +
        '<span><strong>' + p.fresh.length + '</strong> new</span>' +
        (p.dupes ? '<span>' + p.dupes + ' already imported</span>' : '') +
        '<span>' + (p.first ? esc(U.formatDate(p.first)) + ' – ' + esc(U.formatDate(p.last)) : 'no dates') + '</span>' +
        '<span>Purchases ' + U.money(p.charges) + '</span><span>Refunds ' + U.money(p.credits) + '</span>' +
        '<span>' + p.payments + ' payment' + (p.payments === 1 ? '' : 's') + '/transfers excluded</span>' +
        (p.res.skipped.length ? '<span class="badge badge-warn">' + p.res.skipped.length + ' rows skipped</span>' : '') + '</div>';
      html += '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Description</th><th>Merchant</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>' +
        p.res.transactions.slice(0, 8).map((t) => '<tr' + (SA.store.excludedSet().has(t.category) ? ' class="excluded"' : '') + '><td class="num" style="text-align:left">' + esc(t.date) + '</td>' +
          '<td class="merchant-cell"><div class="desc" style="font-size:13px;color:var(--text-2)">' + esc(t.description) + '</div></td>' +
          '<td>' + esc(t.merchant) + '</td><td>' + esc(t.category) + '</td>' +
          '<td class="num' + (t.amount < 0 ? ' credit' : '') + '">' + U.money(t.amount) + '</td></tr>').join('') +
        '</tbody></table></div>';
      if (p.res.skipped.length) {
        html += '<details style="margin-top:8px"><summary>Skipped rows</summary><pre>' +
          p.res.skipped.slice(0, 50).map((s) => 'Line ' + s.line + ' (' + s.reason + '): ' + s.raw).map(esc).join('\n') + '</pre></details>';
      }
    }
    html += '<div class="row" style="margin-top:14px"><button class="btn btn-primary" data-act="import"' + (p.errors.length || !p.fresh.length ? ' disabled' : '') + '>' +
      (p.errors.length ? 'Import' : p.fresh.length ? 'Import ' + p.fresh.length + ' transaction' + (p.fresh.length === 1 ? '' : 's') : 'Nothing new to import') + '</button>' +
      '<span class="small muted">Use the same account name for every export from a card so overlapping exports dedupe.</span></div></div>';
    return html;
  }

  function renderHistory() {
    const imports = SA.store.state.imports.slice().sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    if (!imports.length) return '';
    return '<div class="card"><div class="card-head"><h2>Import history</h2><span class="small muted">Deleting an import removes its transactions</span></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>File</th><th>Account</th><th>Imported</th><th class="num">Added</th><th class="num">Duplicates</th><th></th></tr></thead><tbody>' +
      imports.map((i) => '<tr><td>' + esc(i.fileName) + '</td><td>' + esc(i.account) + '</td><td class="secondary">' + esc(new Date(i.importedAt).toLocaleString()) + '</td>' +
        '<td class="num">' + i.added + '</td><td class="num">' + i.duplicates + '</td>' +
        '<td class="num"><button class="btn btn-ghost btn-sm btn-danger" data-del-import="' + esc(i.id) + '">Delete</button></td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function render(el) {
    root = el;
    const c = document.createElement('div'); // fresh container per render so listeners never stack
    c.innerHTML = '<div class="page-head"><h1>Import</h1><span class="secondary small">CSV exports from any card issuer</span></div>' +
      '<div class="stack">' +
      '<div class="dropzone" tabindex="0" role="button" aria-label="Choose CSV files to import">' +
      '<h2>Drop credit card CSV exports here</h2><p class="secondary" style="margin:0">or click to choose files · several at once is fine</p>' +
      '<p class="small muted" style="margin:8px 0 0">Files are read by this page only. Nothing is uploaded.</p>' +
      '<input type="file" accept=".csv,text/csv,.txt" multiple class="hidden"></div>' +
      (pending.length > 1 && pending.some((p) => !p.result) ? '<div class="row"><button class="btn btn-primary" data-act="import-all">Import all files</button></div>' : '') +
      pending.map(renderItem).join('') +
      renderHistory() +
      '</div>';
    el.replaceChildren(c);
    bind(c);
  }

  function itemFor(target) {
    const card = target.closest('[data-key]');
    return card ? pending.find((p) => p.key === card.dataset.key) : null;
  }

  async function doImport(item) {
    const p = preview(item);
    if (p.errors.length || !p.fresh.length) return;
    const account = item.account.trim() || 'Card';
    const sig = I.signature(item.rows, item.mapping.headerRow);
    const mappingRecord = Object.assign({ id: 'map_' + U.hash(sig), signature: sig, account, updatedAt: new Date().toISOString() },
      JSON.parse(JSON.stringify(item.mapping)));
    const importId = U.uid('imp');
    const txns = I.applyMapping(item.rows, item.mapping, account, importId).transactions;
    item.result = await SA.store.importTransactions(txns, { id: importId, fileName: item.fileName, account, mappingId: mappingRecord.id, skipped: p.res.skipped.length }, mappingRecord);
  }

  function bind(el) {
    const dz = el.querySelector('.dropzone');
    const input = dz.querySelector('input[type=file]');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); });

    el.addEventListener('change', onChange);
    el.addEventListener('input', U.debounce((e) => { if (e.target.dataset.f === 'account') { const it = itemFor(e.target); if (it) { it.account = e.target.value; rerenderItem(it); } } }, 400));
    el.addEventListener('click', onClick);
  }

  function rerenderItem(item) {
    const card = root.querySelector('[data-key="' + item.key + '"]');
    if (!card) return;
    const focusedSel = document.activeElement && card.contains(document.activeElement) ? (document.activeElement.dataset.f || document.activeElement.dataset.col) : null;
    const tmp = document.createElement('div');
    tmp.innerHTML = renderItem(item);
    card.replaceWith(tmp.firstElementChild);
    if (focusedSel) {
      const again = root.querySelector('[data-key="' + item.key + '"] [data-f="' + focusedSel + '"], [data-key="' + item.key + '"] [data-col="' + focusedSel + '"]');
      if (again) { again.focus(); if (again.setSelectionRange && again.value) again.setSelectionRange(again.value.length, again.value.length); }
    }
  }

  function onChange(e) {
    const t = e.target;
    const item = itemFor(t);
    if (!item || item.result) return;
    const m = item.mapping;
    if (t.dataset.col) {
      m.columns[t.dataset.col] = t.value === '' ? null : +t.value;
      if (t.dataset.col === 'amount' || t.dataset.col === 'description') m.chargesArePositive = I.detectChargesPositive(item.rows, m);
      if (t.dataset.col === 'date') m.dateFormat = SA.normalize.detectDateFormat(item.rows.slice(m.headerRow + 1, m.headerRow + 200).map((r) => r[m.columns.date]));
    } else if (t.dataset.f === 'headerRow') {
      item.mapping = I.guessMapping(item.rows, +t.value);
      item.recognized = false;
    } else if (t.dataset.f === 'amountMode') {
      m.amountMode = t.value;
      m.chargesArePositive = I.detectChargesPositive(item.rows, m);
    } else if (t.dataset.f === 'chargesArePositive') {
      m.chargesArePositive = t.value === 'true';
    } else if (t.dataset.f === 'dateFormat') {
      m.dateFormat = t.value;
    } else if (t.dataset.f === 'account') {
      item.account = t.value;
    } else return;
    rerenderItem(item);
  }

  async function onClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.delImport) {
      const rec = SA.store.state.imports.find((i) => i.id === btn.dataset.delImport);
      if (!rec || !confirm('Delete the import of “' + rec.fileName + '” and its ' + rec.added + ' transactions?')) return;
      const n = await SA.store.deleteImport(rec.id);
      SA.ui.toast('Removed ' + n + ' transactions.');
      render(root);
      return;
    }
    const act = btn.dataset.act;
    if (act === 'import-all') {
      btn.disabled = true;
      for (const item of pending.filter((p) => !p.result)) await doImport(item);
      render(root);
      return;
    }
    const item = itemFor(btn);
    if (!item) return;
    if (act === 'remove' || act === 'dismiss') {
      pending.splice(pending.indexOf(item), 1);
      render(root);
    } else if (act === 'import') {
      btn.disabled = true;
      btn.textContent = 'Importing…';
      try { await doImport(item); } catch (err) { SA.ui.toast('Import failed: ' + err.message); }
      render(root);
    }
  }

  SA.views = SA.views || {};
  SA.views.import = { render, addFiles };
})(window.SA = window.SA || {});
