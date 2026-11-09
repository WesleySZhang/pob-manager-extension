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

function notifyPopup() {
  // The popup listens while it is open; nobody listening is fine.
  try {
    const p = ext.runtime.sendMessage({ type: "builds-changed" });
    if (p && p.catch) p.catch(function () {});
  } catch (e) { /* no listener */ }
}

ext.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || ["retry", "edit", "delete"].indexOf(msg.type) === -1) return false;
  recorder()
    .then((r) => (msg.type === "retry" ? r.refresh(msg.key) : msg.type === "delete" ? r.remove(msg.key) : r.edit(msg.key, msg.changes || {})))
    .then(function (rec) { sendResponse({ ok: true, record: rec || null }); notifyPopup(); },
      function (e) { sendResponse({ ok: false, error: (e && e.message) || String(e) }); });
  return true; // reply comes later
});
