// The expanded row's contents: the build's saved stats laid out like Path of Building's left panel, plus what was read
// from the build (keystones, uniques, skills) and the visit record. Pure, so tests can check it.
// Labels and number formats are PoB's own (Modules/BuildDisplayStats.lua via data/pobdata.js statDefs, formatted by
// src/statfmt.js). Which lines show follows PoB's sidebar rule where the saved stats allow it (Build.lua
// AddDisplayStatList: a line with no condition shows when its value isn't 0); a few lines Wesley asked for always show
// (max hits, resistances, block, spell block, suppression, charges).
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const Fmt = isNode ? require("./statfmt.js") : root.PobStatFmt;

  // [stat, when, label override]. when: "always" | "nonzero" | a function(value, stats) -> boolean.
  const SECTIONS = [
    { title: "Offence", lines: [
      ["FullDPS", "nonzero"], ["CombinedDPS", "nonzero"], ["TotalDPS", "nonzero", "Hit DPS"], ["TotalDotDPS", "nonzero"],
      ["AverageHit", "nonzero"], ["Speed", "nonzero", "Attack/Cast Rate"], ["PreEffectiveCritChance", "nonzero", "Crit Chance"],
      ["CritChance", (v, s) => v !== s.PreEffectiveCritChance && v > 0, "Effective Crit Chance"], ["CritMultiplier", (v, s) => (s.CritChance || 0) > 0],
      ["HitChance", (v) => v < 100],
    ] },
    { title: "Max hit", lines: [
      ["TotalEHP", "nonzero"], ["PhysicalMaximumHitTaken", "always"], ["FireMaximumHitTaken", "always"], ["ColdMaximumHitTaken", "always"],
      // PoB's first line for this stat is "Elemental Max Hit" (shown when all three are equal); each is listed here.
      ["LightningMaximumHitTaken", "always", "Lightning Max Hit"], ["ChaosMaximumHitTaken", "always"],
    ] },
    { title: "Life, Mana, ES", lines: [
      ["Life", "nonzero"], ["LifeUnreserved", (v, s) => v < s.Life], ["EnergyShield", "nonzero"], ["Mana", "nonzero"],
      ["ManaUnreserved", (v, s) => v < s.Mana], ["Ward", "nonzero"],
      ["LifeRegenRecovery", "nonzero", "Life Regen"], ["EnergyShieldRegenRecovery", "nonzero", "ES Regen"],
      ["ManaRegenRecovery", "nonzero", "Mana Regen"], ["TotalNetRegen", "nonzero"],
    ] },
    { title: "Defences", lines: [
      ["Armour", "always"], ["PhysicalDamageReduction", "always"], ["Evasion", "always"], ["MeleeEvadeChance", "nonzero", "Evade Chance"],
      ["EffectiveBlockChance", "always"], ["EffectiveSpellBlockChance", "always"], ["EffectiveSpellSuppressionChance", "always"],
    ] },
    { title: "Resistances", lines: [
      ["FireResist", "always"], ["ColdResist", "always"], ["LightningResist", "always"], ["ChaosResist", "always"],
    ] },
    { title: "Attributes", lines: [
      ["Str", "always"], ["Dex", "always"], ["Int", "always"], ["EffectiveMovementSpeedMod", "always"],
    ] },
  ];
  const CHARGES = [["Frenzy", "FrenzyCharges", "FrenzyChargesMax"], ["Power", "PowerCharges", "PowerChargesMax"], ["Endurance", "EnduranceCharges", "EnduranceChargesMax"]];

  /**
   * @param info the build's saved state (readBuild result) — only it has stats.
   * @param statDefs data/pobdata.js statDefs
   * @returns {{title, rows: {label, value, stat}[]}[]} sections with at least one line.
   */
  function statSections(info, statDefs) {
    const s = (info && info.stats) || {};
    const ci = (info && info.keystones || []).indexOf("Chaos Inoculation") !== -1;
    const out = [];
    for (const sec of SECTIONS) {
      const rows = [];
      for (const [stat, when, label] of sec.lines) {
        const v = s[stat], def = statDefs[stat];
        if (v === undefined || !def) continue;
        const show = when === "always" ? true : when === "nonzero" ? v !== 0 : when(v, s);
        if (!show) continue;
        // ChaosResist's over-cap isn't shown with Chaos Inoculation (BuildDisplayStats overCapStatCondFunc).
        const overCap = def.oc && !(stat === "ChaosResist" && ci) ? s[def.oc] : undefined;
        const value = v === Infinity && /MaximumHitTaken$/.test(stat) ? "Immune" : Fmt.formatStat(v, def, overCap);
        rows.push({ stat: stat, label: label || def.l, value: value });
      }
      if (sec.title === "Attributes") {
        // Charges: current (as configured in the build) / maximum, from BuildDisplayStats extraSaveStats.
        for (const [name, cur, max] of CHARGES) {
          if (s[max] === undefined) continue;
          rows.push({ stat: max, label: name + " Charges", value: Fmt.luaFormat("d", s[cur] || 0) + " / " + Fmt.luaFormat("d", s[max]) });
        }
      }
      if (rows.length) out.push({ title: sec.title, rows: rows });
    }
    return out;
  }

  const api = { statSections, SECTIONS };
  if (isNode) module.exports = api;
  else root.PobDetails = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
