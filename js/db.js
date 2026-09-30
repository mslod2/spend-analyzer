/* Thin promise wrapper over IndexedDB. One database, five object stores. */
(function (SA) {
  'use strict';

  const DB_NAME = 'spend-analyzer';
  const DB_VERSION = 1;
  const STORES = ['transactions', 'rules', 'mappings', 'imports', 'settings'];
  const BACKUP_FORMAT = 'spend-analyzer-backup';
  const BACKUP_VERSION = 1;

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('transactions')) {
          const t = db.createObjectStore('transactions', { keyPath: 'id' });
          t.createIndex('importId', 'importId');
          t.createIndex('date', 'date');
        }
        for (const name of ['rules', 'mappings', 'imports']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
        // settings: a single record under key 'settings' (out-of-line key).
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is open in another tab with an older version. Close other tabs and reload.'));
    });
    return dbPromise;
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function getAll(store) {
    const db = await open();
    return reqP(db.transaction(store).objectStore(store).getAll());
  }

  async function get(store, key) {
    const db = await open();
    return reqP(db.transaction(store).objectStore(store).get(key));
  }

  async function put(store, value, key) {
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
    return txDone(tx);
  }

  async function putMany(store, values) {
    if (!values.length) return;
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    return txDone(tx);
  }

  async function del(store, key) {
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    return txDone(tx);
  }

  async function delMany(store, keys) {
    if (!keys.length) return;
    const db = await open();
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(k);
    return txDone(tx);
  }

  async function clearAll() {
    const db = await open();
    const tx = db.transaction(STORES, 'readwrite');
    for (const s of STORES) tx.objectStore(s).clear();
    return txDone(tx);
  }

  async function exportAll() {
    const out = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString() };
    for (const s of ['transactions', 'rules', 'mappings', 'imports']) out[s] = await getAll(s);
    out.settings = (await get('settings', 'settings')) || null;
    return out;
  }

  function validateBackup(data) {
    if (!data || data.format !== BACKUP_FORMAT) throw new Error('Not a Spend Analyzer backup file.');
    if (data.version > BACKUP_VERSION) throw new Error('Backup was made by a newer version of this app.');
    for (const s of ['transactions', 'rules', 'mappings', 'imports']) {
      if (data[s] != null && !Array.isArray(data[s])) throw new Error('Backup is malformed: "' + s + '" is not a list.');
      for (const row of data[s] || []) {
        if (!row || typeof row.id !== 'string') throw new Error('Backup is malformed: a "' + s + '" record has no id.');
      }
    }
  }

  // mode: 'replace' wipes everything first; 'merge' upserts by id and keeps local settings unless absent.
  async function importAll(data, mode) {
    validateBackup(data);
    const db = await open();
    const localSettings = mode === 'merge' ? await get('settings', 'settings') : null;
    const tx = db.transaction(STORES, 'readwrite');
    if (mode === 'replace') for (const s of STORES) tx.objectStore(s).clear();
    for (const s of ['transactions', 'rules', 'mappings', 'imports']) {
      const os = tx.objectStore(s);
      for (const row of data[s] || []) os.put(row);
    }
    if (data.settings && (mode === 'replace' || !localSettings)) tx.objectStore('settings').put(data.settings, 'settings');
    return txDone(tx);
  }

  SA.db = { open, getAll, get, put, putMany, del, delMany, clearAll, exportAll, importAll, validateBackup };
})(window.SA = window.SA || {});
