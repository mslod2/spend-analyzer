/* Shared helpers. Every module attaches to window.SA so the app works from file:// without a build step. */
(function (SA) {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  const moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
  const moneyFmt0 = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n, opts) {
    if (n == null || !isFinite(n)) return '—';
    return (opts && opts.whole ? moneyFmt0 : moneyFmt).format(n);
  }

  function pct(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toFixed(digits == null ? 1 : digits) + '%';
  }

  // cyrb53: fast, well-distributed 53-bit string hash. Used for deterministic transaction ids (dedupe).
  function hash(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function uid(prefix) {
    const rnd = (crypto.getRandomValues(new Uint32Array(2))).reduce((s, n) => s + n.toString(36), '');
    return (prefix || 'id') + '_' + Date.now().toString(36) + rnd.slice(0, 8);
  }

  // Months are handled as 'YYYY-MM' strings throughout.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthOf(isoDate) { return isoDate.slice(0, 7); }
  function monthLabel(ym, long) {
    const [y, m] = ym.split('-');
    return MONTHS[+m - 1] + (long === false ? '' : ' ' + y);
  }
  function shortMonthLabel(ym) {
    const [y, m] = ym.split('-');
    return MONTHS[+m - 1] + " '" + y.slice(2);
  }
  function addMonths(ym, n) {
    let [y, m] = ym.split('-').map(Number);
    m += n;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return y + '-' + String(m).padStart(2, '0');
  }
  function monthRange(from, to) {
    const out = [];
    for (let ym = from; ym <= to; ym = addMonths(ym, 1)) out.push(ym);
    return out;
  }
  // Day math in UTC so DST never shifts a date.
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekday(iso) { return new Date(iso + 'T00:00:00Z').getUTCDay(); } // 0 = Sunday
  function monthEnd(ym) { return addDays(addMonths(ym, 1) + '-01', -1); }
  function shortDate(iso) { const [, m, d] = iso.split('-'); return MONTHS[+m - 1] + ' ' + (+d); }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function weekdayLabel(iso) { return WEEKDAYS[weekday(iso)]; }

  function formatDate(iso) {
    const [y, m, d] = iso.split('-');
    return MONTHS[+m - 1] + ' ' + (+d) + ', ' + y;
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(this, a), ms); };
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }

  function sum(arr, fn) { let s = 0; for (const x of arr) s += fn ? fn(x) : x; return s; }
  function round2(n) { return Math.round(n * 100) / 100; }

  SA.util = { esc, money, pct, hash, uid, monthOf, monthLabel, shortMonthLabel, addMonths, monthRange,
    formatDate, addDays, weekday, monthEnd, shortDate, weekdayLabel, debounce, download, readFileText, sum, round2, MONTHS };
})(window.SA = window.SA || {});
