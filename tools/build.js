// Builds dist/chrome and dist/firefox from manifest.base.json, src/, data/, popup/ and icons/.
// Chrome MV3 uses a service worker background (src/background.js loads the rest with importScripts); Firefox MV3 uses
// background scripts listed in order, and needs a gecko id.
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const base = JSON.parse(fs.readFileSync(path.join(root, "manifest.base.json"), "utf8"));
const backgroundScripts = ["data/pobdata.js", "src/xml.js", "src/buildinfo.js", "src/sites.js", "src/pobcode.js", "src/store.js", "src/recorder.js", "src/background.js"];
const targets = {
  chrome: Object.assign({}, base, { background: { service_worker: "src/background.js" } }),
  firefox: Object.assign({}, base, {
    background: { scripts: backgroundScripts },
    browser_specific_settings: { gecko: { id: "pob-manager@local", strict_min_version: "121.0" } },
  }),
};
const files = [
  "src/xml.js", "src/buildinfo.js", "src/sites.js", "src/pobcode.js", "src/store.js", "src/recorder.js", "src/filter.js", "src/background.js",
  "data/pobdata.js", "data/leagues.js",
  "popup/popup.html", "popup/popup.css", "popup/popup.js",
];

function build() {
  for (const [name, manifest] of Object.entries(targets)) {
    const out = path.join(root, "dist", name);
    fs.rmSync(out, { recursive: true, force: true });
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(out, f));
    }
    fs.mkdirSync(path.join(out, "icons"), { recursive: true });
    for (const icon of new Set(Object.values(manifest.icons).concat(Object.values(manifest.action.default_icon)))) {
      fs.copyFileSync(path.join(root, icon), path.join(out, icon));
    }
    fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log("built " + path.relative(root, out));
  }
}

if (require.main === module) build();
module.exports = { targets, files, backgroundScripts };
