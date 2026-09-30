/* CSV -> normalized transactions. Handles header detection, column-mapping guesses, sign conventions, and dedupe ids. */
(function (SA) {
  'use strict';
  const N = SA.normalize;
  const D = SA.defaults;

  function parseCsv(text) {
    const res = Papa.parse(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
    return res.data.map((r) => r.map((c) => (c == null ? '' : N.decodeEntities(String(c)))));
  }

  // Index of the header row, or -1 if the file has none (e.g. Wells Fargo). Skips preamble lines.
  function detectHeaderRow(rows) {
    const limit = Math.min(rows.length, 15);
    for (let i = 0; i < limit; i++) {
      if (!rows[i].some(N.looksLikeDate)) continue;
      // rows[i] is the first data row; the header (if any) sits directly above it.
      return i > 0 && isHeaderish(rows[i - 1]) ? i - 1 : -1;
    }
    return rows.length ? 0 : -1;
  }
  function isHeaderish(row) {
    const cells = row.filter((c) => c.trim());
    return cells.length >= 2 && !cells.some((c) => N.looksLikeDate(c) || N.looksLikeAmount(c));
  }

  function headersFor(rows, headerRow) {
    const width = Math.max(0, ...rows.slice(Math.max(headerRow, 0), Math.max(headerRow, 0) + 20).map((r) => r.length));
    const out = [];
    for (let i = 0; i < width; i++) {
      const h = headerRow >= 0 ? (rows[headerRow][i] || '').trim() : '';
      out.push(h || 'Column ' + (i + 1));
    }
    return out;
  }

  function signature(rows, headerRow) {
    if (headerRow < 0) return 'nohdr:' + headersFor(rows, -1).length;
    return rows[headerRow].map((h) => h.trim().toLowerCase()).join('|');
  }

  // First header matching the earliest pattern in the list wins.
  function pick(headers, patterns, taken) {
    for (const re of patterns) {
      const i = headers.findIndex((h, idx) => re.test(h.trim()) && !taken.includes(idx));
      if (i >= 0) return i;
    }
    return null;
  }

  function guessMapping(rows, headerRow) {
    const headers = headersFor(rows, headerRow);
    const data = rows.slice(headerRow + 1, headerRow + 51);
    const cols = { date: null, description: null, amount: null, debit: null, credit: null, category: null, type: null, merchant: null, status: null };
    const taken = [];
    const take = (k, pats) => { cols[k] = pick(headers, pats, taken); if (cols[k] != null) taken.push(cols[k]); };

    if (headerRow >= 0) {
      take('date', [/^trans(action)?\.? ?date$/i, /^date$/i, /^(posted|post|posting) ?date$/i, /date/i]);
      take('merchant', [/^merchant( name)?$/i]);
      take('description', [/^description$/i, /^(payee|merchant|name|details|memo|transaction)$/i, /desc|payee|details|memo|narrative/i]);
      take('amount', [/^amount$/i, /^amount \(.*\)$/i, /^(transaction )?amount/i, /^amt$/i]);
      if (cols.amount == null) {
        take('debit', [/^debit/i, /withdrawal|charge/i]);
        take('credit', [/^credit/i, /deposit|payment/i]);
      }
      take('category', [/^category$/i, /category/i]);
      take('type', [/^type$/i, /^transaction type$/i]);
      take('status', [/^status$/i, /^transaction status$/i]);
    }
    // Fall back to content sniffing (no header, or unrecognized header names).
    const colVals = (i) => data.map((r) => r[i] || '');
    const score = (i, fn) => { const v = colVals(i).filter((x) => x.trim()); return v.length ? v.filter(fn).length / v.length : 0; };
    if (cols.date == null) {
      const i = headers.findIndex((_, i) => !taken.includes(i) && score(i, N.looksLikeDate) > 0.8);
      if (i >= 0) { cols.date = i; taken.push(i); }
    }
    if (cols.amount == null && cols.debit == null) {
      const i = headers.findIndex((_, i) => !taken.includes(i) && score(i, (v) => N.looksLikeAmount(v) && /[.]\d{2}\b/.test(v)) > 0.8);
      if (i >= 0) { cols.amount = i; taken.push(i); }
    }
    if (cols.description == null) {
      // The text column with the most distinct values.
      let best = null, bestDistinct = 0;
      headers.forEach((_, i) => {
        if (taken.includes(i)) return;
        const v = colVals(i);
        if (score(i, (x) => /[A-Za-z]{3}/.test(x)) < 0.8) return;
        const distinct = new Set(v).size;
        if (distinct > bestDistinct) { best = i; bestDistinct = distinct; }
      });
      cols.description = best;
    }

    const amountMode = cols.amount == null && (cols.debit != null || cols.credit != null) ? 'split' : 'single';
    const mapping = {
      headerRow,
      columns: cols,
      amountMode,
      dateFormat: cols.date != null ? N.detectDateFormat(colVals(cols.date)) : 'MDY',
      chargesArePositive: true,
    };
    mapping.chargesArePositive = detectChargesPositive(rows, mapping);
    return mapping;
  }

  function isPaymentLike(desc, type) {
    return D.PAYMENT_DESC.test(desc || '') || D.PAYMENT_TYPE.test(type || '');
  }

  // Charges are the opposite sign of payments; without payment rows, the majority sign is charges.
  function detectChargesPositive(rows, mapping) {
    const c = mapping.columns;
    if (mapping.amountMode !== 'single' || c.amount == null) return true;
    let payPos = 0, payNeg = 0, pos = 0, neg = 0;
    for (const r of rows.slice(mapping.headerRow + 1)) {
      const a = N.parseAmount(r[c.amount]);
      if (!a) continue;
      a > 0 ? pos++ : neg++;
      if (isPaymentLike(r[c.description], c.type != null ? r[c.type] : '')) a > 0 ? payPos++ : payNeg++;
    }
    if (payPos + payNeg > 0 && payPos !== payNeg) return payNeg > payPos;
    return pos >= neg;
  }

  function validateMapping(m) {
    const c = m.columns;
    const errs = [];
    if (c.date == null) errs.push('Choose the date column.');
    if (c.description == null) errs.push('Choose the description column.');
    if (m.amountMode === 'single' && c.amount == null) errs.push('Choose the amount column.');
    if (m.amountMode === 'split' && c.debit == null && c.credit == null) errs.push('Choose the debit and/or credit columns.');
    return errs;
  }

  /**
   * Apply a mapping to parsed rows.
   * Returns { transactions, skipped: [{line, reason, raw}] }. Transactions have amount > 0 for charges,
   * < 0 for refunds/credits/payments; categorization happens later (SA.rules).
   */
  function applyMapping(rows, m, account, importId) {
    const c = m.columns;
    const out = [];
    const skipped = [];
    const occurrences = new Map();
    const start = m.headerRow + 1;
    const nameOpts = { location: N.hasLocations(rows.slice(start).map((r) => r[c.description])) };
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 1;
      // Pending charges can change amount before they clear (tips, holds), which would import them twice.
      if (c.status != null && /pending|authori[sz]/i.test(r[c.status] || '')) { skipped.push({ line, reason: 'Pending', raw: r.join(', ') }); continue; }
      const date = N.parseDate(r[c.date], m.dateFormat);
      if (!date) { skipped.push({ line, reason: 'No valid date', raw: r.join(', ') }); continue; }
      let amount;
      if (m.amountMode === 'split') {
        const d = c.debit != null ? N.parseAmount(r[c.debit]) : null;
        const cr = c.credit != null ? N.parseAmount(r[c.credit]) : null;
        if (d == null && cr == null) { skipped.push({ line, reason: 'No amount', raw: r.join(', ') }); continue; }
        amount = Math.abs(d || 0) - Math.abs(cr || 0);
      } else {
        const a = N.parseAmount(r[c.amount]);
        if (a == null) { skipped.push({ line, reason: 'No amount', raw: r.join(', ') }); continue; }
        amount = m.chargesArePositive ? a : -a;
      }
      amount = SA.util.round2(amount) || 0;
      if (amount === 0) { skipped.push({ line, reason: 'Zero amount', raw: r.join(', ') }); continue; }
      const description = String(r[c.description] || '').replace(/\s+/g, ' ').trim();
      const rawMerchant = c.merchant != null ? String(r[c.merchant] || '').trim() : '';
      const merchant = rawMerchant ? N.titleCase(rawMerchant.toUpperCase()) : N.cleanMerchant(r[c.description], nameOpts);

      // Deterministic id: identical rows within one file are numbered so re-imports and overlapping exports dedupe.
      const key = [account, date, amount.toFixed(2), description.toLowerCase()].join('|');
      const occ = (occurrences.get(key) || 0) + 1;
      occurrences.set(key, occ);

      out.push({
        id: 't_' + SA.util.hash(key + '|' + occ),
        importId,
        account,
        date,
        description,
        merchant,
        amount,
        issuerCategory: c.category != null ? (r[c.category] || '').trim() || null : null,
        issuerType: c.type != null ? (r[c.type] || '').trim() || null : null,
        category: null,
        categorySource: null,
        ruleId: null,
      });
    }
    return { transactions: out, skipped };
  }

  SA.importer = { parseCsv, detectHeaderRow, headersFor, signature, guessMapping, detectChargesPositive, validateMapping, applyMapping, isPaymentLike };
})(window.SA = window.SA || {});
