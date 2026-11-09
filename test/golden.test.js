// Reference: headless Path of Building v2.67.2 (b32759a). test/fixtures/golden/expected.json holds what PoB shows for
// each fixture build (tools/pob_fields.lua, written by tools/make_fixtures.js): class, ascendancy, level, main skill,
// keystones, uniques, and the same for every loadout after selecting it in PoB's loadout drop-down.
// Tolerance: exact. Same build XML on both sides; PoB is the reference.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { readBuild } = require("../src/buildinfo.js");
const data = require("../data/pobdata.js");

const dir = path.join(__dirname, "fixtures", "golden");
const expected = require(path.join(dir, "expected.json")).builds;

function pick(f) {
  return { className: f.className, ascendancy: f.ascendancy, mainSkill: f.mainSkill, keystones: f.keystones, uniques: f.uniques };
}

test("every fixture build has a PoB reference", () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".xml")).sort();
  assert.ok(files.length >= 20);
  assert.deepEqual(files, Object.keys(expected).sort());
});

for (const [file, want] of Object.entries(expected)) {
  test("matches headless PoB: " + file, () => {
    const got = readBuild(fs.readFileSync(path.join(dir, file), "utf8"), data);
    assert.deepEqual(pick(got), pick(want));
    assert.equal(got.level, want.level);
    assert.deepEqual(got.loadouts.map((l) => l.name), want.loadouts.map((l) => l.name), "loadout names");
    want.loadouts.forEach((w, i) => assert.deepEqual(pick(got.loadouts[i]), pick(w), "loadout " + w.name));
  });
}

test("loadout fixtures cover PoB's rules", () => {
  // The shapes the loadout fixtures were made to test (tools/make_fixtures.js), as PoB showed them.
  const names = (f) => expected[f].loadouts.map((l) => l.name);
  assert.deepEqual(names("loadouts_named.xml"), ["Leveling", "Endgame"]);
  // "Endgame {2,3}": only link 2 has item, skill and config sets; "Config {1,2}" serves both loadouts.
  assert.deepEqual(names("loadouts_linked.xml"), ["Leveling {1}", "Endgame {2}"]);
  // A spec on an older tree is named "[3.28] Endgame" and matches no set (Build.lua SyncLoadouts / TreeTab GetSpecList).
  assert.deepEqual(names("loadouts_old_tree.xml"), ["Leveling"]);
  // The two loadouts differ, so selecting one changes what is shown.
  assert.notDeepEqual(pick(expected["loadouts_named.xml"].loadouts[0]), pick(expected["loadouts_named.xml"].loadouts[1]));
});

test("the saved state that is no loadout comes first as 'As saved' in the popup's views", () => {
  const { viewsOf } = require("../src/filter.js");
  const info = readBuild(fs.readFileSync(path.join(dir, "loadouts_unmatched_saved.xml"), "utf8"), data);
  const views = viewsOf({ info: info });
  assert.deepEqual(views.map((v) => [v.name, v.saved]), [["As saved", true], ["Leveling", false]]);
  assert.equal(views[0].info.mainSkill, expected["loadouts_unmatched_saved.xml"].mainSkill);
});

test("sidebar text: every saved stat of every fixture formats exactly as PoB's buildMode:FormatStat", () => {
  // Reference: headless PoB's FormatStat on each <PlayerStat> value (tools/pob_fields.lua formattedStats), compact
  // values off, "," thousands, "." decimals. Exact.
  const { formatStat } = require("../src/statfmt.js");
  let n = 0;
  for (const [file, want] of Object.entries(expected)) {
    const r = readBuild(fs.readFileSync(path.join(dir, file), "utf8"), data);
    for (const [stat, text] of Object.entries(want.formatted)) {
      const def = data.statDefs[stat];
      assert.equal(formatStat(r.stats[stat], def, def.oc ? r.stats[def.oc] : undefined), text, file + " " + stat);
      n++;
    }
  }
  assert.ok(n > 1500, "compared " + n);
});
