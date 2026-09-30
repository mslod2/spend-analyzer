/* Shared UI helpers: routing links, toasts, form controls, theme-aware chart colors. */
(function (SA) {
  'use strict';
  const U = SA.util;

  function href(route, params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') q.set(k, v);
    const s = q.toString();
    return '#/' + route + (s ? '?' + s : '');
  }
  function go(route, params) { location.hash = href(route, params); }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, query] = h.split('?');
    return { name: name || '', params: Object.fromEntries(new URLSearchParams(query || '')) };
  }

  let toastTimer;
  function toast(msg, ms) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 3500);
  }

  function options(list, selected, opts) {
    opts = opts || {};
    return list.map((o) => {
      const [value, label] = Array.isArray(o) ? o : [o, o];
      return '<option value="' + U.esc(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + U.esc(label) + '</option>';
    }).join('');
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Top 7 categories by all-time spend own series slots 1-7; everything else shares the neutral "Other" color.
  // Rank is computed on all data so filtering never repaints a category.
  const SERIES_SLOTS = 7;
  function categoryColors() {
    const rank = SA.analytics.categoryRank(SA.store.state.transactions, SA.store.excludedSet());
    const map = new Map();
    rank.forEach((c, i) => map.set(c, i < SERIES_SLOTS ? cssVar('--series-' + (i + 1)) : cssVar('--series-other')));
    return { rank: rank.slice(0, SERIES_SLOTS), colorOf: (c) => map.get(c) || cssVar('--series-other'), other: cssVar('--series-other') };
  }

  function chartTheme() {
    return {
      text: cssVar('--text'), text2: cssVar('--text-2'), muted: cssVar('--muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      surface: cssVar('--surface'), border: cssVar('--border-strong'), series1: cssVar('--series-1'), refLine: cssVar('--ref-line'),
    };
  }

  function tooltipStyle(th) {
    return {
      backgroundColor: th.surface, titleColor: th.text, bodyColor: th.text2, footerColor: th.text,
      borderColor: th.border, borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
      titleFont: { weight: '600' }, footerFont: { weight: '600' },
    };
  }

  const PAGE_SIZE = 200;

  SA.ui = { href, go, parseHash, toast, options, cssVar, categoryColors, chartTheme, tooltipStyle, PAGE_SIZE };
})(window.SA = window.SA || {});
