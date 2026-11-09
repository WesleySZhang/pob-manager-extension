// The extension package (tools/build.js): the manifests can reach every site, the background script loads the same
// files in Chrome (importScripts) and Firefox (background.scripts), and the .zip/.xpi hold the built folders. Exact.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { targets, files, backgroundScripts, packageNames, packagesDir } = require("../tools/build.js");
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

test("no permissions beyond storage and the share sites; Firefox declares that no data is collected", () => {
  assert.deepEqual(targets.chrome.permissions, ["storage"]);
  const gecko = targets.firefox.browser_specific_settings.gecko;
  assert.equal(gecko.id, "pob-manager@local");
  assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
  assert.equal(gecko.strict_min_version, "140.0", "first Firefox with data_collection_permissions");
});

// File names in a zip, read from its central directory (PKWARE APPNOTE 4.3.12/4.3.16): independent of the tool
// that wrote it.
function zipEntries(file) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, "end of central directory in " + file);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, "central directory entry");
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    names.push(buf.toString("utf8", at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names.filter((n) => !n.endsWith("/")).sort();
}

function walk(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel)); else out.push(rel);
  }
  return out.sort();
}

test("npm run build makes a Chrome .zip and a Firefox .xpi holding exactly the built folders", () => {
  execFileSync(process.execPath, [path.join(root, "tools", "build.js")], { stdio: "ignore" });
  const version = JSON.parse(fs.readFileSync(path.join(root, "manifest.base.json"), "utf8")).version;
  const names = packageNames(version);
  assert.deepEqual(names, { chrome: "pob-manager-chrome-" + version + ".zip", firefox: "pob-manager-firefox-" + version + ".xpi" });
  for (const browser of ["chrome", "firefox"]) {
    const pkg = path.join(packagesDir, names[browser]);
    assert.ok(fs.existsSync(pkg), pkg);
    const entries = zipEntries(pkg);
    assert.deepEqual(entries, walk(path.join(root, "dist", browser), ""), browser);
    assert.ok(entries.includes("manifest.json") && entries.includes("popup/popup.html"), browser);
  }
});
