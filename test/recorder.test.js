// Visit recording (src/recorder.js) with a real IndexedDB implementation (fake-indexeddb) and a stand-in fetch.
// Reference: the plan's recording rules (PoE-Sim-Notes pob-manager/PoB Manager Plan.md, "How it works") and PoB's
// share sites (BuildSiteTools.lua). Build codes are made with Node's zlib, independent of src/pobcode.js.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("zlib");
const { IDBFactory } = require("fake-indexeddb");
const Store = require("../src/store.js");
const { createRecorder } = require("../src/recorder.js");
const PobCode = require("../src/pobcode.js");
const data = require("../data/pobdata.js");
const { pobXml } = require("./helpers.js");

const ARC = { nameSpec: "Arc", gemId: "Metadata/Items/Gems/SkillGemArc", variantId: "Arc", skillId: "Arc" };
const CODE = zlib.deflateSync(Buffer.from(pobXml({ skillSets: [{ id: 1, groups: [[ARC]] }], stats: { CombinedDPS: 1234 } }))).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

function fakeFetch(routes) {
  const calls = [];
  const fn = async function (url) {
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return { ok: false, status: 404, text: async () => "" };
    if (r instanceof Error) throw r;
    const [status, body] = typeof r === "string" ? [200, r] : r;
    return { ok: status >= 200 && status < 300, status: status, text: async () => body };
  };
  fn.calls = calls;
  return fn;
}

async function setup(routes) {
  const store = await Store.open(new IDBFactory(), "test");
  let t = 1000;
  const fetch = fakeFetch(routes);
  const rec = createRecorder({ store, fetch, decode: PobCode.decode, data, now: () => t });
  return { store, fetch, rec, tick: (ms) => { t += ms; } };
}

const LINK = "https://pobb.in/abc123";
const RAW = "https://pobb.in/pob/abc123";

test("a new share link is stored, read once, and counted on each visit", async () => {
  const { store, fetch, rec, tick } = await setup({ [RAW]: CODE });
  const first = await rec.visit(LINK);
  assert.equal(first.status, "ok");
  assert.equal(first.key, "pobbin:abc123");
  assert.equal(first.info.mainSkill, "Arc");
  assert.equal(first.info.dps, 1234);
  assert.equal(first.visits, 1);
  assert.equal(first.firstSeen, 1000);
  assert.equal(first.pobUri, "pob://pobbin/abc123");
  assert.equal("code" in first, false, "the build code is not stored");
  tick(500);
  const second = await rec.visit(LINK + "?ref=x");
  assert.equal(second.visits, 2);
  assert.equal(second.lastSeen, 1500);
  assert.equal(second.firstSeen, 1000);
  assert.deepEqual(fetch.calls, [RAW], "fetched once");
  assert.equal((await store.allBuilds()).length, 1);
});

test("URLs that aren't share links are ignored without fetching", async () => {
  const { fetch, rec } = await setup({});
  assert.equal(await rec.visit("https://poe.ninja/poe1/builds/allflame/character/Someone-1234/Char"), null);
  assert.equal(await rec.visit("https://example.com/"), null);
  assert.deepEqual(fetch.calls, []);
});

test("a 404 or content that isn't a build: dropped and remembered, not fetched again", async () => {
  const { store, fetch, rec } = await setup({ "https://pastebin.com/raw/notes1": "my shopping list" });
  assert.equal(await rec.visit("https://pastebin.com/notes1"), null);
  assert.equal(await rec.visit("https://pobb.in/missing1"), null);
  assert.equal(await rec.visit("https://pastebin.com/notes1"), null);
  assert.deepEqual(fetch.calls, ["https://pastebin.com/raw/notes1", "https://pobb.in/pob/missing1"]);
  assert.deepEqual(await store.allBuilds(), []);
  assert.match((await store.getNotBuild("pastebin:notes1")).reason, /not a PoB build code/);
});

test("unreadable content on a PoB site is a retryable error, never dropped for good", async () => {
  // Only Pastebin, PastebinP and Rentry hold arbitrary text. A PoB site (pobb.in, poe.ninja, Maxroll, pob.codes, poedb)
  // sending something else means an unexpected reply format, which must not drop real builds permanently.
  const routes = { "https://maxroll.gg/poe/api/pob/r7sh0f2": "<html>Please enable JavaScript</html>" };
  const { rec, store, fetch } = await setup(routes);
  const r = await rec.visit("https://maxroll.gg/poe/pob/r7sh0f2");
  assert.equal(r.status, "error");
  assert.match(r.error, /Maxroll sent something that isn't a PoB build code/);
  assert.equal(await store.getNotBuild("maxroll:r7sh0f2"), undefined);
  routes["https://maxroll.gg/poe/api/pob/r7sh0f2"] = CODE;
  assert.equal((await rec.visit("https://maxroll.gg/poe/pob/r7sh0f2")).status, "ok");
  assert.equal(fetch.calls.length, 2);
  const xmlNotPob = zlib.deflateSync(Buffer.from("<html/>")).toString("base64");
  const { rec: rec2 } = await setup({ "https://poe.ninja/poe1/pob/raw/x1": xmlNotPob });
  assert.match((await rec2.visit("https://poe.ninja/poe1/pob/x1")).error, /not a PoB build/);
});

test("a decodable code that isn't PoB XML is not a build", async () => {
  const notPob = zlib.deflateSync(Buffer.from("<html><body/></html>")).toString("base64");
  const { store, rec } = await setup({ "https://rentry.co/paste/abc/raw": notPob });
  assert.equal(await rec.visit("https://rentry.co/abc"), null);
  assert.match((await store.getNotBuild("rentry:abc")).reason, /not a PoB build/);
});

test("server and network failures keep the record as an error; the next visit retries", async () => {
  const routes = { [RAW]: [500, "oops"] };
  const { rec, fetch } = await setup(routes);
  const failed = await rec.visit(LINK);
  assert.equal(failed.status, "error");
  assert.match(failed.error, /HTTP 500/);
  routes[RAW] = new Error("offline");
  assert.match((await rec.visit(LINK)).error, /Could not reach pobb.in/);
  routes[RAW] = CODE;
  const ok = await rec.visit(LINK);
  assert.equal(ok.status, "ok");
  assert.equal(ok.visits, 3);
  assert.equal(ok.error, undefined);
  assert.equal(fetch.calls.length, 3);
});

test("simultaneous visits of a new link: every visit counts and the build is fetched once", async () => {
  // Regression: visits arriving together each saw no record and each wrote visits: 1, losing visits.
  const { rec, fetch, store } = await setup({ [RAW]: CODE });
  const results = await Promise.all([rec.visit(LINK), rec.visit(LINK), rec.visit(LINK)]);
  assert.deepEqual(fetch.calls, [RAW]);
  const stored = await store.getBuild("pobbin:abc123");
  assert.equal(stored.visits, 3);
  assert.equal(stored.status, "ok");
  assert.ok(results.every((r) => r && r.status === "ok"));
});

test("a record left pending (the browser stopped mid-read) is read on the next visit", async () => {
  const { rec, store, fetch } = await setup({ [RAW]: CODE });
  await store.putBuild({ key: "pobbin:abc123", site: "pobbin", id: "abc123", link: LINK, status: "pending", visits: 1, firstSeen: 1, lastSeen: 1 });
  const r = await rec.visit(LINK);
  assert.equal(r.status, "ok");
  assert.equal(r.visits, 2);
  assert.deepEqual(fetch.calls, [RAW]);
});

test("name and creator: saved trimmed, cleared when empty, kept through a re-read", async () => {
  const { rec, store } = await setup({ [RAW]: CODE });
  await rec.visit(LINK);
  let r = await rec.edit("pobbin:abc123", { customName: "  League starter ", creator: "Someone" });
  assert.equal(r.customName, "League starter");
  assert.equal(r.creator, "Someone");
  r = await rec.refresh("pobbin:abc123");
  assert.equal(r.customName, "League starter");
  assert.equal(r.creator, "Someone");
  r = await rec.edit("pobbin:abc123", { customName: "   " });
  assert.equal("customName" in r, false);
  assert.equal(r.creator, "Someone", "fields not in the change stay");
  r = await rec.edit("pobbin:abc123", { creator: "" });
  assert.equal("creator" in r, false);
  assert.equal(await rec.edit("pobbin:nope", { creator: "x" }), undefined);
  assert.equal((await store.allBuilds()).length, 1);
});

test("delete, then a later visit records it again as new", async () => {
  const { rec, store, tick } = await setup({ [RAW]: CODE });
  await rec.visit(LINK);
  await rec.remove("pobbin:abc123");
  assert.deepEqual(await store.allBuilds(), []);
  tick(10);
  const again = await rec.visit(LINK);
  assert.equal(again.visits, 1);
  assert.equal(again.firstSeen, 1010);
});

test("refresh of an unknown key does nothing", async () => {
  const { rec } = await setup({});
  assert.equal(await rec.refresh("pobbin:none"), undefined);
});

test("main skill per loadout and the default loadout: saved, cleared, kept through a re-read", async () => {
  const { rec } = await setup({ [RAW]: CODE });
  await rec.visit(LINK);
  let r = await rec.edit("pobbin:abc123", { mainSkill: { view: "As saved", skill: " Arc " }, defaultView: "Endgame" });
  assert.deepEqual(r.mainSkills, { "As saved": "Arc" });
  assert.equal(r.defaultView, "Endgame");
  r = await rec.edit("pobbin:abc123", { mainSkill: { view: "Leveling", skill: "Cyclone" } });
  assert.deepEqual(r.mainSkills, { "As saved": "Arc", Leveling: "Cyclone" });
  r = await rec.refresh("pobbin:abc123");
  assert.deepEqual(r.mainSkills, { "As saved": "Arc", Leveling: "Cyclone" });
  assert.equal(r.defaultView, "Endgame");
  r = await rec.edit("pobbin:abc123", { mainSkill: { view: "As saved", skill: "" }, defaultView: "" });
  assert.deepEqual(r.mainSkills, { Leveling: "Cyclone" });
  assert.equal("defaultView" in r, false);
  r = await rec.edit("pobbin:abc123", { mainSkill: { view: "Leveling", skill: "" } });
  assert.equal("mainSkills" in r, false);
  r = await rec.edit("pobbin:abc123", { mainSkill: { view: "", skill: "Arc" } });
  assert.equal("mainSkills" in r, false, "a main skill needs a loadout");
});

test("builds read by an older reader are read again on upgrade, keeping the user's edits", async () => {
  const B = require("../src/buildinfo.js");
  const { rec, store, fetch } = await setup({ [RAW]: CODE });
  await rec.visit(LINK);
  await rec.edit("pobbin:abc123", { customName: "Mine", mainSkill: { view: "As saved", skill: "Arc" } });
  assert.equal(await rec.upgrade(), 0, "nothing to do when every build is current");
  await store.updateBuild("pobbin:abc123", (r) => { r.info = Object.assign({}, r.info, { readerVersion: 1 }); delete r.info.autoMainSkill; return r; });
  await store.putBuild({ key: "pobbin:failed1", site: "pobbin", id: "failed1", link: "https://pobb.in/failed1", status: "error", visits: 1 });
  assert.equal(await rec.upgrade(), 1, "only readable builds; failed ones wait for a visit or Retry");
  const r = await store.getBuild("pobbin:abc123");
  assert.equal(r.info.readerVersion, B.READER_VERSION);
  assert.equal(r.info.autoMainSkill, "Arc");
  assert.equal(r.customName, "Mine");
  assert.deepEqual(r.mainSkills, { "As saved": "Arc" });
  assert.equal(fetch.calls.length, 2);
});

test("favorite: starred, unstarred, kept through a re-read and an upgrade", async () => {
  const { rec, store } = await setup({ [RAW]: CODE });
  await rec.visit(LINK);
  let r = await rec.edit("pobbin:abc123", { favorite: true });
  assert.equal(r.favorite, true);
  r = await rec.refresh("pobbin:abc123");
  assert.equal(r.favorite, true);
  await store.updateBuild("pobbin:abc123", (x) => { x.info.readerVersion = 0; return x; });
  await rec.upgrade();
  assert.equal((await store.getBuild("pobbin:abc123")).favorite, true);
  r = await rec.edit("pobbin:abc123", { favorite: false });
  assert.equal("favorite" in r, false);
  r = await rec.edit("pobbin:abc123", { favorite: "true" });
  assert.equal("favorite" in r, false, "only the value true stars a build");
  r = await rec.edit("pobbin:abc123", { creator: "x" });
  assert.equal("favorite" in r, false, "other edits leave it alone");
});

test("each read records how long its steps took", async () => {
  // A stand-in clock that moves 5 ms per reading, so every step takes a known time.
  const store = await Store.open(new IDBFactory(), "timing");
  let t = 0;
  const rec = createRecorder({ store, fetch: fakeFetch({ [RAW]: CODE }), decode: PobCode.decode, data, now: () => 1, clock: () => (t += 5) });
  const r = await rec.visit(LINK);
  assert.deepEqual(Object.keys(r.timing).sort(), ["codeBytes", "decodeMs", "downloadMs", "downloads", "readMs", "saveMs", "totalMs", "xmlBytes"]);
  assert.equal(r.timing.downloads, 1);
  assert.equal(r.timing.downloadMs, 5);
  assert.equal(r.timing.decodeMs, 5);
  assert.equal(r.timing.readMs, 5);
  assert.equal(r.timing.codeBytes, CODE.length);
  assert.ok(r.timing.xmlBytes > r.timing.codeBytes, "the XML is bigger than the compressed code");
  assert.ok(r.timing.totalMs >= r.timing.downloadMs + r.timing.decodeMs + r.timing.readMs + r.timing.saveMs);
  assert.equal((await store.getBuild("pobbin:abc123")).timing.totalMs, r.timing.totalMs, "stored with the build");
});

test("429 Too Many Requests: one retry after Retry-After (2 s without it, at most 10 s), then an error to retry later", async () => {
  // Regression: pobb.in answered 429 when builds were opened quickly, leaving them as errors (tools/e2e/measure.js).
  async function attempt(replies) {
    const store = await Store.open(new IDBFactory(), "r429-" + Math.random());
    const waits = [];
    let n = 0;
    const fetch = async () => {
      const [status, retryAfter] = replies[Math.min(n++, replies.length - 1)];
      return { ok: status === 200, status: status, headers: { get: (h) => (h === "Retry-After" ? retryAfter : null) }, text: async () => (status === 200 ? CODE : "") };
    };
    const rec = createRecorder({ store, fetch, decode: PobCode.decode, data, now: () => 1, sleep: async (ms) => { waits.push(ms); } });
    return { r: await rec.visit(LINK), waits, calls: n };
  }
  let a = await attempt([[429, "3"], [200, null]]);
  assert.deepEqual([a.r.status, a.waits, a.calls, a.r.timing.downloads], ["ok", [3000], 2, 2]);
  a = await attempt([[429, null], [200, null]]);
  assert.deepEqual(a.waits, [2000], "no Retry-After: 2 s");
  a = await attempt([[429, "60"], [200, null]]);
  assert.deepEqual(a.waits, [10000], "capped at 10 s");
  a = await attempt([[429, "1"], [429, "1"], [200, null]]);
  assert.deepEqual([a.r.status, a.r.error, a.calls], ["error", "pobb.in returned HTTP 429", 2]);
});

test("lookup: the stored build for a page address, as the page box asks for it", async () => {
  // The page box (src/page.js) shows only stored builds of share links: any form of the link finds the record, a page
  // that isn't a share link or a link without a build finds nothing, and a share link not yet stored has no record.
  const { rec, fetch } = await setup({ [RAW]: CODE });
  assert.deepEqual(await rec.lookup(LINK), { key: "pobbin:abc123", record: null }, "a share link before its visit is stored");
  await rec.visit(LINK);
  const found = await rec.lookup(LINK + "?utm=x#top");
  assert.equal(found.key, "pobbin:abc123");
  assert.equal(found.record.status, "ok");
  assert.equal(found.record.info.mainSkill, "Arc");
  assert.equal(await rec.lookup("https://poe.ninja/poe1/builds"), null, "not a share link");
  assert.equal(await rec.lookup(""), null);
  assert.equal(await rec.lookup("not a url"), null);
  await rec.visit("https://pobb.in/missing1"); // 404: remembered as not a build
  assert.equal(await rec.lookup("https://pobb.in/missing1"), null, "a link that holds no build");
  const before = fetch.calls.length;
  await rec.lookup(LINK);
  assert.equal(fetch.calls.length, before, "lookup never downloads");
});

test("lookup sees edits and deletes made elsewhere (the popup)", async () => {
  const { rec } = await setup({ [RAW]: CODE });
  await rec.visit(LINK);
  await rec.edit("pobbin:abc123", { customName: "From the popup", favorite: true });
  const found = await rec.lookup(LINK);
  assert.equal(found.record.customName, "From the popup");
  assert.equal(found.record.favorite, true);
  await rec.remove("pobbin:abc123");
  assert.deepEqual(await rec.lookup(LINK), { key: "pobbin:abc123", record: null }, "deleted: no box until the next visit");
});
