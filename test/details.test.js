// The expanded row's stat sections (src/details.js). References: PoB v2.67.2 Modules/BuildDisplayStats.lua (labels,
// formats, over-cap stats, ChaosResist's overCapStatCondFunc, extraSaveStats charges) and Modules/Build.lua
// AddDisplayStatList (a line without a condition shows when its value isn't 0). Values are formatted by src/statfmt.js,
// which test/golden.test.js checks against PoB itself. Exact strings.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { statSections } = require("../src/details.js");
const data = require("../data/pobdata.js");

const rows = (info) => Object.fromEntries(statSections(info, data.statDefs).flatMap((s) => s.rows.map((r) => [r.stat, r.label + ": " + r.value])));

const base = {
  FullDPS: 0, CombinedDPS: 1234567.891, TotalDPS: 1000, AverageHit: 0, Speed: 1.5, PreEffectiveCritChance: 50, CritChance: 50, CritMultiplier: 3.5, HitChance: 100,
  TotalEHP: 50000, PhysicalMaximumHitTaken: 9000, FireMaximumHitTaken: 20000, ColdMaximumHitTaken: 20000, LightningMaximumHitTaken: 20000, ChaosMaximumHitTaken: Infinity,
  Life: 5000, LifeUnreserved: 5000, EnergyShield: 0, Mana: 1000, ManaUnreserved: 200, Ward: 0, LifeRegenRecovery: 0,
  Armour: 0, PhysicalDamageReduction: 0, Evasion: 0, MeleeEvadeChance: 0, EffectiveBlockChance: 0, EffectiveSpellBlockChance: 0, EffectiveSpellSuppressionChance: 100,
  FireResist: 75, FireResistOverCap: 30, ColdResist: 75, ColdResistOverCap: 0, LightningResist: 75, ChaosResist: -60, ChaosResistOverCap: 5,
  Str: 100, Dex: 50, Int: 60, EffectiveMovementSpeedMod: 1.3, FrenzyCharges: 3, FrenzyChargesMax: 3, PowerCharges: 0, PowerChargesMax: 3,
};

test("lines without a condition show only when not 0; the ones asked for always show", () => {
  const r = rows({ stats: base, keystones: [] });
  assert.equal(r.FullDPS, undefined, "0 Full DPS hidden");
  assert.equal(r.CombinedDPS, "Combined DPS: 1,234,567.9");
  assert.equal(r.EnergyShield, undefined);
  assert.equal(r.Ward, undefined);
  for (const k of ["Armour", "PhysicalDamageReduction", "Evasion", "EffectiveBlockChance", "EffectiveSpellBlockChance"]) assert.ok(r[k], k + " always shows");
  assert.equal(r.EffectiveBlockChance, "Block Chance: 0%");
  assert.equal(r.EffectiveSpellSuppressionChance, "Spell Suppression Chance: 100%");
});

test("conditional lines follow PoB's conditions where the saved stats allow", () => {
  const r = rows({ stats: base, keystones: [] });
  assert.equal(r.LifeUnreserved, undefined, "shown only when below Life");
  assert.equal(r.ManaUnreserved, "Unreserved Mana: 200");
  assert.equal(r.CritChance, undefined, "Effective Crit Chance only when it differs");
  assert.equal(r.CritMultiplier, "Crit Multiplier: 350%", "pc: 3.5 -> 350%");
  assert.equal(r.HitChance, undefined, "100% hit chance hidden");
  assert.equal(rows({ stats: Object.assign({}, base, { HitChance: 90 }) }).HitChance, "Hit Chance: 90%");
});

test("max hits list every element; an infinite one reads Immune", () => {
  const r = rows({ stats: base, keystones: [] });
  assert.equal(r.PhysicalMaximumHitTaken, "Phys Max Hit: 9,000");
  assert.equal(r.LightningMaximumHitTaken, "Lightning Max Hit: 20,000", "not PoB's combined 'Elemental Max Hit' label");
  assert.equal(r.ChaosMaximumHitTaken, "Chaos Max Hit: Immune");
});

test("resistances with over-cap; Chaos Inoculation hides chaos over-cap", () => {
  let r = rows({ stats: base, keystones: [] });
  assert.equal(r.FireResist, "Fire Resistance: 75% (+30%)");
  assert.equal(r.ColdResist, "Cold Resistance: 75%", "0 over-cap is not shown");
  assert.equal(r.LightningResist, "Lightning Resistance: 75%", "no over-cap stat saved");
  assert.equal(r.ChaosResist, "Chaos Resistance: -60% (+5%)");
  r = rows({ stats: base, keystones: ["Chaos Inoculation"] });
  assert.equal(r.ChaosResist, "Chaos Resistance: -60%");
});

test("attributes, movement speed (a mod: 1.3 -> +30%) and charges as current / max", () => {
  const r = rows({ stats: base, keystones: [] });
  assert.equal(r.Str, "Strength: 100");
  assert.equal(r.EffectiveMovementSpeedMod, "Movement Speed Modifier: +30%");
  assert.equal(r.FrenzyChargesMax, "Frenzy Charges: 3 / 3");
  assert.equal(r.PowerChargesMax, "Power Charges: 0 / 3");
  assert.equal(r.EnduranceChargesMax, undefined, "not saved: not shown");
});

test("sections in PoB's order; nothing saved gives no sections", () => {
  assert.deepEqual(statSections({ stats: base, keystones: [] }, data.statDefs).map((s) => s.title),
    ["Offence", "Max hit", "Life, Mana, ES", "Defences", "Resistances", "Attributes"]);
  assert.deepEqual(statSections({ stats: {} }, data.statDefs), []);
  assert.deepEqual(statSections(null, data.statDefs), []);
});
