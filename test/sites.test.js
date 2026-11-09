// Reference: Path of Building v2.67.2 (b32759a) src/Modules/BuildSiteTools.lua buildSites.websiteList — each site's
// matchURL/regexURL (page links), downloadURL (raw code) and protocol id (pob://<id lowercased>/...).
// Tolerance: exact strings.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { matchUrl, describe, SITES } = require("../src/sites.js");

const CASES = [
  // [page link, site, id, raw code URL, pob:// URI]
  ["https://maxroll.gg/poe/pob/r7sh0f2", "maxroll", "r7sh0f2", "https://maxroll.gg/poe/api/pob/r7sh0f2", "pob://maxroll/r7sh0f2"],
  ["https://pob.codes/b/xyz789", "pobcodes", "xyz789", "https://api.pob.codes/xyz789/raw", "pob://pobcodes/xyz789"],
  ["https://pobb.in/eQVFNoqVZrza", "pobbin", "eQVFNoqVZrza", "https://pobb.in/pob/eQVFNoqVZrza", "pob://pobbin/eQVFNoqVZrza"],
  ["https://pobb.in/agb0V8xT8c-j", "pobbin", "agb0V8xT8c-j", "https://pobb.in/pob/agb0V8xT8c-j", "pob://pobbin/agb0V8xT8c-j"],
  ["https://poe.ninja/poe1/pob/934b3", "poeninja", "934b3", "https://poe.ninja/poe1/pob/raw/934b3", "pob://poeninja/934b3"],
  ["https://poe.ninja/pob/934b3", "poeninja", "934b3", "https://poe.ninja/poe1/pob/raw/934b3", "pob://poeninja/934b3"],
  ["https://pastebin.com/AbC123xy", "pastebin", "AbC123xy", "https://pastebin.com/raw/AbC123xy", "pob://pastebin/AbC123xy"],
  ["https://pastebinp.com/AbC123xy", "pastebinp", "AbC123xy", "https://pastebinp.com/raw/AbC123xy", "pob://pastebinproxy/AbC123xy"],
  ["https://rentry.co/mybuild1", "rentry", "mybuild1", "https://rentry.co/paste/mybuild1/raw", "pob://rentry/mybuild1"],
  ["https://poedb.tw/pob/k3k3", "poedb", "k3k3", "https://poedb.tw/pob/k3k3/raw", "pob://poedb/k3k3"],
];

for (const [url, site, id, raw, uri] of CASES) {
  test("matches " + url, () => {
    const m = matchUrl(url);
    assert.ok(m, "should match");
    assert.equal(m.site, site);
    assert.equal(m.id, id);
    assert.equal(m.key, site + ":" + id);
    assert.equal(m.raw, raw);
    assert.equal(m.pobUri, uri);
  });
}

test("covers every site in PoB's list", () => {
  assert.deepEqual(SITES.map((s) => s.label).sort(), ["Maxroll", "PastebinP", "Pastebin", "Rentry", "pob.codes", "pobb.in", "poe.ninja", "poedb"].sort());
  assert.deepEqual(new Set(CASES.map((c) => c[1])), new Set(SITES.map((s) => s.key)));
});

test("poe.ninja: only the PoB share page is a build link, never builds or character pages", () => {
  // Wesley, Nov 8, 2026: record poe.ninja/poe1/pob/<id>, not character pages. Made-up account and character names.
  for (const url of [
    "https://poe.ninja/poe1/builds/allflamessf/character/Someone-1234/SomeCharacter#i=12",
    "https://poe.ninja/poe1/builds/allflamessf/character/Someone-1234/SomeCharacter",
    "https://poe.ninja/poe1/builds/allflame",
    "https://poe.ninja/poe1/builds",
    "https://poe.ninja/poe1/pob/raw/934b3",
    "https://poe.ninja/poe1/pob",
    "https://poe.ninja/poe1/economy/allflame/currency",
    "https://poe.ninja/",
  ]) assert.equal(matchUrl(url), null, url);
});

test("pobb.in's own pages are not builds", () => {
  for (const p of ["about", "pob", "api", "u", "login", "settings", "privacy", "terms", "faq", "search", "new", "About"]) {
    assert.equal(matchUrl("https://pobb.in/" + p), null, p);
  }
  assert.equal(matchUrl("https://pobb.in/u/someone"), null);
  assert.equal(matchUrl("https://pobb.in/"), null);
});

test("query strings, fragments, trailing slashes and www are ignored", () => {
  assert.equal(matchUrl("https://pobb.in/eQVFNoqVZrza?utm=x#top").key, "pobbin:eQVFNoqVZrza");
  assert.equal(matchUrl("https://poe.ninja/poe1/pob/934b3/").key, "poeninja:934b3");
  assert.equal(matchUrl("https://www.pastebin.com/AbC123xy").key, "pastebin:AbC123xy");
  assert.equal(matchUrl("https://POBB.IN/eQVFNoqVZrza").key, "pobbin:eQVFNoqVZrza");
});

test("non-matching and malformed URLs", () => {
  for (const url of ["http://pobb.in/eQVFNoqVZrza", "https://example.com/pob/abc", "not a url", "", "https://pastebin.com/raw/AbC123xy",
    "https://pastebin.com/u/someone", "https://maxroll.gg/poe/build-guides/x", "https://poedb.tw/us/Mageblood", "https://pob.codes/",
    "https://pobb.in.evil.com/eQVFNoqVZrza", "https://rentry.co/a/b", "https://poe.ninja/poe1/pob/abc-def"]) {
    assert.equal(matchUrl(url), null, url);
  }
  assert.equal(matchUrl("https://maxroll.gg/poe/pob/%E0%A4%A"), null, "bad percent-encoding");
});

test("only Pastebin, PastebinP and Rentry are general paste sites", () => {
  assert.deepEqual(SITES.filter((s) => describe(s.key, "x").paste).map((s) => s.key).sort(), ["pastebin", "pastebinp", "rentry"]);
});

test("describe rebuilds a record's links and rejects unknown sites", () => {
  assert.equal(describe("pobbin", "a b").link, "https://pobb.in/a%20b");
  assert.throws(() => describe("nope", "x"), /Unknown site/);
});
