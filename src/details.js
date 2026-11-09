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
    // Short labels where PoB's don't fit three columns (Wesley, Nov 8, 2026): the section title already says
    // "Resistances", and "Movement Speed Modifier" loses only "Modifier".
    { title: "Resistances", lines: [
      ["FireResist", "always", "Fire"], ["ColdResist", "always", "Cold"], ["LightningResist", "always", "Lightning"], ["ChaosResist", "always", "Chaos"],
    ] },
    { title: "Attributes", lines: [
      ["Str", "always"], ["Dex", "always"], ["Int", "always"], ["EffectiveMovementSpeedMod", "always", "Movement Speed"],
    ] },
  ];
  const CHARGES = [["Frenzy", "FrenzyCharges", "FrenzyChargesMax"], ["Power", "PowerCharges", "PowerChargesMax"], ["Endurance", "EnduranceCharges", "EnduranceChargesMax"]];

  /**
   * A shorter form of a formatted plain number of 1,000 or more, for a value too long for its column (Wesley,
   * Nov 8, 2026): 28,223,731.1 -> "28.2M", "148,872" -> "149k", "+1,234.5" -> "+1.23k", 3e9 -> "3B". Three significant
   * digits at most, like the row's DPS and Life (src/filter.js formatAmount). Anything else (percentages, over-caps,
   * "12 / 12", "Immune", numbers under 1,000) has no short form: null.
   */
  function shortValue(text) {
    const m = /^([+-]?)([\d,]+(?:\.\d+)?)$/.exec(text);
    if (!m) return null;
    const n = Number(m[2].replace(/,/g, ""));
    if (!(n >= 1000)) return null;
    const fmt = (v, suffix) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + suffix;
    // Rounding can carry into the next unit (999,950 -> 1000k): step up instead.
    const scaled = n >= 1e9 ? fmt(n / 1e9, "B") : n >= 1e6 ? fmt(n / 1e6, "M") : fmt(n / 1e3, "k");
    const carried = { "1000k": "1M", "1000M": "1B" }[scaled] || scaled;
    return m[1] + carried;
  }

  /**
   * @param info the build's saved state (readBuild result) — only it has stats.
   * @param statDefs data/pobdata.js statDefs
   * @returns {{title, rows: {label, value, short, stat}[]}[]} sections with at least one line; short is the value's
   * shorter form (shortValue) or null.
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
        rows.push({ stat: stat, label: label || def.l, value: value, short: shortValue(value) });
      }
      if (sec.title === "Attributes") {
        // Charges: current (as configured in the build) / maximum, from BuildDisplayStats extraSaveStats.
        for (const [name, cur, max] of CHARGES) {
          if (s[max] === undefined) continue;
          rows.push({ stat: max, label: name + " Charges", value: Fmt.luaFormat("d", s[cur] || 0) + " / " + Fmt.luaFormat("d", s[max]), short: null });
        }
      }
      if (rows.length) out.push({ title: sec.title, rows: rows });
    }
    return out;
  }

  const api = { statSections, shortValue, SECTIONS };
  if (isNode) module.exports = api;
  else root.PobDetails = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
