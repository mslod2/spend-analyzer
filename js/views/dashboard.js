/* Dashboard: stat tiles, spending by category, spending over time (month / week / day), top merchants. */
(function (SA) {
  'use strict';
  const U = SA.util, A = SA.analytics, esc = U.esc;

  let root = null;
  let charts = [];
  // tstart/tend: custom date range for the spending-over-time card ('' = the granularity's default window).
  const f = { period: 'all', from: '', to: '', account: '', by: 'month', tstart: '', tend: '' };
  const TOP_MERCHANTS = 15;
  const MAX_TABLE_BUCKETS = 12;

  // Spending-over-time granularity. `window` names the default range, which ends at the latest transaction.
  const GRAIN = {
    month: { label: 'Month', unit: 'month', window: 'Most recent year', short: U.shortMonthLabel, long: (k) => U.monthLabel(k),
      prev: (k) => 'vs ' + U.monthLabel(k, false) },
    week: { label: 'Week', unit: 'week', window: 'Most recent month', short: U.shortDate, long: (k) => 'Week of ' + U.formatDate(k), prev: () => 'vs prior week' },
    day: { label: 'Day', unit: 'day', window: 'Most recent week', short: U.shortDate, long: (k) => U.weekdayLabel(k) + ', ' + U.formatDate(k), prev: () => 'vs prior day' },
  };

  function compactMoney(v) {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : Math.round(a).toString();
    return (v < 0 ? '−$' : '$') + s;
  }

  // A small net refund shouldn't stretch the axis to a "nice" -$5K; clamp to the negative extent, rounded out to a
  // half power of ten so the bottom tick reads cleanly (-127 -> -150, -100 -> -100).
  function negMin(values) {
    const m = Math.min(0, ...values);
    if (!(m < 0)) return undefined;
    const step = Math.pow(10, Math.floor(Math.log10(-m))) / 2;
    return Math.floor(m / step) * step;
  }

  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  function tile(label, value, sub, extra) {
    return '<div class="card tile"><div class="label">' + label + '</div><div class="value">' + value + '</div><div class="sub">' + sub + '</div>' + (extra || '') + '</div>';
  }

  function render(el, params) {
    root = el;
    destroyCharts();
    if (params && Object.keys(params).length) Object.assign(f, params);
    const st = SA.store.state;
    if (!st.transactions.length) {
      el.innerHTML = '<div class="card empty"><h2>Welcome</h2><p>Import one or more credit card CSV exports to see where your money goes.<br>Everything stays in this browser.</p>' +
        '<a class="btn btn-primary" href="#/import">Import CSV</a></div>';
      return;
    }

    const allMonths = A.dataMonths(st.transactions);
    const period = A.resolvePeriod(f.period, { from: f.from, to: f.to }, allMonths);
    f.resolved = period;
    const txns = A.filterTxns(st.transactions, { from: period.from, to: period.to, account: f.account });
    const excluded = SA.store.excludedSet();
    const income = A.monthlyIncome(st.settings.income);
    const s = A.summarize(txns, { excluded, monthlyIncome: income, months: period.months });
    const colors = SA.ui.categoryColors();
    const lastDate = st.transactions.reduce((m, t) => (t.date > m ? t.date : m), '');

    const trend = trendSeries(excluded);

    const monthOpts = allMonths.slice().reverse().map((m) => [m, U.monthLabel(m)]);
    const accounts = SA.store.accounts();
    const top = s.byCategory.find((c) => c.total > 0);
    const uncat = s.byCategory.find((c) => c.category === SA.defaults.UNCATEGORIZED);

    const c = document.createElement('div');
    c.innerHTML =
      '<div class="page-head"><h1>Dashboard</h1><span class="small muted">Data through ' + esc(U.formatDate(lastDate)) + '</span></div>' +
      '<div class="filters">' +
      '<select data-f="period" aria-label="Period">' + SA.ui.options(A.PERIODS, f.period) + '</select>' +
      (f.period === 'custom'
        ? '<select data-f="from" aria-label="From month">' + SA.ui.options(monthOpts, period.from) + '</select><span class="secondary">to</span>' +
          '<select data-f="to" aria-label="To month">' + SA.ui.options(monthOpts, period.to) + '</select>' : '') +
      (accounts.length > 1 ? '<select data-f="account" aria-label="Account">' + SA.ui.options([['', 'All accounts']].concat(accounts), f.account) + '</select>' : '') +
      '<span class="range-label">' + esc(period.label) + ' · ' + period.months.length + ' month' + (period.months.length === 1 ? '' : 's') + '</span></div>' +
      (income ? '' : '<div class="notice" style="margin-bottom:16px">Add your take-home pay in <a href="#/settings">Settings</a> to see spending as a share of income.</div>') +
      (uncat ? '<div class="notice" style="margin-bottom:16px">' + uncat.count + ' transaction' + (uncat.count === 1 ? '' : 's') + ' (' + U.money(uncat.total, { whole: true }) +
        ') in this period ' + (uncat.count === 1 ? 'is' : 'are') + ' uncategorized. <a href="' +
        SA.ui.href('transactions', { from: period.from, to: period.to, account: f.account, category: SA.defaults.UNCATEGORIZED }) + '">Review and add rules →</a></div>' : '') +
      '<div class="stack">' +
      '<div class="tiles">' +
      tile('Net spending', U.money(s.total, { whole: true }), 'Purchases ' + U.money(s.charges, { whole: true }) + ' − refunds ' + U.money(s.credits, { whole: true })) +
      tile('Monthly average', U.money(s.avgMonthly, { whole: true }), 'over ' + s.monthsCount + ' month' + (s.monthsCount === 1 ? '' : 's')) +
      (income
        ? tile('Share of take-home pay', U.pct(s.pctIncome, 0), 'of ' + U.money(s.incomeForPeriod, { whole: true }) + ' take-home' + (s.pctIncome > 1 ? ' · <strong>over income</strong>' : ''),
          '<div class="meter" role="img" aria-label="' + U.pct(s.pctIncome, 0) + ' of take-home"><div style="width:' + Math.min(100, Math.max(0, s.pctIncome * 100)).toFixed(1) + '%"></div></div>')
        : tile('Share of take-home pay', '—', '<a href="#/settings">Set take-home pay</a>')) +
      (top ? tile('Top category', esc(top.category), U.money(top.total, { whole: true }) + ' · ' + U.pct(top.pctSpend, 0) + ' of spending') : tile('Top category', '—', 'No spending')) +
      '</div>' +
      renderCategoryCard(s, income, colors) +
      renderTrendCard(trend, income, colors) +
      renderMerchantCard(s, colors) +
      '</div>';
    el.replaceChildren(c);
    bind(c);
    drawCategoryChart(c, s);
    drawTrendChart(c, trend, income, colors);
  }

  // ---------- Category ----------
  function renderCategoryCard(s, income, colors) {
    if (!s.byCategory.length) return '<div class="card empty">No spending in this period.</div>';
    const h = Math.max(120, s.byCategory.length * 30 + 36);
    return '<div class="card"><div class="card-head"><div><h2>Spending by category</h2><p class="small muted">Net of refunds · payments, transfers and rewards excluded · click a row for its transactions</p></div></div>' +
      '<div class="split"><div class="chart-box" style="height:' + h + 'px"><canvas id="cat-chart" role="img" aria-label="Bar chart of spending by category. Values are listed in the table."></canvas></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th class="num">Total</th><th class="num">% of spend</th>' +
      (income ? '<th class="num">% of take-home</th>' : '') + '<th class="num">Txns</th></tr></thead><tbody>' +
      s.byCategory.map((r) => '<tr class="clickable" data-cat="' + esc(r.category) + '" tabindex="0">' +
        '<td><span class="swatch" style="background:' + colors.colorOf(r.category) + '"></span>' + esc(r.category) + '</td>' +
        '<td class="num">' + U.money(r.total) + '</td><td class="num">' + U.pct(r.pctSpend) + '</td>' +
        (income ? '<td class="num">' + U.pct(r.pctIncome) + '</td>' : '') + '<td class="num">' + r.count + '</td></tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td><td class="num">' + U.money(s.total) + '</td><td class="num">100%</td>' +
      (income ? '<td class="num">' + U.pct(s.pctIncome) + '</td>' : '') + '<td class="num">' + s.count + '</td></tr></tfoot></table></div></div></div>';
  }

  // Draws each bar's value just past its tip; negative (net-refund) bars get it just right of the zero line,
  // so it never collides with the category labels on the left.
  const tipLabels = {
    id: 'tipLabels',
    afterDatasetsDraw(chart, args, opts) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '11px ' + getComputedStyle(document.body).fontFamily;
      ctx.fillStyle = opts.color;
      ctx.textBaseline = 'middle';
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i];
        ctx.textAlign = 'left';
        ctx.fillText(compactMoney(v), Math.max(bar.x, bar.base) + 6, bar.y);
      });
      ctx.restore();
    },
  };

  function drawCategoryChart(c, s) {
    const canvas = c.querySelector('#cat-chart');
    if (!canvas) return;
    const th = SA.ui.chartTheme();
    const rows = s.byCategory;
    charts.push(new Chart(canvas, {
      type: 'bar',
      data: { labels: rows.map((r) => r.category), datasets: [{ data: rows.map((r) => r.total), backgroundColor: th.series1, hoverBackgroundColor: th.series1,
        borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18, categoryPercentage: 0.8, barPercentage: 0.9 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { right: 56 } },
        interaction: { mode: 'index', axis: 'y', intersect: false },
        scales: {
          x: { beginAtZero: true, min: negMin(rows.map((r) => r.total)), grid: { color: th.grid }, border: { display: false }, ticks: { color: th.muted, maxTicksLimit: 5, callback: compactMoney, font: { size: 11 } } },
          y: { grid: { display: false }, border: { color: th.axis }, ticks: { color: th.text2, autoSkip: false, font: { size: 12 } } },
        },
        plugins: {
          legend: { display: false },
          tipLabels: { color: th.text2 },
          tooltip: Object.assign(SA.ui.tooltipStyle(th), {
            displayColors: false,
            callbacks: { label: (ctx) => { const r = rows[ctx.dataIndex]; return [U.money(r.total) + (r.pctSpend != null ? ' · ' + U.pct(r.pctSpend) + ' of spending' : ''), r.count + ' transactions']; } },
          }),
        },
        onClick: (e, els) => { if (els.length) SA.ui.go('transactions', { from: f.resolved.from, to: f.resolved.to, account: f.account, category: rows[els[0].index].category }); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      },
      plugins: [tipLabels],
    }));
  }

  // ---------- Spending over time ----------
  function grainKey() { return GRAIN[f.by] ? f.by : 'month'; }

  // Past this many bars the chart stops being readable; suggest a coarser granularity.
  const MAX_READABLE_BUCKETS = 60;

  // Default windows: the latest 12 months, the latest ~month of whole weeks (5), the latest 7 days.
  function defaultRange(grain, firstDate, lastDate) {
    let start = grain === 'month' ? U.addMonths(lastDate.slice(0, 7), -11) + '-01'
      : grain === 'week' ? A.weekStart(U.addDays(lastDate, -27))
      : U.addDays(lastDate, -6);
    if (start < firstDate) start = grain === 'month' ? firstDate.slice(0, 7) + '-01' : firstDate;
    return { start, end: lastDate };
  }

  /**
   * The spending-over-time card has its own date range, independent of the dashboard period: a custom range if the
   * user picked one, otherwise the granularity's default window ending at the latest transaction.
   */
  function trendSeries(excluded) {
    const grain = grainKey();
    const all = SA.store.state.transactions;
    const txns = f.account ? all.filter((t) => t.account === f.account) : all;
    const dated = txns.length ? txns : all;
    const firstDate = dated.reduce((m, t) => (t.date < m ? t.date : m), dated[0].date);
    const lastDate = dated.reduce((m, t) => (t.date > m ? t.date : m), '');
    const def = defaultRange(grain, firstDate, lastDate);
    const custom = !!(f.tstart || f.tend);
    let start = f.tstart || def.start, end = f.tend || def.end;
    if (start > end) [start, end] = [end, start];
    return Object.assign(A.timeSeries(txns, { excluded, grain, start, end }), { custom, firstDate, lastDate });
  }

  function trendDatasets(trend, colors) {
    // Top-ranked categories (stable across filters) get their own stack segment; the rest fold into one bucket.
    const own = colors.rank.filter((cat) => trend.byCat[cat]);
    const rest = Object.keys(trend.byCat).filter((cat) => !own.includes(cat));
    const at = (cat, k) => trend.byCat[cat][k] || 0;
    const series = own.map((cat) => ({ label: cat, color: colors.colorOf(cat), data: trend.keys.map((k) => U.round2(at(cat, k))) }));
    if (rest.length) series.push({ label: 'All other categories', color: colors.other, data: trend.keys.map((k) => U.round2(U.sum(rest, (cat) => at(cat, k)))), members: rest });
    return series;
  }

  function renderTrendCard(trend, income, colors) {
    const g = GRAIN[trend.grain];
    const series = trendDatasets(trend, colors);
    const per = A.incomePerBucket(income, trend.grain);
    const keys = trend.keys;
    const note = trend.grain === 'week' ? ' · weeks start Sunday' : '';
    const coarser = trend.grain === 'day' ? 'week' : trend.grain === 'week' ? 'month' : null;
    const range = '<div class="filters trend-range">' +
      '<span class="small secondary">' + (trend.custom ? 'Custom range' : g.window) + '</span>' +
      '<label class="row small secondary">From <input type="date" data-t="tstart" value="' + trend.start + '" min="' + trend.firstDate + '" max="' + trend.lastDate + '" aria-label="Start date"></label>' +
      '<label class="row small secondary">to <input type="date" data-t="tend" value="' + trend.end + '" min="' + trend.firstDate + '" max="' + trend.lastDate + '" aria-label="End date"></label>' +
      (trend.custom ? '<button type="button" class="btn btn-ghost btn-sm" data-act="trend-reset">Reset to ' + esc(g.window.toLowerCase()) + '</button>' : '') +
      '</div>' +
      (keys.length > MAX_READABLE_BUCKETS && coarser
        ? '<div class="notice" style="margin-bottom:12px">' + keys.length + ' ' + g.unit + 's in this range — the bars get too thin to read. ' +
          '<a href="#" data-act="trend-by" data-by="' + coarser + '">Group by ' + coarser + '</a> or shorten the range.</div>' : '');
    const tKeys = keys.slice(-MAX_TABLE_BUCKETS);
    const at = (cat, k) => trend.byCat[cat][k] || 0;
    const cats = Object.keys(trend.byCat).sort((a, b) => U.sum(tKeys, (k) => at(b, k)) - U.sum(tKeys, (k) => at(a, k)));
    const last = tKeys[tKeys.length - 1], prev = tKeys[tKeys.length - 2];
    const delta = (a, b) => {
      const d = (a || 0) - (b || 0);
      if (Math.abs(d) < 0.5) return '<span class="muted">—</span>';
      return '<span title="' + (d > 0 ? 'More' : 'Less') + ' than ' + esc(g.long(prev)) + '">' + (d > 0 ? '▲ ' : '▼ ') + U.money(Math.abs(d), { whole: true }) + '</span>';
    };
    const avgOf = (fn) => U.sum(tKeys, fn) / tKeys.length;
    const toggle = '<div class="seg" role="radiogroup" aria-label="Group spending by">' + Object.entries(GRAIN).map(([key, x]) =>
      '<label><input type="radio" name="trend-by" value="' + key + '"' + (key === trend.grain ? ' checked' : '') + '>' + x.label + '</label>').join('') + '</div>';
    return '<div class="card" id="trend-card"><div class="card-head"><div><h2>Spending over time</h2><p class="small muted">Net spending per ' + g.unit + ' by category' + esc(note) + '</p></div>' + toggle + '</div>' + range +
      '<div class="legend">' + series.map((sr) => '<span' + (sr.members ? ' title="' + esc(sr.members.join(', ')) + '"' : '') + '><i class="swatch" style="background:' + sr.color + '"></i>' + esc(sr.label) + '</span>').join('') +
      (per ? '<span><i class="line-key"></i>Take-home pay' + (trend.grain === 'month' ? '' : ' per ' + g.unit) + '</span>' : '') + '</div>' +
      '<div class="chart-box" style="height:300px"><canvas id="trend-chart" role="img" aria-label="Stacked column chart of spending per ' + g.unit + ' by category. Recent values are listed in the table below."></canvas></div>' +
      '<div class="table-wrap" style="margin-top:16px"><table class="data"><thead><tr><th>Category</th>' +
      tKeys.map((k) => '<th class="num" title="' + esc(g.long(k)) + '">' + esc(g.short(k)) + '</th>').join('') +
      '<th class="num">Avg</th>' + (prev ? '<th class="num">' + esc(g.prev(prev)) + '</th>' : '') + '</tr></thead><tbody>' +
      cats.map((cat) => '<tr class="clickable" data-cat="' + esc(cat) + '" data-start="' + trend.start + '" data-end="' + trend.end + '" tabindex="0"><td><span class="swatch" style="background:' + colors.colorOf(cat) + '"></span>' + esc(cat) + '</td>' +
        tKeys.map((k) => '<td class="num">' + (at(cat, k) ? U.money(at(cat, k), { whole: true }) : '<span class="muted">–</span>') + '</td>').join('') +
        '<td class="num">' + U.money(avgOf((k) => at(cat, k)), { whole: true }) + '</td>' +
        (prev ? '<td class="num">' + delta(at(cat, last), at(cat, prev)) + '</td>' : '') + '</tr>').join('') +
      '</tbody><tfoot><tr><td>Total</td>' + tKeys.map((k) => '<td class="num">' + U.money(trend.totals[k], { whole: true }) + '</td>').join('') +
      '<td class="num">' + U.money(avgOf((k) => trend.totals[k]), { whole: true }) + '</td>' +
      (prev ? '<td class="num">' + delta(trend.totals[last], trend.totals[prev]) + '</td>' : '') + '</tr>' +
      (per ? '<tr><td class="secondary" style="font-weight:400">% of take-home</td>' + tKeys.map((k) => '<td class="num secondary" style="font-weight:400">' + U.pct(trend.totals[k] / per, 0) + '</td>').join('') +
        '<td class="num secondary" style="font-weight:400">' + U.pct(avgOf((k) => trend.totals[k]) / per, 0) + '</td>' + (prev ? '<td></td>' : '') + '</tr>' : '') +
      '</tfoot></table></div>' +
      (keys.length > tKeys.length ? '<p class="small muted" style="margin:8px 0 0">Table shows the last ' + tKeys.length + ' ' + g.unit + 's; the chart shows all ' + keys.length + '.</p>' : '') +
      '</div>';
  }

  function drawTrendChart(c, trend, income, colors) {
    const canvas = c.querySelector('#trend-chart');
    if (!canvas) return;
    const th = SA.ui.chartTheme();
    const g = GRAIN[trend.grain];
    const keys = trend.keys;
    const series = trendDatasets(trend, colors);
    const per = A.incomePerBucket(income, trend.grain);
    // Round only the top segment of each stack. Many thin bars (daily view) get a 1px gap so small segments survive.
    const topIdx = keys.map((_, i) => { let k = -1; series.forEach((sr, j) => { if (sr.data[i] > 0) k = j; }); return k; });
    const gap = keys.length > MAX_READABLE_BUCKETS ? 1 : 2;
    const datasets = series.map((sr, j) => ({
      type: 'bar', label: sr.label, data: sr.data, backgroundColor: sr.color, hoverBackgroundColor: sr.color, stack: 'spend', order: 2,
      borderColor: th.surface, borderWidth: { top: gap }, borderSkipped: 'start', maxBarThickness: 24,
      borderRadius: (ctx) => (topIdx[ctx.dataIndex] === j ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 } : 0),
    }));
    if (per) {
      datasets.push({ type: 'line', label: 'Take-home pay', data: keys.map(() => per), borderColor: th.refLine, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 0, order: 1, stack: 'income', fill: false });
    }
    charts.push(new Chart(canvas, {
      data: { labels: keys.map(g.short), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { color: th.axis }, ticks: { color: th.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 16 } },
          y: { stacked: true, beginAtZero: true, min: negMin(keys.map((_, i) => U.sum(series, (sr) => Math.min(0, sr.data[i])))), grid: { color: th.grid }, border: { display: false }, ticks: { color: th.muted, maxTicksLimit: 6, callback: compactMoney, font: { size: 11 } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: Object.assign(SA.ui.tooltipStyle(th), {
            filter: (item) => item.dataset.type !== 'line' && Math.abs(item.parsed.y) >= 0.5,
            itemSort: (a, b) => b.parsed.y - a.parsed.y,
            callbacks: {
              title: (items) => items.length ? g.long(keys[items[0].dataIndex]) : '',
              label: (item) => ' ' + item.dataset.label + ': ' + U.money(item.parsed.y, { whole: true }),
              labelColor: (item) => ({ backgroundColor: item.dataset.backgroundColor, borderColor: item.dataset.backgroundColor, borderRadius: 2 }),
              footer: (items) => {
                if (!items.length) return '';
                const tot = trend.totals[keys[items[0].dataIndex]] || 0;
                return 'Total ' + U.money(tot, { whole: true }) + (per ? ' · ' + U.pct(tot / per, 0) + ' of take-home' : '');
              },
            },
          }),
        },
      },
    }));
  }

  // ---------- Merchants ----------
  function renderMerchantCard(s, colors) {
    const list = s.byMerchant.filter((m) => m.total > 0).slice(0, TOP_MERCHANTS);
    if (!list.length) return '';
    const max = list[0].total;
    return '<div class="card"><div class="card-head"><div><h2>Top merchants</h2><p class="small muted">By net spending in this period</p></div></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th class="num" style="width:32px">#</th><th>Merchant</th><th>Category</th><th class="num">Txns</th><th class="num">Total</th><th class="num">% of spend</th><th style="width:22%"></th></tr></thead><tbody>' +
      list.map((m, i) => '<tr class="clickable" data-merchant="' + esc(m.merchant) + '" tabindex="0"><td class="num muted">' + (i + 1) + '</td><td>' + esc(m.merchant) + '</td>' +
        '<td class="secondary"><span class="swatch" style="background:' + colors.colorOf(m.category) + '"></span>' + esc(m.category) + '</td>' +
        '<td class="num">' + m.count + '</td><td class="num">' + U.money(m.total) + '</td><td class="num">' + U.pct(m.pctSpend) + '</td>' +
        '<td class="cell-bar"><div class="bar" style="width:' + (m.total / max * 100).toFixed(1) + '%"></div></td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function bind(c) {
    // Re-render in place, keeping scroll position and focus on the control that changed.
    const rerender = (focusSel) => {
      history.replaceState(null, '', SA.ui.href('dashboard', { period: f.period, from: f.period === 'custom' ? f.from : '', to: f.period === 'custom' ? f.to : '',
        account: f.account, by: f.by === 'month' ? '' : f.by, tstart: f.tstart, tend: f.tend }));
      const y = window.scrollY;
      render(root);
      window.scrollTo(0, y);
      const el = focusSel && root.querySelector(focusSel);
      if (el) el.focus();
    };
    c.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'trend-by') { f.by = t.value; return rerender('input[name="trend-by"][value="' + f.by + '"]'); }
      if (t.dataset.t) {
        // An emptied date input falls back to that side of the default window; typed dates outside the data clamp to it.
        let v = /^\d{4}-\d{2}-\d{2}$/.test(t.value) ? t.value : '';
        if (v && t.min && v < t.min) v = t.min;
        if (v && t.max && v > t.max) v = t.max;
        f[t.dataset.t] = v;
        return rerender('[data-t="' + t.dataset.t + '"]');
      }
      const k = t.dataset.f;
      if (!k) return;
      f[k] = t.value;
      if (k === 'period' && f.period === 'custom') { f.from = f.resolved.from; f.to = f.resolved.to; }
      rerender();
    });
    const open = (row) => {
      // Rows in the spending-over-time table open that card's date range; other tables use the dashboard period.
      const range = row.closest('#trend-card') ? { start: row.dataset.start, end: row.dataset.end } : { from: f.resolved.from, to: f.resolved.to };
      if (row.dataset.cat) SA.ui.go('transactions', Object.assign(range, { account: f.account, category: row.dataset.cat }));
      else if (row.dataset.merchant) SA.ui.go('transactions', Object.assign(range, { account: f.account, merchant: row.dataset.merchant }));
    };
    c.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'trend-reset') { f.tstart = f.tend = ''; return rerender('input[name="trend-by"]:checked'); }
      if (a && a.dataset.act === 'trend-by') { e.preventDefault(); f.by = a.dataset.by; return rerender('input[name="trend-by"][value="' + f.by + '"]'); }
      const row = e.target.closest('tr.clickable');
      if (row) open(row);
    });
    c.addEventListener('keydown', (e) => { const row = e.target.closest('tr.clickable'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(row); } });
  }

  SA.views = SA.views || {};
  SA.views.dashboard = { render, destroy: destroyCharts };
})(window.SA = window.SA || {});
