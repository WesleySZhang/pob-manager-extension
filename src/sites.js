// The build-sharing sites Path of Building v2.67.2 (b32759a) knows: src/Modules/BuildSiteTools.lua, buildSites.websiteList.
// For each: the page link (matchURL / regexURL), where the raw build code is downloaded (downloadURL) and the id PoB's
// protocol handler uses (pob://<id lowercased>/<build id>, buildSites.ParseImportLinkFromURI).
// Differences from PoB, all narrower: the id must be the whole last path segment (PoB's patterns are only end-anchored),
// query strings and #fragments are ignored, and pobb.in's "pobb%.in/(.+)" is limited to one segment of id characters
// that isn't one of the site's own pages. A link only becomes a stored build once its raw content decodes to PoB XML
// (src/recorder.js), which catches the rest.
(function (root) {
  "use strict";

  const SITES = [
    { key: "maxroll", label: "Maxroll", host: "maxroll.gg", path: /^\/poe\/pob\/([^/]+)\/?$/,
      link: (id) => "https://maxroll.gg/poe/pob/" + id, raw: (id) => "https://maxroll.gg/poe/api/pob/" + id, protocol: "maxroll" },
    { key: "pobcodes", label: "pob.codes", host: "pob.codes", path: /^\/b\/([^/]+)\/?$/,
      link: (id) => "https://pob.codes/b/" + id, raw: (id) => "https://api.pob.codes/" + id + "/raw", protocol: "pobcodes" },
    { key: "pobbin", label: "pobb.in", host: "pobb.in", path: /^\/([A-Za-z0-9_-]+)\/?$/,
      reserved: ["about", "pob", "api", "u", "login", "logout", "settings", "privacy", "terms", "faq", "search", "new"],
      link: (id) => "https://pobb.in/" + id, raw: (id) => "https://pobb.in/pob/" + id, protocol: "pobbin" },
    // PoB: "^https://poe%.ninja/?p?o?e?1?/pob/%w+", so both /pob/{id} and /poe1/pob/{id}.
    { key: "poeninja", label: "poe.ninja", host: "poe.ninja", path: /^\/(?:poe1\/)?pob\/([A-Za-z0-9]+)\/?$/,
      link: (id) => "https://poe.ninja/poe1/pob/" + id, raw: (id) => "https://poe.ninja/poe1/pob/raw/" + id, protocol: "poeninja" },
    { key: "pastebin", label: "Pastebin", host: "pastebin.com", path: /^\/([A-Za-z0-9]+)\/?$/,
      link: (id) => "https://pastebin.com/" + id, raw: (id) => "https://pastebin.com/raw/" + id, protocol: "pastebin", paste: true },
    { key: "pastebinp", label: "PastebinP", host: "pastebinp.com", path: /^\/([A-Za-z0-9]+)\/?$/,
      link: (id) => "https://pastebinp.com/" + id, raw: (id) => "https://pastebinp.com/raw/" + id, protocol: "pastebinproxy", paste: true },
    { key: "rentry", label: "Rentry", host: "rentry.co", path: /^\/([A-Za-z0-9]+)\/?$/,
      link: (id) => "https://rentry.co/" + id, raw: (id) => "https://rentry.co/paste/" + id + "/raw", protocol: "rentry", paste: true },
    { key: "poedb", label: "poedb", host: "poedb.tw", path: /^\/pob\/([^/]+)\/?$/,
      link: (id) => "https://poedb.tw/pob/" + id, raw: (id) => "https://poedb.tw/pob/" + id + "/raw", protocol: "poedb" },
  ];

  const BY_KEY = {};
  for (const s of SITES) BY_KEY[s.key] = s;

  /**
   * @returns {{key, site, label, id, link, raw, pobUri}|null} key = "<site>:<id>", the stored build's identity.
   */
  function matchUrl(href) {
    let url;
    try { url = new URL(href); } catch (e) { return null; }
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const s of SITES) {
      if (host !== s.host) continue;
      const m = s.path.exec(url.pathname);
      if (!m) return null;
      let id;
      try { id = decodeURIComponent(m[1]); } catch (e) { return null; }
      if (!id || (s.reserved && s.reserved.indexOf(id.toLowerCase()) !== -1)) return null;
      return describe(s.key, id);
    }
    return null;
  }

  function describe(siteKey, id) {
    const s = BY_KEY[siteKey];
    if (!s) throw new Error("Unknown site " + siteKey);
    const enc = encodeURIComponent(id);
    return {
      key: s.key + ":" + id,
      site: s.key,
      label: s.label,
      id: id,
      link: s.link(enc),
      raw: s.raw(enc),
      pobUri: "pob://" + s.protocol + "/" + enc,
      // General paste sites hold all kinds of text; the others only ever serve PoB codes (src/recorder.js).
      paste: !!s.paste,
    };
  }

  const api = { SITES, matchUrl, describe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
