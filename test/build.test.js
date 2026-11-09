// The extension package (tools/build.js): the manifests can reach every site, and the background script loads the same
// files in Chrome (importScripts) and Firefox (background.scripts). Tolerance: exact.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { targets, files, backgroundScripts } = require("../tools/build.js");
const { SITES, describe } = require("../src/sites.js");

const root = path.join(__dirname, "..");

test("host permissions cover every site's pages and raw code URLs", () => {
  const perms = targets.chrome.host_permissions;
  assert.deepEqual(targets.firefox.host_permissions, perms);
  for (const s of SITES) {
    const d = describe(s.key, "abc");
    for (const url of [d.link, d.raw]) {
      const host = new URL(url).host;
      assert.ok(perms.includes("https://" + host + "/*"), url);
    }
  }
});

test("Chrome's importScripts and Firefox's background scripts load the same files in the same order", () => {
  const src = fs.readFileSync(path.join(root, "src", "background.js"), "utf8");
  const imported = /importScripts\(([^)]*)\)/.exec(src)[1].match(/"([^"]+)"/g).map((s) => path.posix.join("src", s.slice(1, -1)));
  assert.deepEqual(imported.concat(["src/background.js"]), backgroundScripts);
  assert.equal(targets.chrome.background.service_worker, "src/background.js");
});

test("every packaged file exists, and the popup only loads packaged files", () => {
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), f);
  const html = fs.readFileSync(path.join(root, "popup", "popup.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(files.includes(path.posix.join("popup", m[1])), m[1]);
  }
  assert.equal(targets.chrome.action.default_popup, "popup/popup.html");
  for (const icon of Object.values(targets.chrome.icons)) assert.ok(fs.existsSync(path.join(root, icon)), icon);
});

test("no permissions beyond storage and the share sites", () => {
  assert.deepEqual(targets.chrome.permissions, ["storage"]);
  assert.equal(targets.firefox.browser_specific_settings.gecko.id, "pob-manager@local");
});
