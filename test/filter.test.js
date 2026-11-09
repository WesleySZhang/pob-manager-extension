// The popup's list logic (src/filter.js) on hand-made build records. Reference: the plan's popup rules
// (PoE-Sim-Notes pob-manager/PoB Manager Plan.md, "The popup"). Tolerance: exact.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../src/filter.js");
const leagues = require("../data/leagues.js");

function info(o) {
  return Object.assign({ className: "Duelist", ascendancy: "Slayer", level: 90, mainSkill: "Cyclone", skills: ["Cyclone", "Melee Physical Damage"],
    patch: "3.29", keystones: [], uniques: [], dps: null, life: null, loadouts: [] }, o);
}
function build(key, o, i) {
  return Object.assign({ key: key, link: "https://pobb.in/" + key, label: "pobb.in", status: "ok", lastSeen: 0, visits: 1, info: info(i) }, o);
}

const builds = [
  build("a", { lastSeen: 30, visits: 1, creator: "Zizaran" }, { dps: 4.2e6, life: 6100, keystones: ["Resolute Technique"], uniques: ["Mageblood"] }),
  build("b", { lastSeen: 20, visits: 5, customName: "My RF starter" }, { className: "Templar", ascendancy: "Inquisitor", mainSkill: "Righteous Fire", skills: ["Righteous Fire"], patch: "3.28", dps: 890e3, life: 9400 }),
  build("c", { lastSeen: 10, visits: 2 }, { className: "Witch", ascendancy: "Occultist", mainSkill: "Winter Orb", skills: ["Winter Orb"], patch: "3.10", level: 96, keystones: ["Chaos Inoculation"] }),
];

const keys = (rows) => rows.map((r) => r.build.key);

test("parseAmount understands k, m and b", () => {
  assert.equal(F.parseAmount("1.5m"), 1500000);
  assert.equal(F.parseAmount("800K"), 800000);
  assert.equal(F.parseAmount(" 6,100 "), 6100);
  assert.equal(F.parseAmount("2b"), 2e9);
  assert.equal(F.parseAmount(".5k"), 500);
  assert.equal(F.parseAmount(""), null);
  assert.equal(F.parseAmount(null), null);
  assert.ok(Number.isNaN(F.parseAmount("lots")));
  assert.ok(Number.isNaN(F.parseAmount("1.5mm")));
});

test("formatAmount", () => {
  assert.equal(F.formatAmount(4210000), "4.21M");
  assert.equal(F.formatAmount(890000), "890k");
  assert.equal(F.formatAmount(6100), "6.1k");
  assert.equal(F.formatAmount(28223731), "28.2M");
  assert.equal(F.formatAmount(512.4), "512");
  assert.equal(F.formatAmount(3e9), "3B");
  assert.equal(F.formatAmount(null), "—");
  assert.equal(F.formatAmount(NaN), "—");
});

test("no filters: everything, newest visit first", () => {
  assert.deepEqual(keys(F.apply(builds, {})), ["a", "b", "c"]);
});

test("patch, class and ascendancy", () => {
  assert.deepEqual(keys(F.apply(builds, { patch: "3.28" })), ["b"]);
  assert.deepEqual(keys(F.apply(builds, { className: "Witch" })), ["c"]);
  assert.deepEqual(keys(F.apply(builds, { className: "Duelist", ascendancy: "Slayer" })), ["a"]);
  assert.deepEqual(keys(F.apply(builds, { className: "Witch", ascendancy: "Slayer" })), []);
});

test("search matches the name (custom or generated), the creator and any gem, ignoring case", () => {
  assert.deepEqual(keys(F.apply(builds, { search: "rf start" })), ["b"]);
  assert.deepEqual(keys(F.apply(builds, { search: "cyclone slayer" })), ["a"], "generated name");
  assert.deepEqual(keys(F.apply(builds, { search: "zIZ" })), ["a"], "creator");
  assert.deepEqual(keys(F.apply(builds, { search: "melee phys" })), ["a"], "support gem");
  assert.deepEqual(keys(F.apply(builds, { search: "   " })), ["a", "b", "c"]);
});

test("creator filter, including builds with no creator", () => {
  assert.deepEqual(keys(F.apply(builds, { creator: "Zizaran" })), ["a"]);
  assert.deepEqual(keys(F.apply(builds, { creator: F.NO_CREATOR })), ["b", "c"]);
});

test("DPS and Life ranges; a build without the stat is left out; bad input is ignored", () => {
  assert.deepEqual(keys(F.apply(builds, { dpsMin: "1m" })), ["a"]);
  assert.deepEqual(keys(F.apply(builds, { dpsMax: "1m" })), ["b"]);
  assert.deepEqual(keys(F.apply(builds, { lifeMin: "6k", lifeMax: "7k" })), ["a"]);
  assert.deepEqual(keys(F.apply(builds, { dpsMin: "abc" })), ["a", "b"], "only builds with a DPS value");
});

test("keystones and uniques: a build must have every chip", () => {
  assert.deepEqual(keys(F.apply(builds, { keystones: ["Chaos Inoculation"] })), ["c"]);
  assert.deepEqual(keys(F.apply(builds, { keystones: ["Resolute Technique"], uniques: ["Mageblood"] })), ["a"]);
  assert.deepEqual(keys(F.apply(builds, { keystones: ["Resolute Technique", "Chaos Inoculation"] })), []);
});

test("sorts; builds missing the value go last in either direction", () => {
  assert.deepEqual(keys(F.apply(builds, { sort: "oldest" })), ["c", "b", "a"]);
  assert.deepEqual(keys(F.apply(builds, { sort: "dps" })), ["a", "b", "c"]);
  assert.deepEqual(keys(F.apply(builds, { sort: "life" })), ["b", "a", "c"]);
  assert.deepEqual(keys(F.apply(builds, { sort: "level" })), ["c", "a", "b"]);
  assert.deepEqual(keys(F.apply(builds, { sort: "name" })), ["a", "b", "c"], "Cyclone Slayer, My RF starter, Winter Orb Occultist");
  assert.deepEqual(keys(F.apply(builds, { sort: "visits" })), ["b", "c", "a"]);
  assert.deepEqual(keys(F.apply(builds, { sort: "nonsense" })), ["a", "b", "c"], "unknown sort: newest");
});

test("filter options: patches newest first with their league, ascendancies per class, creators, keystones, uniques", () => {
  const o = F.filterOptions(builds, leagues);
  assert.deepEqual(o.patches, [{ patch: "3.29", league: "Allflame" }, { patch: "3.28", league: "Mirage" }, { patch: "3.10", league: "Delirium" }]);
  assert.deepEqual(o.classes, ["Duelist", "Templar", "Witch"]);
  assert.deepEqual(o.ascendanciesByClass.Witch, ["Occultist"]);
  assert.deepEqual(o.allAscendancies, ["Inquisitor", "Occultist", "Slayer"]);
  assert.deepEqual(o.creators, ["Zizaran"]);
  assert.deepEqual(o.keystones, ["Chaos Inoculation", "Resolute Technique"]);
  assert.deepEqual(o.uniques, ["Mageblood"]);
});

test("pending and failed builds show only when no filter is set", () => {
  const list = builds.concat([{ key: "p", link: "https://pobb.in/p", label: "pobb.in", status: "pending", lastSeen: 40, visits: 1 }]);
  assert.deepEqual(keys(F.apply(list, {})), ["p", "a", "b", "c"]);
  assert.deepEqual(keys(F.apply(list, { search: "cyclone" })), ["a"]);
  assert.equal(F.displayName(list[3]), "https://pobb.in/p");
});

// ---------- loadouts ----------

const withLoadouts = build("L", { lastSeen: 5 }, {
  className: "Witch", ascendancy: "Occultist", mainSkill: "Fireball", patch: "3.29", dps: 2e6, life: 5000,
  loadouts: [
    { name: "Leveling", active: true, className: "Witch", ascendancy: "Occultist", mainSkill: "Fireball", skills: ["Fireball"], patch: "3.29", keystones: [], uniques: [] },
    { name: "Endgame", active: false, className: "Witch", ascendancy: "Elementalist", mainSkill: "Discipline", skills: ["Discipline"], patch: "3.29", keystones: ["Mind Over Matter"], uniques: [] },
  ],
});

test("a build matches when any loadout does, and shows the first matching one, the saved one first", () => {
  assert.deepEqual(F.apply([withLoadouts], { ascendancy: "Elementalist" }).map((r) => r.view), [1]);
  assert.deepEqual(F.apply([withLoadouts], { search: "fireball" }).map((r) => r.view), [0]);
  assert.deepEqual(F.apply([withLoadouts], {}).map((r) => r.view), [0]);
  assert.deepEqual(F.apply([withLoadouts], { keystones: ["Mind Over Matter"] }).map((r) => r.view), [1]);
  assert.deepEqual(F.apply([withLoadouts], { search: "endgame" }).map((r) => r.view), [1], "the loadout's name is searchable");
});

test("DPS and Life ranges only match the saved loadout, the one with stats", () => {
  assert.deepEqual(F.apply([withLoadouts], { ascendancy: "Elementalist", dpsMin: "1m" }), []);
  assert.deepEqual(F.apply([withLoadouts], { ascendancy: "Occultist", dpsMin: "1m" }).map((r) => r.view), [0]);
});

test("views: loadouts, with 'As saved' first when the saved state is none of them", () => {
  assert.deepEqual(F.viewsOf(withLoadouts).map((v) => [v.name, v.saved]), [["Leveling", true], ["Endgame", false]]);
  const unmatched = build("U", {}, { loadouts: [{ name: "Leveling", active: false }] });
  assert.deepEqual(F.viewsOf(unmatched).map((v) => [v.name, v.saved]), [["As saved", true], ["Leveling", false]]);
  assert.deepEqual(F.viewsOf(build("N", {}, {})).map((v) => v.name), ["As saved"]);
  assert.deepEqual(F.viewsOf({ key: "x" }), []);
});

test("filter options include every loadout's values", () => {
  const o = F.filterOptions([withLoadouts], leagues);
  assert.deepEqual(o.ascendanciesByClass.Witch, ["Elementalist", "Occultist"]);
  assert.deepEqual(o.keystones, ["Mind Over Matter"]);
});
