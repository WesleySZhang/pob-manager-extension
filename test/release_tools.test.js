"use strict";
// Self-update file for Firefox (format: extensionworkshop.com, "Updating your extension") and the version bump.
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeUpdates, xpiName, SITE, UPDATE_URL } = require("../tools/updates_json.js");
const { setVersion } = require("../tools/set_version.js");

const OPTS = { id: "x@y", version: "0.1.1", link: SITE + xpiName("0.1.1"), sha256: "a".repeat(64), minVersion: "140.0" };

test("makeUpdates writes Mozilla's update manifest shape for the newest version", () => {
  assert.deepEqual(makeUpdates(OPTS), {
    addons: { "x@y": { updates: [{
      version: "0.1.1",
      update_link: "https://wesleyszhang.github.io/pob-manager-extension/pob-manager-extension-0.1.1-firefox.xpi",
      update_hash: "sha256:" + "a".repeat(64),
      applications: { gecko: { strict_min_version: "140.0" } },
    }] } },
  });
  assert.equal(UPDATE_URL, SITE + "updates.json");
});

test("makeUpdates rejects missing fields, non-https links and bad hashes", () => {
  for (const k of Object.keys(OPTS)) assert.throws(() => makeUpdates(Object.assign({}, OPTS, { [k]: "" })), new RegExp("needs " + k));
  assert.throws(() => makeUpdates(Object.assign({}, OPTS, { link: "http://x/a.xpi" })), /https/);
  assert.throws(() => makeUpdates(Object.assign({}, OPTS, { sha256: "abc" })), /64 hex/);
});

test("setVersion changes only the top-level version and keeps formatting", () => {
  const text = '{\n  "name": "n",\n  "version": "0.1.0",\n  "deps": { "a": { "version": "9.9.9" } }\n}\n';
  assert.equal(setVersion(text, "0.1.1"), text.replace('"0.1.0"', '"0.1.1"'));
  assert.throws(() => setVersion(text, "0.1"), /look like/);
  assert.throws(() => setVersion("{}", "1.0.0"), /No version field/);
});

test("the release workflow copies the files tools/build.js and tools/updates_json.js name", () => {
  // .github/workflows/release.yml names the release files from SLUG and picks the Chrome zip by its built name; a rename
  // on one side would only fail at release time, after Mozilla has signed (and used up) the version.
  const fs = require("fs");
  const path = require("path");
  const { packageNames } = require("../tools/build.js");
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n"); // CRLF in a Windows checkout
  const slug = /^\s+SLUG: (\S+)$/m.exec(yml)[1];
  assert.equal(xpiName("1.2.3"), slug + "-1.2.3-firefox.xpi");
  assert.ok(yml.includes('"dist/packages/' + packageNames("$V").chrome + '"'), "release.yml copies " + packageNames("$V").chrome);
  assert.ok(yml.includes(UPDATE_URL), "release.yml's comment names the update URL");
});

test("the release workflow releases a new version pushed to main, once, tagging the commit it built", () => {
  // A push to main is the release trigger (README "Releasing"): a version that already has a release must not be signed
  // again (Mozilla signs a version once), and the tag must point at the commit the files came from.
  const fs = require("fs");
  const path = require("path");
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8").replace(/\r\n/g, "\n"); // CRLF in a Windows checkout
  assert.match(yml, /^on:\n  push:\n    branches: \[main\]\n/m);
  assert.ok(!/tags:/.test(yml.split("jobs:")[0]), "no tag trigger: a tag push would release a second time");
  assert.match(yml, /gh release view "v\$V"/, "skips a version that already has a release");
  assert.match(yml, /if: needs\.check\.outputs\.release == 'true'/, "the release job only runs for a new version");
  assert.match(yml, /gh release create "v\$V" release\/\* --target "\$GITHUB_SHA"/);
  assert.match(yml, /node tools\/release_version\.js "v\$V"/, "manifest.base.json and package.json must agree");
});
