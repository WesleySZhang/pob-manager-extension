// Rules of src/buildinfo.js on synthetic builds (test/helpers.js). Each test names the Path of Building v2.67.2
// (b32759a) code it follows; tools/accuracy.js and test/golden.test.js check the same rules against headless PoB on
// real builds. Ids are from data/pobdata.js (tree 3_29). Tolerance: exact.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../src/buildinfo.js");
const data = require("../data/pobdata.js");
const leagues = require("../data/leagues.js");
const { pobXml, item } = require("./helpers.js");

const read = (o) => B.readBuild(pobXml(o), data);
const G = {
  arc: { nameSpec: "Arc", gemId: "Metadata/Items/Gems/SkillGemArc", variantId: "Arc", skillId: "Arc" },
  cyclone: { nameSpec: "Cyclone", gemId: "Metadata/Items/Gems/SkillGemCyclone", variantId: "Cyclone", skillId: "Cyclone" },
  vaalCyclone: { nameSpec: "Vaal Cyclone", gemId: "Metadata/Items/Gems/SkillGemVaalCyclone", variantId: "VaalCyclone", skillId: "VaalCyclone" },
  meleePhys: { nameSpec: "Melee Physical Damage", gemId: "Metadata/Items/Gems/SupportGemMeleePhysicalDamage", variantId: "SupportMeleePhysicalDamage", skillId: "SupportMeleePhysicalDamage" },
};
const skills = (groups, extra) => Object.assign({ skillSets: [{ id: 1, groups: groups }] }, extra);
const KS = { ironReflexes: "10661", ci: "11455", rt: "31961", mom: "34098" };

// ---------- gems and the main skill (SkillsTab.lua LoadSkill / ProcessSocketGroup, CalcSetup.lua) ----------

test("gem by gemId and variantId: a transfigured gem", () => {
  const r = read(skills([[{ nameSpec: "x", gemId: "Metadata/Items/Gems/SkillGemIceNova", variantId: "IceNovaAltX" }]]));
  assert.equal(r.mainSkill, "Ice Nova of Frostbolts");
});

test("gem by gemId and skillId when there is no variantId (pre-3.23 save format)", () => {
  const r = read(skills([[{ nameSpec: "x", gemId: "Metadata/Items/Gems/SkillGemIceNova", skillId: "IceNovaAltY" }]]));
  assert.equal(r.mainSkill, "Ice Nova of Deep Freeze");
});

test("a skill granted by an item: skillId with no gem", () => {
  const r = read(skills([{ gems: [{ nameSpec: "Icestorm", skillId: "Icestorm" }], source: "Item:1:Some Unique" }]));
  assert.equal(r.mainSkill, "Icestorm");
});

test("gem by name only: exact and case-insensitive; abbreviations are not resolved", () => {
  assert.equal(read(skills([["cyclone"]])).mainSkill, "Cyclone");
  assert.equal(read(skills([["CtF"]])).mainSkill, null);
  assert.deepEqual(read(skills([["CtF"]])).skills, ["CtF"], "an unresolved name is still searchable");
});

test("an unknown gemId falls back to the name (LoadSkill sets no gemId, ProcessSocketGroup matches nameSpec)", () => {
  assert.equal(read(skills([[{ nameSpec: "Arc", gemId: "Metadata/Items/Gems/NoSuchGem", skillId: "Cyclone" }]])).mainSkill, "Arc");
});

test("supports and disabled gems are not skills; mainActiveSkill picks among the rest", () => {
  const r = read(skills([{ gems: [G.meleePhys, Object.assign({}, G.arc, { enabled: "false" }), G.cyclone], mainActiveSkill: 1 }]));
  assert.equal(r.mainSkill, "Cyclone");
  assert.ok(r.skills.includes("Melee Physical Damage") && r.skills.includes("Arc"), "every gem is searchable");
});

test("Vaal gems: the base skill only with enableGlobal2; only effects with a global effect are toggled", () => {
  // Vaal Cyclone grants VaalCyclone, then Cyclone, which has hasGlobalEffect. CalcSetup.lua keeps an effect when
  // "not grantedEffect.hasGlobalEffect or gemInstance['enableGlobal'..index]", so VaalCyclone is always on.
  assert.equal(read(skills([{ gems: [G.vaalCyclone], mainActiveSkill: 2 }])).mainSkill, "Vaal Cyclone", "clamped to the one skill");
  assert.equal(read(skills([{ gems: [Object.assign({ enableGlobal2: "true" }, G.vaalCyclone)], mainActiveSkill: 2 }])).mainSkill, "Cyclone");
  assert.equal(read(skills([{ gems: [Object.assign({ enableGlobal1: "false", enableGlobal2: "true" }, G.vaalCyclone)], mainActiveSkill: 2 }])).mainSkill, "Cyclone");
  assert.equal(read(skills([{ gems: [Object.assign({ enableGlobal1: "false" }, G.vaalCyclone)] }])).mainSkill, "Vaal Cyclone");
  // A global effect at index 1 is switched off by enableGlobal1="false" (made-up data: Arc with a global effect).
  const d = Object.assign({}, data, { skills: Object.assign({}, data.skills, { Arc: { n: "Arc", glob: 1 } }) });
  assert.equal(B.readBuild(pobXml(skills([[Object.assign({ enableGlobal1: "false" }, G.arc)]])), d).mainSkill, null);
  assert.equal(B.readBuild(pobXml(skills([[G.arc]])), d).mainSkill, "Arc");
});

test("an unsupported main effect makes the gem resolve to nothing", () => {
  const d = Object.assign({}, data, { skills: Object.assign({}, data.skills, { Arc: { n: "Arc", uns: 1 } }) });
  assert.equal(B.readBuild(pobXml(skills([[G.arc]])), d).mainSkill, null);
});

test("main socket group: mainSkillIndex first, clamped to the groups (CalcSetup.lua:1487)", () => {
  assert.equal(read(skills([[G.arc], [G.cyclone]], { build: { mainSocketGroup: 9 } })).mainSkill, "Cyclone");
  assert.equal(read(skills([[G.arc], [G.cyclone]], { build: { mainSocketGroup: 2, mainSkillIndex: 1 } })).mainSkill, "Arc");
  assert.equal(read(skills([[G.arc], [G.cyclone]], { build: { mainSocketGroup: "nil" } })).mainSkill, "Arc");
  assert.equal(read(skills([])).mainSkill, null);
});

test("the active skill set, and old builds with bare <Skill> groups", () => {
  const r = read({ skillSets: [{ id: 1, groups: [[G.arc]] }, { id: 5, groups: [[G.cyclone]] }], activeSkillSet: 5 });
  assert.equal(r.mainSkill, "Cyclone");
  assert.equal(read({ skillSets: [{ id: 1, groups: [[G.arc]] }], activeSkillSet: 7 }).mainSkill, "Arc", "an unknown id falls back to the first set");
  assert.equal(read({ legacySkills: [[G.cyclone]] }).mainSkill, "Cyclone");
});

// ---------- our main skill pick (autoMainSkill; skill types from PoB Data/Skills via data/pobdata.js) ----------

test("damage skills vs utility skills, by PoB's skill types", () => {
  // Movement alone (Cyclone), Buff with damage over time (Righteous Fire), Aura on an attack (Smite) and a curse that
  // deals damage (Bane) are damage skills; minion makers count too.
  for (const id of ["StaticStrike", "Cyclone", "RighteousFire", "Smite", "Bane", "RaiseSpectre", "Fireball", "DualStrikeAltX"]) {
    assert.equal(B.isDamageSkill(id, data), true, id);
  }
  // Travel/Blink (Ambush, Shield Charge, Whirling Blades, Frostblink), Herald, Guard, Banner, auras, buffs and curses
  // that deal no damage, and supports.
  for (const id of ["Ambush", "ShieldCharge", "WhirlingBlades", "Frostblink", "HeraldOfAsh", "MoltenShell", "WarBanner", "Hatred",
    "BloodRage", "ElementalWeakness", "SupportMeleePhysicalDamage", "NoSuchSkill"]) {
    assert.equal(B.isDamageSkill(id, data), false, id);
  }
});

const AMBUSH = { nameSpec: "Ambush", skillId: "Ambush" };
const STATIC = { nameSpec: "Static Strike", skillId: "StaticStrike" };
const sup = (n) => ({ nameSpec: n });
test("PoB's main skill is kept when it deals damage", () => {
  const r = read(skills([[G.arc], [G.cyclone, G.meleePhys, sup("Brutality"), sup("Ruthless")]], { build: { mainSocketGroup: 1 } }));
  assert.equal(r.mainSkill, "Arc");
  assert.equal(r.autoMainSkill, "Arc");
});

test("a utility main skill gives way to the damage skill with the most supports (pobb.in/2FlZU8rRPp3F's shape)", () => {
  // Regression: the build's saved main group was Ambush (Helmet) while Static Strike sat in a 6-link.
  const r = read(skills([[STATIC, G.meleePhys, sup("Ruthless"), sup("Trinity"), sup("Close Combat")], [AMBUSH, sup("Second Wind"), sup("Lifetap")], [{ nameSpec: "Hatred" }]],
    { build: { mainSocketGroup: 2, ascendClassName: "Slayer" }, specs: [{ classId: 4, ascendClassId: 1 }] }));
  assert.equal(r.mainSkill, "Ambush", "PoB's own main skill is unchanged");
  assert.equal(r.autoMainSkill, "Static Strike");
  assert.equal(B.defaultName(r), "Static Strike Slayer");
  assert.equal(B.defaultName(r, "Ambush"), "Ambush Slayer", "a skill passed in wins");
  assert.deepEqual(r.activeSkills, ["Static Strike", "Ambush", "Hatred"]);
});

test("ties go to the earlier group; disabled groups and disabled supports don't count", () => {
  const twoEqual = read(skills([[AMBUSH], [G.cyclone, G.meleePhys], [G.arc, sup("Spell Echo")]]));
  assert.equal(twoEqual.autoMainSkill, "Cyclone");
  const disabled = read(skills([[AMBUSH], { gems: [G.cyclone, G.meleePhys, sup("Brutality")], enabled: "false" }, [G.arc, Object.assign(sup("Spell Echo"), { enabled: "false" })]]));
  assert.equal(disabled.autoMainSkill, "Arc");
});

test("no damage skill at all: PoB's choice stays", () => {
  assert.equal(read(skills([[AMBUSH], [{ nameSpec: "Hatred" }]])).autoMainSkill, "Ambush");
  assert.equal(read(skills([])).autoMainSkill, null);
});

test("a main skill whose gem also grants a damage skill stays (Frozen Legion's statues attack with Frozen Sweep)", () => {
  const r = read(skills([[{ nameSpec: "Frozen Legion" }, sup("Melee Physical Damage")], [G.arc, sup("Spell Echo"), sup("Controlled Destruction")]]));
  assert.equal(r.mainSkill, "Frozen Legion");
  assert.equal(r.autoMainSkill, "Frozen Legion");
});

test("each loadout gets its own pick, and the record says which reader read it", () => {
  const r = read({ specs: [{ title: "A" }, { title: "B" }],
    skillSets: [{ id: 1, title: "A", groups: [[AMBUSH], [STATIC, G.meleePhys]] }, { id: 2, title: "B", groups: [[G.arc]] }] });
  assert.deepEqual(r.loadouts.map((l) => [l.name, l.mainSkill, l.autoMainSkill]), [["A", "Ambush", "Static Strike"], ["B", "Arc", "Arc"]]);
  assert.equal(r.readerVersion, B.READER_VERSION);
});

// ---------- class, tree, patch ----------

test("class and ascendancy come from the tree spec's ids, not the <Build> attributes", () => {
  const r = read({ build: { className: "Witch", ascendClassName: "None" }, specs: [{ classId: 4, ascendClassId: 1 }] });
  assert.equal(r.className, "Duelist");
  assert.equal(r.ascendancy, "Slayer");
  const none = read({ specs: [{ classId: 3, ascendClassId: 0 }] });
  assert.equal(none.ascendancy, null);
});

test("without spec ids the <Build> attributes are used", () => {
  const xml = pobXml({ build: { className: "Shadow", ascendClassName: "Trickster" } }).replace(/ classId="\d+"/, "");
  const r = B.readBuild(xml, data);
  assert.equal(r.className, "Shadow");
  assert.equal(r.ascendancy, "Trickster");
});

test("patch, Ruthless and alternate trees, PoB's label", () => {
  const r = read({ specs: [{ treeVersion: "3_29_ruthless" }] });
  assert.deepEqual([r.patch, r.ruthless, r.alternate, r.patchLabel], ["3.29", true, false, "3.29 (ruthless)"]);
  const a = read({ specs: [{ treeVersion: "3_28_alternate" }] });
  assert.deepEqual([a.patch, a.ruthless, a.alternate, a.patchLabel], ["3.28", false, true, "3.28 (alternate)"]);
  const unknown = read({ specs: [{ treeVersion: "3_99" }] });
  assert.deepEqual([unknown.patch, unknown.patchLabel, unknown.keystones], ["3.99", "3_99", []]);
});

test("the active spec (Tree activeSpec) and the bloodline (secondaryAscendClassId into alternate_ascendancies)", () => {
  const r = read({ specs: [{ nodes: [KS.ci] }, { nodes: [KS.mom], secondaryAscendClassId: 4 }], activeSpec: 2 });
  assert.deepEqual(r.keystones, ["Mind Over Matter"]);
  assert.equal(r.bloodline, "Chaos Bloodline");
  assert.equal(read({ specs: [{ secondaryAscendClassId: "nil" }] }).bloodline, null);
});

test("patchOf and comparePatchDesc order 3.10 after 3.29 and before 3.9", () => {
  assert.equal(B.patchOf("3_10"), "3.10");
  assert.equal(B.patchOf(null), null);
  assert.deepEqual(["3.9", "3.29", "3.10", "2.6"].sort(B.comparePatchDesc), ["3.29", "3.10", "3.9", "2.6"]);
});

// ---------- items (CalcSetup.lua item loop) ----------

const MAGE = { id: 1, text: item("UNIQUE", "Mageblood", "Heavy Belt") };
test("uniques and relics in the active item set count; rares don't", () => {
  const r = read({
    items: [MAGE, { id: 2, text: item("RELIC", "Headhunter", "Leather Belt") }, { id: 3, text: item("RARE", "Doom Grip", "Gloves") }],
    itemSets: [{ id: 1, slots: [["Belt", 1], ["Gloves", 3]] }, { id: 2, slots: [["Belt", 2]] }], activeItemSet: 2,
  });
  assert.deepEqual(r.uniques, ["Headhunter"]);
});

test("weapon swap: only the set in use counts", () => {
  const items = [{ id: 1, text: item("UNIQUE", "Mjolner", "Gavel") }, { id: 2, text: item("UNIQUE", "Doryani's Catalyst", "Opal Sceptre") }];
  const slots = [["Weapon 1", 1], ["Weapon 1 Swap", 2]];
  assert.deepEqual(read({ items, itemSets: [{ id: 1, slots }] }).uniques, ["Mjolner"]);
  assert.deepEqual(read({ items, itemSets: [{ id: 1, slots, useSecondWeaponSet: "true" }] }).uniques, ["Doryani's Catalyst"]);
});

test("Ring 3 only with The Unseen Hand (+1 Ring Slot) allocated; Graft slots only on a 3.27 tree", () => {
  const items = [{ id: 1, text: item("UNIQUE", "Replica Voideye", "Unset Ring") }];
  assert.deepEqual(read({ items, itemSets: [{ id: 1, slots: [["Ring 3", 1]] }] }).uniques, []);
  assert.deepEqual(read({ items, itemSets: [{ id: 1, slots: [["Ring 3", 1]] }], specs: [{ nodes: ["43902"] }] }).uniques, ["Replica Voideye"]);
  const graft = [{ id: 1, text: item("UNIQUE", "Some Graft", "Graft") }];
  assert.deepEqual(read({ items: graft, itemSets: [{ id: 1, slots: [["Graft 1", 1]] }] }).uniques, []);
  assert.deepEqual(read({ items: graft, itemSets: [{ id: 1, slots: [["Graft 1", 1]] }], specs: [{ treeVersion: "3_27" }] }).uniques, ["Some Graft"]);
});

test("tree jewels count only in allocated sockets; item id 0 is an empty slot", () => {
  const items = [{ id: 7, text: item("UNIQUE", "Watcher's Eye", "Prismatic Jewel") }];
  assert.deepEqual(read({ items, specs: [{ nodes: ["2491"], sockets: [["2491", 7]] }] }).uniques, ["Watcher's Eye"]);
  assert.deepEqual(read({ items, specs: [{ nodes: [], sockets: [["2491", 7]] }] }).uniques, []);
  assert.deepEqual(read({ items, itemSets: [{ id: 1, slots: [["Belt", 0]] }] }).uniques, []);
});

// ---------- keystones ----------

test("allocated tree keystones", () => {
  assert.deepEqual(read({ specs: [{ nodes: [KS.ci, KS.rt, "12345"] }] }).keystones, ["Chaos Inoculation", "Resolute Technique"]);
});

test("item keystones: a whole line from PoB's keystone list, kept only if the tree knows it (ModTools.lua mergeKeystones)", () => {
  const it = { id: 1, text: item("UNIQUE", "Kaom's Roots", "Titan Greaves", ["Unwavering Stance", "you have unwavering stance", "Phase Acrobatics", "Iron Reflexes while moving"]) };
  const r = read({ items: [it], itemSets: [{ id: 1, slots: [["Boots", 1]] }] });
  // "Phase Acrobatics" is in data.keystones but not on the 3.29 tree; "you have unwavering stance" is the same line lower-cased.
  assert.deepEqual(r.keystones, ["Unwavering Stance"]);
});

test("item lines for another variant don't count (Item.lua: {variant:n} with Selected Variant)", () => {
  const lines = ["Selected Variant: 2", "{variant:1}Iron Reflexes", "{variant:2,3}{tags:x}Resolute Technique"];
  const r = read({ items: [{ id: 1, text: item("UNIQUE", "Test", "Belt", lines) }], itemSets: [{ id: 1, slots: [["Belt", 1]] }] });
  assert.deepEqual(r.keystones, ["Resolute Technique"]);
  assert.deepEqual(B.activeItemLines(["{variant:1}A", "B"]), ["A", "B"], "no Selected Variant: every line");
});

test("timeless jewels replace keystones in radius with the conqueror's (PassiveSpec.lua BuildAllDependsAndPaths)", () => {
  // Socket 2491's Large radius holds Arsenal of Vengeance (21210); Kaom's keystone is Strength of Blood (karui_keystone_1).
  const jewel = { id: 3, text: item("UNIQUE", "Lethal Pride", "Timeless Jewel", ["Radius: Large", "Commanded leadership over 10000 warriors under Kaom"]) };
  const r = read({ items: [jewel], specs: [{ nodes: ["2491", "21210"], sockets: [["2491", 3]] }] });
  assert.deepEqual(r.keystones, ["Strength of Blood"]);
  const notAllocated = read({ items: [jewel], specs: [{ nodes: ["21210"], sockets: [["2491", 3]] }] });
  assert.deepEqual(notAllocated.keystones, ["Arsenal of Vengeance"]);
  const noRadius = { id: 3, text: item("UNIQUE", "Lethal Pride", "Timeless Jewel", ["Commanded leadership over 10000 warriors under Kaom"]) };
  assert.deepEqual(read({ items: [noRadius], specs: [{ nodes: ["2491", "21210"], sockets: [["2491", 3]] }] }).keystones, ["Arsenal of Vengeance"]);
});

test("cluster jewel keystones: the sub-tree's entrance node must be allocated (PassiveSpec.lua BuildSubgraph ids)", () => {
  // Large socket 7960 is index 0: a Large jewel's entrance is 0x10000 + (0 << 6) + (2 << 4) = 65568.
  const large = { id: 4, text: item("RARE", "Cluster", "Large Cluster Jewel", ["Adds Disciple of Kitava"]) };
  assert.deepEqual(read({ items: [large], specs: [{ nodes: ["7960", "65568"], sockets: [["7960", 4]] }] }).keystones, ["Disciple of Kitava"]);
  assert.deepEqual(read({ items: [large], specs: [{ nodes: ["7960"], sockets: [["7960", 4]] }] }).keystones, []);
  // Small socket 2311 sits in medium socket 9408 (index 2) in large socket 7960 (index 0):
  // 0x10000 + (2 << 9) + (0 << 4) = 66560 (e.g. The Front Line).
  const small = { id: 5, text: item("UNIQUE", "The Front Line", "Small Cluster Jewel", ["Adds Veteran's Awareness"]) };
  assert.deepEqual(read({ items: [small], specs: [{ nodes: ["2311", "66560"], sockets: [["2311", 5]] }] }).keystones, ["Veteran's Awareness"]);
  assert.deepEqual(read({ items: [small], specs: [{ nodes: ["2311", "65536"], sockets: [["2311", 5]] }] }).keystones, []);
});

// ---------- stats ----------

test("DPS: FullDPS when non-zero, else CombinedDPS, else TotalDPS; Life and ES", () => {
  assert.deepEqual(pickDps(read({ stats: { FullDPS: 5, CombinedDPS: 4, TotalDPS: 3, Life: 100, EnergyShield: 20 } })), [5, "FullDPS", 100, 20]);
  assert.deepEqual(pickDps(read({ stats: { FullDPS: 0, CombinedDPS: 4, TotalDPS: 3 } })), [4, "CombinedDPS", null, null]);
  assert.deepEqual(pickDps(read({ stats: { TotalDPS: 3, Life: "nan" } })), [3, "TotalDPS", null, null]);
  assert.deepEqual(pickDps(read({})), [null, null, null, null]);
  function pickDps(r) { return [r.dps, r.dpsStat, r.life, r.es]; }
});

// ---------- loadouts (Build.lua SyncLoadouts and the loadout drop-down handler) ----------

test("one spec and one of each set is one loadout named after the spec", () => {
  const r = read({ specs: [{}] });
  assert.deepEqual(r.loadouts.map((l) => [l.name, l.active]), [["Default", true]]);
});

test("a kind with a single set matches every spec; linked ids need every other kind", () => {
  const r = read({
    specs: [{ title: "Map {1}", nodes: [KS.ci] }, { title: "Boss {2}", nodes: [KS.mom] }],
    skillSets: [{ id: 1, title: "S {1}", groups: [[G.arc]] }, { id: 2, title: "S {2}", groups: [[G.cyclone]] }],
  });
  assert.deepEqual(r.loadouts.map((l) => [l.name, l.mainSkill, l.keystones.join()]), [["Map {1}", "Arc", "Chaos Inoculation"], ["Boss {2}", "Cyclone", "Mind Over Matter"]]);
  const missing = read({ specs: [{ title: "Map {1}" }, { title: "Boss {3}" }], skillSets: [{ id: 1, title: "S {1}" }, { id: 2, title: "S {2}" }] });
  assert.deepEqual(missing.loadouts.map((l) => l.name), ["Map {1}"]);
});

test("a set whose title has a link is not matched by name", () => {
  const r = read({ specs: [{ title: "A" }, { title: "B" }], skillSets: [{ id: 1, title: "A {1}" }, { id: 2, title: "B" }] });
  assert.deepEqual(r.loadouts.map((l) => l.name), ["B"]);
});

test("stats belong to the saved state only; other loadouts carry no stats", () => {
  const r = read({ specs: [{ title: "A" }, { title: "B" }], skillSets: [{ id: 1, title: "A" }, { id: 2, title: "B" }], stats: { CombinedDPS: 9 } });
  assert.equal(r.dps, 9);
  assert.equal(r.loadouts[1].dps, undefined);
  assert.deepEqual(r.loadouts.map((l) => l.active), [true, false]);
});

// ---------- errors and helpers ----------

test("not a PoB build", () => {
  assert.throws(() => B.readBuild("<html><body/></html>", data), /Not a Path of Building build/);
  assert.throws(() => B.readBuild("<PathOfBuilding><Tree/></PathOfBuilding>", data), /no <Build>/);
  assert.throws(() => B.readBuild("not xml", data), /Bad XML/);
});

test("defaultName, leagueForPatch and leagueAt (data/leagues.js from the PoE wiki)", () => {
  assert.equal(B.defaultName({ mainSkill: "Cyclone", ascendancy: "Slayer", className: "Duelist" }), "Cyclone Slayer");
  assert.equal(B.defaultName({ mainSkill: null, ascendancy: null, className: "Duelist" }), "Duelist");
  assert.equal(B.defaultName({}), "Unnamed build");
  // wiki/leagues: Mercenaries 3.26.0 (2025-06-13 to 2025-10-27), Allflame 3.29.0 (2026-07-24 to 2026-11-09).
  assert.equal(B.leagueForPatch("3.26", leagues), "Mercenaries");
  assert.equal(B.leagueForPatch("3.29", leagues), "Allflame");
  assert.equal(B.leagueForPatch("9.9", leagues), null);
  assert.equal(B.leagueForPatch(null, leagues), null);
  assert.equal(B.leagueAt(Date.parse("2026-08-01T00:00:00Z"), leagues), "Allflame");
  assert.equal(B.leagueAt(Date.parse("2025-10-29T00:00:00Z"), leagues), null, "between Mercenaries and Keepers");
});
