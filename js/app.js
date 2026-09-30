/* Boot + hash router. Each view exposes render(root, params) and may expose destroy(). */
(function (SA) {
  'use strict';

  const ROUTES = ['dashboard', 'transactions', 'import', 'rules', 'settings'];
  const root = document.getElementById('view');
  let current = null;

  function render() {
    const { name, params } = SA.ui.parseHash();
    const route = ROUTES.includes(name) ? name : (SA.store.state.transactions.length ? 'dashboard' : 'import');
    if (route !== name) { history.replaceState(null, '', SA.ui.href(route, params)); }
    if (current && current.name !== route && SA.views[current.name].destroy) SA.views[current.name].destroy();
    current = { name: route };
    document.querySelectorAll('.nav a').forEach((a) => {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = route[0].toUpperCase() + route.slice(1) + ' · Spend Analyzer';
    SA.views[route].render(root, params);
  }

  async function boot() {
    if (!window.Papa || !window.Chart) {
      root.innerHTML = '<div class="card empty"><h2>Couldn’t load libraries</h2><p>PapaParse and Chart.js load from cdnjs.cloudflare.com. Check your connection and reload.</p></div>';
      return;
    }
    try {
      await SA.store.load();
    } catch (e) {
      root.innerHTML = '<div class="card empty"><h2>Couldn’t open local storage</h2><p>' + SA.util.esc(e.message) +
        '</p><p class="small muted">Private browsing modes may block IndexedDB.</p></div>';
      return;
    }
    window.addEventListener('hashchange', render);
    // Dropping a file anywhere imports it, instead of the browser navigating away to the CSV.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
      if (!files.length) return;
      if (current.name !== 'import') SA.ui.go('import');
      setTimeout(() => SA.views.import.addFiles(files), 0);
    });
    // Re-render the current view when data changes from elsewhere (e.g. restore), and on theme flips so charts pick up new colors.
    SA.store.onChange((what) => { if (what === 'all') render(); });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (current && current.name === 'dashboard') render(); });
    render();
  }

  SA.app = { render };
  SA.views = SA.views || {};
  document.addEventListener('DOMContentLoaded', boot);
})(window.SA = window.SA || {});
