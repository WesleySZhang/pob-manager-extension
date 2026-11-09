// IndexedDB storage, shared by the background script and the popup (same extension origin).
//   builds:    one record per share link, keyPath "key" ("<site>:<id>"):
//              { key, site, id, link, pobUri, label, firstSeen, lastSeen, visits, status: "pending"|"ok"|"error",
//                error?, info? (src/buildinfo.js readBuild), readAt?, customName?, creator? }
//   notBuilds: links whose content turned out not to be a PoB build, so later visits don't fetch them again:
//              { key, checkedAt, reason }
// No build code is stored: the link can always fetch it again.
(function (root) {
  "use strict";

  const DB_NAME = "pob-manager";
  const DB_VERSION = 1;

  function promisify(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /** @param idb the IndexedDB factory (globalThis.indexedDB, or fake-indexeddb in tests) */
  function open(idb, name) {
    const req = idb.open(name || DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains("builds")) db.createObjectStore("builds", { keyPath: "key" });
      if (!db.objectStoreNames.contains("notBuilds")) db.createObjectStore("notBuilds", { keyPath: "key" });
    };
    return promisify(req).then(wrap);
  }

  function wrap(db) {
    function tx(store, mode, fn) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(store, mode);
        let result;
        Promise.resolve(fn(t.objectStore(store))).then(function (r) { result = r; }, reject);
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error("transaction aborted")); };
      });
    }
    return {
      getBuild: (key) => tx("builds", "readonly", (s) => promisify(s.get(key))),
      putBuild: (rec) => tx("builds", "readwrite", (s) => promisify(s.put(rec))),
      deleteBuild: (key) => tx("builds", "readwrite", (s) => promisify(s.delete(key))),
      allBuilds: () => tx("builds", "readonly", (s) => promisify(s.getAll())),
      getNotBuild: (key) => tx("notBuilds", "readonly", (s) => promisify(s.get(key))),
      putNotBuild: (rec) => tx("notBuilds", "readwrite", (s) => promisify(s.put(rec))),
      /** Reads, changes and writes one build in a single transaction. `fn(record)` returns the new record. */
      updateBuild: (key, fn) => tx("builds", "readwrite", function (s) {
        return promisify(s.get(key)).then(function (rec) {
          if (!rec) return undefined;
          const next = fn(rec);
          return promisify(s.put(next)).then(function () { return next; });
        });
      }),
      close: () => db.close(),
    };
  }

  const api = { open, DB_NAME };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
