"use strict";
// Synthetic PoB build XML for unit tests, in the shape Modules/Build.lua buildMode:Save and the tabs' Save functions
// write. Ids come from data/pobdata.js (PoB v2.67.2): tree "3_29", class ids 0-based into the tree's class list.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const attrs = (o) => Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");

/** A gem: { name } is a nameSpec only; pass gemId/variantId/skillId and any other attribute as needed. */
function gem(g) {
  return `<Gem${attrs(Object.assign({ level: 20, quality: 0, enabled: "true" }, typeof g === "string" ? { nameSpec: g } : g))}/>`;
}

/** A socket group: { gems: [...], mainActiveSkill?, enabled?, slot?, source? } */
function group(g) {
  const o = Array.isArray(g) ? { gems: g } : g;
  return `<Skill${attrs({ enabled: o.enabled === undefined ? "true" : o.enabled, mainActiveSkill: o.mainActiveSkill, slot: o.slot, source: o.source })}>` +
    o.gems.map(gem).join("") + `</Skill>`;
}

/**
 * @param o {
 *   build: Build attributes, stats: {name: value}, specs: [{nodes, sockets: [[nodeId, itemId]], title, treeVersion, classId, ascendClassId, secondaryAscendClassId}],
 *   activeSpec, items: [{id, text}], itemSets: [{id, title, slots: [[name, itemId]], useSecondWeaponSet}], activeItemSet,
 *   skillSets: [{id, title, groups}], activeSkillSet, configSets: [{id, title}], activeConfigSet, legacySkills: [groups] }
 */
function pobXml(o) {
  const b = Object.assign({ level: 90, className: "Templar", ascendClassName: "Hierophant", mainSocketGroup: 1, targetVersion: "3_0" }, o.build);
  const stats = Object.entries(o.stats || {}).map(([k, v]) => `<PlayerStat stat="${k}" value="${v}"/>`).join("");
  const specs = (o.specs || [{}]).map((s) => `<Spec${attrs({ title: s.title, treeVersion: s.treeVersion || "3_29", classId: s.classId === undefined ? 5 : s.classId,
    ascendClassId: s.ascendClassId === undefined ? 2 : s.ascendClassId, secondaryAscendClassId: s.secondaryAscendClassId, nodes: (s.nodes || []).join(",") })}>` +
    `<Sockets>${(s.sockets || []).map(([n, id]) => `<Socket nodeId="${n}" itemId="${id}"/>`).join("")}</Sockets></Spec>`).join("");
  const items = (o.items || []).map((it) => `<Item id="${it.id}">\n${esc(it.text)}\n</Item>`).join("");
  const itemSets = (o.itemSets || [{ id: 1, slots: [] }]).map((s) => `<ItemSet${attrs({ id: s.id, title: s.title, useSecondWeaponSet: s.useSecondWeaponSet })}>` +
    s.slots.map(([n, id]) => `<Slot name="${n}" itemId="${id}"/>`).join("") + `</ItemSet>`).join("");
  const skills = o.legacySkills ? o.legacySkills.map(group).join("") :
    (o.skillSets || [{ id: 1, groups: [] }]).map((s) => `<SkillSet${attrs({ id: s.id, title: s.title })}>${(s.groups || []).map(group).join("")}</SkillSet>`).join("");
  const configs = (o.configSets || [{ id: 1 }]).map((c) => `<ConfigSet${attrs({ id: c.id, title: c.title })}></ConfigSet>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
<Build${attrs(b)}>${stats}</Build>
<Tree activeSpec="${o.activeSpec || 1}">${specs}</Tree>
<Items activeItemSet="${o.activeItemSet || 1}">${items}${itemSets}</Items>
<Skills activeSkillSet="${o.activeSkillSet || 1}">${skills}</Skills>
<Config activeConfigSet="${o.activeConfigSet || 1}">${configs}</Config>
</PathOfBuilding>`;
}

/** Item text the way PoB saves it: "Rarity: X", name, base, then mod lines. */
function item(rarity, name, base, lines) {
  return ["Rarity: " + rarity, name, base].concat(lines || []).join("\n");
}

module.exports = { pobXml, item, gem, group };
