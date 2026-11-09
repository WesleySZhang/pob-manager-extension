// Builds dist/chrome and dist/firefox from manifest.base.json, src/, data/, popup/ and icons/, then packages them with
// Mozilla's web-ext: dist/packages/pob-manager-chrome-<version>.zip and pob-manager-firefox-<version>.xpi.
// Chrome MV3 uses a service worker background (src/background.js loads the rest with importScripts); Firefox MV3 uses
// background scripts listed in order, and needs a gecko id.
// The .xpi is unsigned: release Firefox only installs signed add-ons (see README, "Install").
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const base = JSON.parse(fs.readFileSync(path.join(root, "manifest.base.json"), "utf8"));
const backgroundScripts = ["data/pobdata.js", "src/xml.js", "src/buildinfo.js", "src/sites.js", "src/pobcode.js", "src/store.js", "src/recorder.js", "src/background.js"];
const targets = {
  chrome: Object.assign({}, base, { background: { service_worker: "src/background.js" } }),
  firefox: Object.assign({}, base, {
    background: { scripts: backgroundScripts },
    browser_specific_settings: { gecko: {
      // Mozilla signs under this id; installed copies update only to the same id, so it must never change.
      id: "pob-manager@pob-manager-extension",
      // Self-distributed updates: the release workflow publishes this file to GitHub Pages (tools/updates_json.js).
      // Installed copies keep checking the URL they were installed with, so it must never move.
      update_url: require("./updates_json.js").UPDATE_URL,
      // Nothing leaves the browser except the download of each build from its own site, so no data is collected:
      // Mozilla's "none" category (extensionworkshop.com, firefox-builtin-data-consent). Firefox reads this key from 140.
      strict_min_version: "140.0",
      data_collection_permissions: { required: ["none"] },
    }, gecko_android: { strict_min_version: "142.0" } }, // Android reads data_collection_permissions from 142
  }),
};
const files = [
  "src/xml.js", "src/buildinfo.js", "src/sites.js", "src/pobcode.js", "src/store.js", "src/recorder.js", "src/filter.js", "src/buildview.js", "src/statfmt.js", "src/details.js", "src/background.js", "src/page.js",
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

const packagesDir = path.join(root, "dist", "packages");
/** The package file names for a version: pob-manager-<browser>-<version>.<zip|xpi>. */
function packageNames(version) {
  return { chrome: "pob-manager-chrome-" + version + ".zip", firefox: "pob-manager-firefox-" + version + ".xpi" };
}

/** Zips dist/chrome and dist/firefox into dist/packages with web-ext (the same zip Mozilla's tools make). */
function packageAll() {
  const webExt = path.join(root, "node_modules", "web-ext", "bin", "web-ext.js");
  const names = packageNames(base.version);
  fs.mkdirSync(packagesDir, { recursive: true });
  for (const name of Object.keys(names)) {
    execFileSync(process.execPath, [webExt, "build", "--source-dir", path.join(root, "dist", name), "--artifacts-dir", packagesDir,
      "--filename", names[name], "--overwrite-dest", "--no-input"], { stdio: ["ignore", "ignore", "inherit"] });
    console.log("packaged " + path.relative(root, path.join(packagesDir, names[name])));
  }
}

if (require.main === module) {
  build();
  if (process.argv.indexOf("--no-package") === -1) packageAll();
}
module.exports = { targets, files, backgroundScripts, packageNames, packagesDir };
