// Background script (Chrome service worker / Firefox event page). Watches tab URLs; when one is a PoB share link
// (src/sites.js), records the visit and reads the build (src/recorder.js). Also answers the popup's "retry", "edit"
// and "delete" requests, so every write goes through one place.
// Firefox content scripts can't use DecompressionStream, but background scripts can (see PoE-Ninja-Extension), and
// Chrome's service worker can, so decoding happens here.
if (typeof importScripts === "function") {
  importScripts("../data/pobdata.js", "xml.js", "buildinfo.js", "sites.js", "pobcode.js", "store.js", "recorder.js");
}

const ext = typeof browser !== "undefined" ? browser : chrome;

let recorderPromise;
function recorder() {
  if (!recorderPromise) {
    recorderPromise = globalThis.PobStore.open(indexedDB).then(function (store) {
      return globalThis.PobRecorder.createRecorder({
        store: store,
        fetch: fetch.bind(globalThis),
        decode: globalThis.PobCode.decode,
        data: globalThis.PobData,
        now: Date.now,
      });
    });
    recorderPromise.catch(function () { recorderPromise = undefined; });
  }
  return recorderPromise;
}

// changeInfo.url is set when a tab's URL changes, including the in-page navigations single-page sites like poe.ninja
// and Maxroll make. Chrome only reports it for hosts the extension has permission for, which are exactly the share sites.
ext.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  const url = changeInfo.url;
  if (!url || tab.incognito || !globalThis.PobSites.matchUrl(url)) return;
  recorder().then((r) => r.visit(url)).then(notifyPopup, function (e) { console.warn("PoB Manager: " + (e && e.message)); });
});

// Builds read by an older reader version are read again when the browser starts or the extension is installed,
// updated or reloaded.
function upgradeStored() {
  recorder().then((r) => r.upgrade()).then(function (n) { if (n) notifyPopup(); }, function (e) { console.warn("PoB Manager: " + (e && e.message)); });
}
ext.runtime.onStartup.addListener(upgradeStored);
ext.runtime.onInstalled.addListener(upgradeStored);

function notifyPopup() {
  // The popup listens while it is open; nobody listening is fine.
  try {
    const p = ext.runtime.sendMessage({ type: "builds-changed" });
    if (p && p.catch) p.catch(function () {});
  } catch (e) { /* no listener */ }
  // The page boxes (src/page.js) on open share pages: runtime.sendMessage doesn't reach content scripts. Querying by
  // URL needs only the host permissions the extension already has.
  try {
    Promise.resolve(ext.tabs.query({ url: SHARE_PAGES })).then(function (tabs) {
      for (const t of tabs || []) {
        try {
          const p = ext.tabs.sendMessage(t.id, { type: "builds-changed" });
          if (p && p.catch) p.catch(function () {});
        } catch (e) { /* no page box in this tab */ }
      }
    }, function () {});
  } catch (e) { /* not fatal */ }
}
// The share pages the page box runs on: the content_scripts matches (tools/build.js).
const SHARE_PAGES = (ext.runtime.getManifest().content_scripts || []).reduce((all, c) => all.concat(c.matches || []), []);

ext.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "get") {
    // The page box asks for its page's build. Private windows are never recorded, so their box stays hidden.
    if (sender && sender.tab && sender.tab.incognito) { sendResponse({ ok: true, found: null }); return false; }
    recorder().then((r) => r.lookup(String(msg.url || "")))
      .then(function (found) { sendResponse({ ok: true, found: found }); },
        function (e) { sendResponse({ ok: false, error: (e && e.message) || String(e) }); });
    return true;
  }
  if (!msg || ["retry", "edit", "delete"].indexOf(msg.type) === -1) return false;
  recorder()
    .then((r) => (msg.type === "retry" ? r.refresh(msg.key) : msg.type === "delete" ? r.remove(msg.key) : r.edit(msg.key, msg.changes || {})))
    .then(function (rec) { sendResponse({ ok: true, record: rec || null }); notifyPopup(); },
      function (e) { sendResponse({ ok: false, error: (e && e.message) || String(e) }); });
  return true; // reply comes later
});
