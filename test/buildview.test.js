// What the popup row and the page box show and edit for one build (src/buildview.js), on hand-made records. Reference:
// the plan's popup rules (PoE-Sim-Notes pob-manager/PoB Manager Plan.md, "The popup" and "The page box"): saved stats
// are the build's stats whatever the default loadout; the editor edits name, creator, the main skill of the loadout on
// show and the default loadout. Tolerance: exact.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/buildview.js");
const F = require("../src/filter.js");

function info(o) {
  return Object.assign({ className: "Duelist", ascendancy: "Slayer", level: 90, mainSkill: "Cyclone", activeSkills: ["Cyclone", "Blood Rage"],
    patch: "3.29", keystones: [], uniques: [], dps: 4.2e6, dpsStat: "CombinedDPS", life: 6100, es: 0, loadouts: [] }, o);
}
function build(o, i) {
  return Object.assign({ key: "pobbin:x", link: "https://pobb.in/x", label: "pobb.in", status: "ok", visits: 1, info: info(i) }, o);
}
const loadout = (name, active, o) => Object.assign({ name: name, active: active, className: "Duelist", ascendancy: "Slayer",
  mainSkill: "Cyclone", activeSkills: ["Cyclone", "Blood Rage"], patch: "3.29" }, o);
const view = (b) => F.viewsOf(b)[F.defaultViewIndex(b)];
const texts = (parts) => parts.map((p) => p.text);

test("summaryParts: class and level, main skill, patch; the stats are on their own line (statParts)", () => {
  const b = build({}, { es: 8070 });
  assert.deepEqual(V.summaryParts(b, view(b)), [
    { text: "Slayer · Lv 90" },
    { text: "· Cyclone", title: "PoB's main skill", kind: "skill" },
    { text: "3.29", title: "Patch from the passive tree: 3.29", kind: "tag" },
  ]);
});

// Wesley, Nov 10, 2026: the row's third line holds the saved DPS and EHP (PoB's saved TotalEHP PlayerStat) only; Life
// and ES are not shown on the row.
test("statParts: the saved DPS and EHP only, not Life or ES", () => {
  const b = build({}, { es: 8070, stats: { TotalEHP: 91234 } });
  assert.deepEqual(V.statParts(b), [
    { text: "4.2M DPS", title: "As exported: CombinedDPS", kind: "dps" },
    { text: "· 91.2k EHP", title: "Effective hit pool, as exported (TotalEHP)" },
  ]);
});

test("statParts: missing stats show —; nothing for a build not read", () => {
  assert.deepEqual(texts(V.statParts(build({}, { dps: null, life: null }))), ["— DPS", "· — EHP"], "no stats saved");
  assert.equal(V.statParts(build({ status: "pending", info: undefined })), null);
  assert.equal(V.statParts(build({ status: "error" })), null);
  assert.equal(V.statParts(null), null);
});

test("summaryParts: tags for Ruthless and alternate trees, a hand-set skill marked manual", () => {
  const b = build({ mainSkills: { "As saved": "Blood Rage" } }, { ruthless: true, alternate: true, es: 0.5 });
  const parts = V.summaryParts(b, view(b));
  assert.deepEqual(texts(parts), ["Slayer · Lv 90", "· Blood Rage", "Ruthless", "Alternate", "3.29"]);
  assert.deepEqual(parts[1], { text: "· Blood Rage", title: "Main skill set by you · PoB's main skill: Cyclone", kind: "manual" });
});

test("summaryParts and statParts: the saved stats whatever loadout is the default, naming the saved loadout", () => {
  const b = build({ defaultView: "Endgame" }, { loadouts: [loadout("Leveling", true), loadout("Endgame", false, { mainSkill: "Blood Rage" })] });
  const parts = V.summaryParts(b, view(b));
  assert.equal(view(b).name, "Endgame");
  assert.deepEqual(texts(parts), ["Slayer · Lv 90", "· Blood Rage", "3.29"]);
  assert.deepEqual(texts(V.statParts(b)), ["4.2M DPS", "· — EHP"]);
  assert.equal(V.statParts(b)[0].title, "As exported: CombinedDPS (loadout Leveling)");
});

test("summaryParts: nothing for a build not read yet or that failed", () => {
  assert.equal(V.summaryParts(build({ status: "pending", info: undefined }), undefined), null);
  const failed = build({ status: "error", error: "x" });
  assert.equal(V.summaryParts(failed, view(failed)), null);
  assert.equal(V.summaryParts(null, null), null);
});

test("mainSkillNote explains each source", () => {
  assert.equal(V.mainSkillNote({ source: "pob" }), "PoB's main skill");
  assert.equal(V.mainSkillNote({ source: "manual", pob: "Ambush" }), "Main skill set by you · PoB's main skill: Ambush");
  assert.equal(V.mainSkillNote({ source: "manual" }), "Main skill set by you");
  assert.equal(V.mainSkillNote({ source: "auto", pob: "Ambush" }), "PoB's main skill is Ambush (a utility skill); this is the damage skill with the most supports");
  assert.equal(V.mainSkillNote({ source: "auto" }), "PoB's main skill is none (a utility skill); this is the damage skill with the most supports");
});

test("savedFrom names the saved loadout only when there are several", () => {
  assert.equal(V.savedFrom([{ name: "As saved", saved: true }]), "");
  assert.equal(V.savedFrom([{ name: "A", saved: false }, { name: "B", saved: true }]), " (loadout B)");
  assert.equal(V.savedFrom([{ name: "A", saved: false }, { name: "B", saved: false }]), "");
});

test("editorModel: one loadout gives name, creator and main skill, no default loadout", () => {
  const b = build({ creator: "Zizaran" }, { autoMainSkill: "Cyclone" });
  assert.deepEqual(V.editorModel(b, 0), {
    name: { value: "", placeholder: F.displayName(b) },
    creator: { value: "Zizaran", placeholder: "Who made the build (optional)" },
    mainSkill: { view: "As saved", value: "", options: [["", "Automatic (Cyclone)"], ["Cyclone", "Cyclone"], ["Blood Rage", "Blood Rage"]] },
    defaultView: null,
  });
});

test("editorModel: the custom name shows in the field, the generated one as the placeholder", () => {
  const b = build({ customName: "My Slayer" });
  const m = V.editorModel(b, 0);
  assert.equal(m.name.value, "My Slayer");
  assert.equal(m.name.placeholder, F.displayName(Object.assign({}, b, { customName: "" })));
  assert.notEqual(m.name.placeholder, "My Slayer");
});

test("editorModel: several loadouts add the default loadout choice and edit the main skill of the loadout on show", () => {
  const b = build({ defaultView: "Endgame", mainSkills: { Endgame: "Blood Rage" } },
    { loadouts: [loadout("Leveling", true), loadout("Endgame", false)] });
  const m = V.editorModel(b, F.defaultViewIndex(b));
  assert.deepEqual(m.mainSkill.view, "Endgame");
  assert.equal(m.mainSkill.value, "Blood Rage");
  assert.deepEqual(m.defaultView, { value: "Endgame", options: [["", "As PoB saved it"], ["Leveling", "Leveling (saved)"], ["Endgame", "Endgame"]] });
});

test("editorModel: a default loadout that no longer exists shows as the saved one", () => {
  const b = build({ defaultView: "Gone" }, { loadouts: [loadout("Leveling", true), loadout("Endgame", false)] });
  assert.equal(V.editorModel(b, 0).defaultView.value, "");
});

test("editorModel: a build not read yet edits only the name and creator", () => {
  const m = V.editorModel({ key: "k", link: "https://pobb.in/x", status: "pending" }, 0);
  assert.deepEqual(m, { name: { value: "", placeholder: "Name" }, creator: { value: "", placeholder: "Who made the build (optional)" }, mainSkill: null, defaultView: null });
});

test("editChanges sends what the inputs hold, and only the fields the model offers", () => {
  const one = V.editorModel(build({}), 0);
  assert.deepEqual(V.editChanges(one, { name: "New", creator: "Me", mainSkill: "Blood Rage", defaultView: "ignored" }),
    { customName: "New", creator: "Me", mainSkill: { view: "As saved", skill: "Blood Rage" } });
  const many = V.editorModel(build({}, { loadouts: [loadout("A", true), loadout("B", false)] }), 1);
  assert.deepEqual(V.editChanges(many, { name: "", creator: "", mainSkill: "", defaultView: "B" }),
    { customName: "", creator: "", mainSkill: { view: "B", skill: "" }, defaultView: "B" });
  const bare = V.editorModel({ key: "k", link: "l", status: "error" }, 0);
  assert.deepEqual(V.editChanges(bare, { name: undefined, creator: null }), { customName: "", creator: "" });
});
