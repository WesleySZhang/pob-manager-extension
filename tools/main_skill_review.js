// Lists the builds where our main-skill rule (src/buildinfo.js autoMainSkill) differs from PoB's saved main skill, for a
// person to review. Reads the build XMLs tools/accuracy.js wrote to .local/accuracy/xml (run that first).
// Usage: node tools/main_skill_review.js [folder of build XMLs]
"use strict";
const fs = require("fs");
const path = require("path");
const B = require("../src/buildinfo.js");
const data = require("../data/pobdata.js");

const dir = process.argv[2] || path.join(__dirname, "..", ".local", "accuracy", "xml");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xml"));
let views = 0;
const changed = {};
for (const f of files) {
  const r = B.readBuild(fs.readFileSync(path.join(dir, f), "utf8"), data);
  const all = [{ name: "(saved)", info: r }].concat(r.loadouts.filter((l) => !l.active).map((l) => ({ name: l.name, info: l })));
  for (const v of all) {
    views++;
    if (v.info.autoMainSkill === v.info.mainSkill) continue;
    const k = (v.info.mainSkill || "none") + " -> " + v.info.autoMainSkill;
    (changed[k] = changed[k] || []).push(f + " " + v.name);
  }
}
const rows = Object.entries(changed).sort((a, b) => b[1].length - a[1].length);
console.log(files.length + " builds, " + views + " build states; our pick differs from PoB's in " + rows.reduce((n, r) => n + r[1].length, 0));
for (const [k, list] of rows) console.log(String(list.length).padStart(4) + "  " + k + "   e.g. " + list.slice(0, 2).join(", "));
