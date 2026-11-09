// Writes test/fixtures/golden: build XMLs plus expected.json, the fields headless Path of Building v2.67.2 shows for
// each (tools/pob_fields.lua). test/golden.test.js checks src/buildinfo.js against it exactly.
//  - Copies of builds from PoE-Sim's tests/golden (generated test builds, no account names).
//  - Loadout builds made here from jewels/watchers_eye_discipline.xml: two tree specs, item, skill and config sets titled for PoB's
//    loadout rules (Build.lua SyncLoadouts): exact names, {n} links, an old-tree spec, and a saved state that is no
//    loadout.
// Usage: node tools/make_fixtures.js [path to PoE-Sim]   (needs PoE-Sim's pinned PoB and LuaJIT)
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const sim = process.argv[2] || path.join(root, "..", "PoE-Sim");
const golden = path.join(sim, "tests", "golden");
const out = path.join(root, "test", "fixtures", "golden");

const COPY = [
  "crit_cyclone.xml", "es_ci_arc.xml", "dual_wield_cleave.xml", "elementalist_fireball.xml", "armour_block_heavy_strike.xml",
  "jewels/militant_faith.xml", "jewels/lethal_pride.xml", "jewels/glorious_vanity.xml", "jewels/elegant_hubris.xml",
  "jewels/cluster_large.xml", "jewels/cluster_nested.xml", "jewels/abyss_belt.xml", "jewels/abyss_tree_socket.xml",
  "jewels/watchers_eye_discipline.xml", "jewels/forbidden_pair.xml", "jewels/unnatural_instinct.xml",
];

function one(xml, re, what) {
  const m = re.exec(xml);
  if (!m) throw new Error("the loadout base build has no " + what);
  return m[0];
}

/** Two of everything, titled by `t` = { spec: [a, b], item: [a, b], skill: [a, b], config: [a, b] }. */
function loadoutBuild(base, t, opts) {
  const o = opts || {};
  const spec = one(base, /<Spec\b[\s\S]*?<\/Spec>/, "Spec");
  const items = one(base, /<ItemSet\b[\s\S]*?<\/ItemSet>/, "ItemSet");
  const skills = one(base, /<SkillSet\b[\s\S]*?<\/SkillSet>/, "SkillSet");
  const config = one(base, /<ConfigSet\b[\s\S]*?<\/ConfigSet>/, "ConfigSet");
  const title = (el, tag, v) => el.replace(new RegExp("<" + tag + "\\b"), "<" + tag + ' title="' + v + '"');
  // The second loadout differs: Assassin (ascendClassId 1), no gear, its second skill group moved last (the base has Fireball, Discipline, Fireball and main group 3,
  // so the second loadout's main skill is Discipline).
  let spec2 = title(spec, "Spec", t.spec[1]).replace(/ascendClassId="\d+"/, 'ascendClassId="1"');
  if (o.oldTree) spec2 = spec2.replace(/treeVersion="[^"]+"/, 'treeVersion="3_28"');
  const groups = skills.match(/<Skill\b[\s\S]*?<\/Skill>/g) || [];
  const skills2 = skills.replace(/<SkillSet id="1"/, '<SkillSet id="2"').replace(/<Skill\b[\s\S]*<\/Skill>/, [groups[0]].concat(groups.slice(2), groups.slice(1, 2)).join("\n"));
  const items2 = items.replace(/<ItemSet id="1"/, '<ItemSet id="2"').replace(/<Slot\b[^>]*\/>/g, "");
  const config2 = config.replace(/<ConfigSet id="1"/, '<ConfigSet id="2"');
  let xml = base
    .replace(spec, title(spec, "Spec", t.spec[0]) + "\n" + spec2)
    .replace(items, title(items, "ItemSet", t.item[0]) + "\n" + title(items2, "ItemSet", t.item[1]))
    .replace(skills, title(skills, "SkillSet", t.skill[0]) + "\n" + title(skills2, "SkillSet", t.skill[1]))
    .replace(config, title(config, "ConfigSet", t.config[0]) + "\n" + title(config2, "ConfigSet", t.config[1]));
  if (o.activeSecond) {
    xml = xml.replace(/<Tree activeSpec="1"/, '<Tree activeSpec="2"').replace(/activeItemSet="1"/, 'activeItemSet="2"')
      .replace(/activeSkillSet="1"/, 'activeSkillSet="2"').replace(/activeConfigSet="1"/, 'activeConfigSet="2"');
  }
  return xml;
}

function main() {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of COPY) fs.copyFileSync(path.join(golden, f), path.join(out, path.basename(f)));
  // Three skill groups and a socketed unique jewel, so the two loadouts differ in main skill.
  const base = fs.readFileSync(path.join(golden, "jewels", "watchers_eye_discipline.xml"), "utf8");
  const made = {
    "loadouts_named.xml": loadoutBuild(base, { spec: ["Leveling", "Endgame"], item: ["Leveling", "Endgame"], skill: ["Leveling", "Endgame"], config: ["Leveling", "Endgame"] }),
    "loadouts_named_second_active.xml": loadoutBuild(base, { spec: ["Leveling", "Endgame"], item: ["Leveling", "Endgame"], skill: ["Leveling", "Endgame"], config: ["Leveling", "Endgame"] }, { activeSecond: true }),
    "loadouts_linked.xml": loadoutBuild(base, { spec: ["Leveling {1}", "Endgame {2,3}"], item: ["Gear A {1}", "Gear B {2}"], skill: ["Skills A {1}", "Skills B {2}"], config: ["Config {1,2}", "Spare"] }),
    "loadouts_old_tree.xml": loadoutBuild(base, { spec: ["Leveling", "Endgame"], item: ["Leveling", "Endgame"], skill: ["Leveling", "Endgame"], config: ["Leveling", "Endgame"] }, { oldTree: true }),
    "loadouts_unmatched_saved.xml": loadoutBuild(base, { spec: ["Leveling", "Endgame"], item: ["Leveling", "Other"], skill: ["Leveling", "Other"], config: ["Leveling", "Other"] }, { activeSecond: true }),
  };
  for (const [name, xml] of Object.entries(made)) fs.writeFileSync(path.join(out, name), xml);

  const files = fs.readdirSync(out).filter((f) => f.endsWith(".xml")).sort();
  const list = path.join(root, ".local", "fixtures-list.txt");
  fs.mkdirSync(path.dirname(list), { recursive: true });
  fs.writeFileSync(list, files.map((f) => path.join(out, f).replace(/\\/g, "/")).join("\n") + "\n");
  const jsonl = path.join(root, ".local", "fixtures-pob.jsonl");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "pob_fields.ps1"), list, jsonl, "-PoeSim", sim],
    { stdio: ["ignore", "ignore", "inherit"] });
  const expected = {};
  for (const line of fs.readFileSync(jsonl, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.error) throw new Error("PoB could not load " + r.file + ": " + r.error);
    const name = path.basename(r.file);
    delete r.file;
    expected[name] = r;
  }
  fs.writeFileSync(path.join(out, "expected.json"), JSON.stringify({
    source: "headless Path of Building v2.67.2 (b32759a) via tools/pob_fields.lua; written by tools/make_fixtures.js",
    builds: expected,
  }, null, 2) + "\n");
  console.log("wrote " + files.length + " fixtures and expected.json");
}

main();
