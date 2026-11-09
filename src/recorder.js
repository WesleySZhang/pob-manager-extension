// Records visits to share links and reads each link's build once. Browser-independent: the background script gives it
// the store, fetch, the PoB code decoder and the clock, and tests give it stand-ins.
//
// On a visit to a supported link (src/sites.js):
//  - a link already known not to be a build is ignored;
//  - a known build gets lastSeen and visits updated; one whose read failed is read again;
//  - a new link is stored as "pending", its raw code fetched (once: share ids never change), decoded and read.
//    A 404/400/410 reply means there is no build at that link (e.g. pobb.in/about): the record is dropped and the link
//    remembered in notBuilds. So is content that isn't a PoB build, but only on the paste sites (Pastebin, PastebinP,
//    Rentry), which hold all kinds of text. On the PoB sites unreadable content is an "error", kept and retried, so an
//    unexpected reply format can never drop real builds for good. Other failures (network, 5xx, 429) are errors too.
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const Sites = isNode ? require("./sites.js") : root.PobSites;
  const BuildInfo = isNode ? require("./buildinfo.js") : root.PobBuildInfo;

  class NotABuild extends Error {}

  /**
   * @param deps {store, fetch, decode(code) -> Promise<xml>, data (pobdata), now() -> ms}
   */
  function createRecorder(deps) {
    const inFlight = new Map();

    // A millisecond clock for timing the steps of a read (performance.now in the browser).
    const clock = deps.clock || (typeof performance !== "undefined" ? () => performance.now() : Date.now);
    const ms = (a, b) => Math.round((b - a) * 10) / 10;
    const sleep = deps.sleep || ((n) => new Promise((resolve) => setTimeout(resolve, n)));

    /** @returns {{info, timing: {downloadMs, decodeMs, readMs, codeBytes, xmlBytes}}} */
    async function readLink(site) {
      const t0 = clock();
      let res, attempts = 0;
      for (let attempt = 0; ; attempt++) {
        attempts = attempt + 1;
        try {
          res = await deps.fetch(site.raw, { credentials: "omit", headers: { Accept: "text/plain" } });
        } catch (e) {
          throw new Error("Could not reach " + site.label);
        }
        // 429 Too Many Requests: wait as the site asks (Retry-After seconds; 2 s if it doesn't say, at most 10 s) and
        // try once more, as PoE-Ninja-Extension's client does. pobb.in answered 429 when builds were opened quickly.
        if (res.status !== 429 || attempt >= 1) break;
        // A missing header must not read as 0 (Number(null) === 0); an HTTP-date value reads as NaN and gets 2 s.
        const raw = res.headers && res.headers.get ? res.headers.get("Retry-After") : null;
        const after = raw === null || raw === undefined || String(raw).trim() === "" ? NaN : Number(raw);
        await sleep(Number.isFinite(after) && after >= 0 ? Math.min(after, 10) * 1000 : 2000);
      }
      if (res.status === 404 || res.status === 400 || res.status === 410) throw new NotABuild(site.label + " has no build at this link (HTTP " + res.status + ")");
      if (!res.ok) throw new Error(site.label + " returned HTTP " + res.status);
      const text = (await res.text()).trim();
      const t1 = clock();
      const Fail = site.paste ? NotABuild : Error;
      let xml;
      try { xml = await deps.decode(text); } catch (e) { throw new Fail(site.paste ? "The page is not a PoB build code" : site.label + " sent something that isn't a PoB build code"); }
      const t2 = clock();
      let info;
      try { info = BuildInfo.readBuild(xml, deps.data); } catch (e) { throw new Fail("The code is not a PoB build: " + e.message); }
      const t3 = clock();
      return { info: info, timing: { downloadMs: ms(t0, t1), downloads: attempts, decodeMs: ms(t1, t2), readMs: ms(t2, t3), codeBytes: text.length, xmlBytes: xml.length } };
    }

    /** Fetches and reads a stored link's build, updating its record. Concurrent calls for one key share one read. */
    function refresh(key) {
      if (inFlight.has(key)) return inFlight.get(key);
      const job = (async function () {
        const rec = await deps.store.getBuild(key);
        if (!rec) return undefined;
        const site = Sites.describe(rec.site, rec.id);
        try {
          const t0 = clock();
          const got = await readLink(site);
          const t1 = clock();
          const saved = await deps.store.updateBuild(key, (r) => Object.assign(r, { status: "ok", info: got.info, error: undefined, readAt: deps.now() }));
          // How long this read took, step by step. Saving is timed too, so the timing goes in a second, tiny update.
          const t2 = clock();
          const timing = Object.assign(got.timing, { saveMs: ms(t1, t2), totalMs: ms(t0, t2) });
          return (await deps.store.updateBuild(key, (r) => Object.assign(r, { timing: timing }))) || saved;
        } catch (e) {
          if (e instanceof NotABuild) {
            await deps.store.deleteBuild(key);
            await deps.store.putNotBuild({ key: key, checkedAt: deps.now(), reason: e.message });
            return undefined;
          }
          return await deps.store.updateBuild(key, (r) => Object.assign(r, { status: "error", error: e.message }));
        }
      })();
      inFlight.set(key, job);
      job.then(() => inFlight.delete(key), () => inFlight.delete(key));
      return job;
    }

    /** @returns the stored record after this visit, or null when the URL isn't a share link (or not a build). */
    // Visits of one link are counted one after another, so two arriving together (two tabs, a reload while the build
    // is being read) both count. Reading is not queued: refresh() shares one read per link.
    const queues = new Map();
    function queued(key, fn) {
      const next = (queues.get(key) || Promise.resolve()).then(fn, fn);
      const tail = next.catch(function () {});
      queues.set(key, tail);
      tail.then(function () { if (queues.get(key) === tail) queues.delete(key); });
      return next;
    }

    async function visit(url) {
      const site = Sites.matchUrl(url);
      if (!site) return null;
      const counted = await queued(site.key, async function () {
        if (await deps.store.getNotBuild(site.key)) return null;
        const t = deps.now();
        const existing = await deps.store.getBuild(site.key);
        if (existing) return deps.store.updateBuild(site.key, (r) => Object.assign(r, { lastSeen: t, visits: (r.visits || 0) + 1 }));
        const rec = {
          key: site.key, site: site.site, id: site.id, link: site.link, pobUri: site.pobUri, label: site.label,
          firstSeen: t, lastSeen: t, visits: 1, status: "pending",
        };
        await deps.store.putBuild(rec);
        return rec;
      });
      if (!counted) return null;
      // A new link, one still pending (a read in progress, or one the browser stopped), or a failed one is read now.
      if (counted.status !== "ok") return (await refresh(site.key)) || null;
      return counted;
    }

    /**
     * User edits from the popup. An empty value clears the field (the name falls back to the generated one).
     *   customName, creator: text
     *   mainSkill: { view, skill }  the main skill set by hand for one view (a loadout name, or "As saved")
     *   defaultView: the view the popup shows first
     *   favorite: true to star the build, false to unstar it
     */
    function edit(key, changes) {
      const text = (v) => (typeof v === "string" ? v.trim() : "");
      return deps.store.updateBuild(key, function (r) {
        if ("favorite" in changes) {
          if (changes.favorite === true) r.favorite = true; else delete r.favorite;
        }
        for (const field of ["customName", "creator", "defaultView"]) {
          if (!(field in changes)) continue;
          const v = text(changes[field]);
          if (v) r[field] = v; else delete r[field];
        }
        if (changes.mainSkill && text(changes.mainSkill.view)) {
          const view = text(changes.mainSkill.view), skill = text(changes.mainSkill.skill);
          const map = Object.assign({}, r.mainSkills);
          if (skill) map[view] = skill; else delete map[view];
          if (Object.keys(map).length) r.mainSkills = map; else delete r.mainSkills;
        }
        return r;
      });
    }

    /**
     * Reads again, one after another, the stored builds that an older reader version read (BuildInfo.READER_VERSION),
     * so they get new fields without a visit. Edits (name, creator, main skills, default loadout) are kept.
     * @returns the number of builds read again.
     */
    async function upgrade() {
      const stale = (await deps.store.allBuilds()).filter((b) => b.status === "ok" && (!b.info || b.info.readerVersion !== BuildInfo.READER_VERSION));
      for (const b of stale) await refresh(b.key);
      return stale.length;
    }

    /** Deletes a stored build. A later visit records it again as new. */
    function remove(key) {
      return deps.store.deleteBuild(key);
    }

    return { visit, refresh, edit, remove, upgrade };
  }

  const api = { createRecorder, NotABuild };
  if (isNode) module.exports = api;
  else root.PobRecorder = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
