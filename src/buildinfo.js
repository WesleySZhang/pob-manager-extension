// Reads the fields the popup shows and filters on from a Path of Building build XML. Every rule follows PoB v2.67.2
// (b32759a); the PoB data it needs is data/pobdata.js (tools/gen_pobdata.lua). tools/accuracy.js checks the result
// against headless PoB loading the same builds.
(function (root) {
  "use strict";

  const X = (typeof module !== "undefined" && module.exports) ? require("./xml.js") : root.PobXml;

  // gemsByGameId[gameId][variantId] and gemForSkill[grantedEffectId], as Modules/Data.lua setupGem builds them.
  const indexCache = new WeakMap();
  function indexes(data) {
    let ix = indexCache.get(data);
    if (ix) return ix;
    ix = { byGameId: {}, bySkill: {}, byName: {} };
    for (const id of Object.keys(data.gems)) {
      const g = data.gems[id];
      (ix.byGameId[g.g] = ix.byGameId[g.g] || {})[g.v] = id;
      if (!(g.s in ix.bySkill)) ix.bySkill[g.s] = id;
      const lower = g.n.toLowerCase();
      ix.byName[lower] = lower in ix.byName ? null : id; // null = ambiguous (SkillsTab.lua FindSkillGem)
    }
    // Item lines that are a keystone, lower-cased -> name (ModParser.lua specialModList from data.keystones).
    ix.itemKeystones = {};
    for (const k of data.itemKeystones) ix.itemKeystones[k.toLowerCase()] = k;
    ix.keystoneMaps = {};
    for (const v of Object.keys(data.trees)) ix.keystoneMaps[v] = new Set(data.trees[v].keystoneMapNames);
    indexCache.set(data, ix);
    return ix;
  }

  /**
   * Which gem or granted skill a <Gem> element is, following SkillsTab.lua LoadSkill then ProcessSocketGroup:
   * 1. gemId (+ variantId, or the variant whose granted effect is skillId);
   * 2. else skillId: the gem granting that skill, or the bare skill (skills granted by items);
   * 3. else nameSpec, an exact case-insensitive gem name. PoB also tries abbreviations here, for builds older than
   *    PoB 1.4.20; those are not reproduced and resolve to nothing.
   * A gem whose main granted effect is unsupported resolves to nothing (ProcessSocketGroup).
   * @returns {{name, effects: string[]}|null} effects = skill ids in grantedEffectList order.
   */
  function resolveGem(attrs, data, ix) {
    let gemId;
    if (attrs.gemId) {
      const variants = ix.byGameId[attrs.gemId];
      if (variants) {
        if (attrs.variantId) gemId = variants[attrs.variantId];
        else if (attrs.skillId) gemId = Object.values(variants).find((id) => data.gems[id].s === attrs.skillId);
      }
    } else if (attrs.skillId) {
      if (data.skills[attrs.skillId]) {
        gemId = ix.bySkill[attrs.skillId];
        if (!gemId) {
          const s = data.skills[attrs.skillId];
          return s.uns ? null : { name: s.n, effects: [attrs.skillId] };
        }
      }
    }
    if (!gemId && attrs.nameSpec && /\S/.test(attrs.nameSpec)) gemId = ix.byName[attrs.nameSpec.trim().toLowerCase()] || undefined;
    if (!gemId) return null;
    const gem = data.gems[gemId];
    const main = data.skills[gem.s];
    if (!main || main.uns) return null;
    return { name: gem.n, effects: gem.e };
  }

  /**
   * The skills a socket group makes, in order: Modules/CalcSetup.lua "Create active skills". For each enabled gem,
   * each granted effect that is not a support, not unsupported, and (if it has a global effect) has its
   * enableGlobal<index> toggle on. enableGlobal1 defaults to on, enableGlobal2 to off (SkillsTab.lua LoadSkill).
   */
  function groupSkills(group, data, ix) {
    return groupSkillIds(group, data, ix).map((id) => data.skills[id].n);
  }

  /** groupSkills as skill ids. */
  function groupSkillIds(group, data, ix) {
    const out = [];
    for (const gemEl of X.children(group, "Gem")) {
      const a = gemEl.attrs;
      if (a.enabled !== undefined && a.enabled !== "true") continue;
      const gem = resolveGem(a, data, ix);
      if (!gem) continue;
      gem.effects.forEach(function (skillId, i) {
        const s = data.skills[skillId];
        if (!s || s.sup || s.uns) return;
        const toggle = a["enableGlobal" + (i + 1)];
        const on = i === 0 ? toggle === undefined || toggle === "true" : toggle === "true";
        if (s.glob && !on) return;
        out.push(skillId);
      });
    }
    return out;
  }

  /** Enabled support gems in a group (resolved gems whose main effect is a support). */
  function supportCount(group, data, ix) {
    let n = 0;
    for (const gemEl of X.children(group, "Gem")) {
      const a = gemEl.attrs;
      if (a.enabled !== undefined && a.enabled !== "true") continue;
      const gem = resolveGem(a, data, ix);
      const main = gem && data.skills[gem.effects[0]];
      if (main && main.sup) n++;
    }
    return n;
  }

  /**
   * Whether a skill is one a build is "about": it deals damage (Attack, Damage, DamageOverTime) or makes minions, and
   * is not a movement, herald, guard or banner skill. Auras, buffs, curses and marks count when they deal damage
   * themselves (Smite, Righteous Fire, Bane), so only their damage types matter. Types are PoB's (Data/Global.lua
   * SkillType, per skill in Data/Skills).
   * Our own rule, not PoB's: PoB's main skill is whichever group the author left selected.
   */
  function isDamageSkill(skillId, data) {
    const s = data.skills[skillId];
    if (!s || s.sup) return false;
    const t = new Set(s.t || []);
    const deals = t.has("Attack") || t.has("Damage") || t.has("DamageOverTime") || t.has("Minion") || t.has("CreatesMinion");
    const utility = t.has("Travel") || t.has("Blink") || t.has("Herald") || t.has("Guard") || t.has("Banner");
    return deals && !utility;
  }

  /**
   * Our pick of the main skill: PoB's main skill when it is a damage skill, or when the gem granting it also grants a
   * damage skill (Frozen Legion's statues attack with Frozen Sweep: the build is still "Frozen Legion"); otherwise the
   * damage skill whose group has the most enabled support gems (the earlier group on a tie, the first such skill in the
   * group); otherwise PoB's.
   */
  function autoMainSkill(groups, pobMainId, mainGroup, data, ix) {
    if (pobMainId && isDamageSkill(pobMainId, data)) return data.skills[pobMainId].n;
    if (pobMainId && mainGroup) {
      for (const gemEl of X.children(mainGroup, "Gem")) {
        const gem = resolveGem(gemEl.attrs, data, ix);
        if (gem && gem.effects.indexOf(pobMainId) !== -1 && gem.effects.some((id) => isDamageSkill(id, data))) return data.skills[pobMainId].n;
      }
    }
    let best = null, bestScore = -1;
    for (const g of groups) {
      if (g.attrs.enabled !== undefined && g.attrs.enabled !== "true") continue;
      const id = groupSkillIds(g, data, ix).find((x) => isDamageSkill(x, data));
      if (!id) continue;
      const score = supportCount(g, data, ix);
      if (score > bestScore) { best = id; bestScore = score; }
    }
    if (best) return data.skills[best].n;
    return pobMainId ? data.skills[pobMainId].n : null;
  }

  /** Every gem and skill name in a set of socket groups, for search. */
  function allGemNames(groups, data, ix) {
    const names = new Set();
    for (const group of groups) {
      for (const gemEl of X.children(group, "Gem")) {
        const gem = resolveGem(gemEl.attrs, data, ix);
        if (gem) {
          names.add(gem.name);
          for (const id of gem.effects) if (data.skills[id]) names.add(data.skills[id].n);
        } else if (gemEl.attrs.nameSpec && /\S/.test(gemEl.attrs.nameSpec)) {
          names.add(gemEl.attrs.nameSpec.trim());
        }
      }
    }
    return Array.from(names);
  }

  // Item text: PoB's own format starts "Rarity: <R>" then the name. Unique and relic (foil) items count as uniques.
  function itemRarityAndName(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => /^Rarity:/i.test(l));
    if (at === -1) return null;
    return { rarity: lines[at].replace(/^Rarity:\s*/i, "").toUpperCase(), name: lines[at + 1] || "", lines: lines };
  }

  // Lines of an item that apply: PoB item text tags lines with "{variant:1,2}"; with "Selected Variant: N" only the
  // lines for that variant are on (Classes/Item.lua ParseRaw). Other "{...}" tags are stripped.
  function activeItemLines(lines) {
    const sel = lines.map((l) => /^Selected Variant:\s*(\d+)/i.exec(l)).find(Boolean);
    const selected = sel ? sel[1] : null;
    const out = [];
    for (let line of lines) {
      let skip = false;
      line = line.replace(/^(\{[^}]*\})+/, function (tags) {
        const v = /\{variant:([\d,]+)\}/i.exec(tags);
        if (v && selected && v[1].split(",").indexOf(selected) === -1) skip = true;
        return "";
      });
      if (!skip) out.push(line.trim());
    }
    return out;
  }

  /**
   * Items worn in an item set (ItemSet slots, or bare Slot elements in old builds), as Modules/CalcSetup.lua uses them:
   * - weapon swap: the "Swap" slots are used instead of the main weapon slots when useSecondWeaponSet is true;
   * - Graft 1/2 only count on a 3.27 tree;
   * - Ring 3 only counts when an allocated node grants "+1 Ring Slot" (The Unseen Hand; ringSlotNodes in the data).
   * @param opts {treeVersion, allocated: Set, tree}
   */
  function equippedItemIds(itemSet, itemsEl, opts) {
    if (!itemSet || !itemSet.el) return [];
    const o = opts || {};
    const slots = X.children(itemSet.el, "Slot");
    // An <ItemSet> carries its own flag; in old builds the bare slots sit in <Items>, which carries it.
    const useSecond = (itemSet.el === itemsEl ? itemsEl : itemSet.el).attrs.useSecondWeaponSet === "true";
    const extraRing = !!(o.tree && o.allocated && o.tree.ringSlotNodes.some((id) => o.allocated.has(id)));
    const ids = [];
    for (const s of slots) {
      const name = s.attrs.name || "";
      const isWeapon = /^Weapon [12]/.test(name);
      if (isWeapon && /Swap/.test(name) !== useSecond) continue;
      if (/^Graft [12]$/.test(name) && !/3_27/.test(o.treeVersion || "")) continue;
      if (name === "Ring 3" && !extraRing) continue;
      if (s.attrs.itemId && s.attrs.itemId !== "0") ids.push(s.attrs.itemId);
    }
    return ids;
  }

  // Timeless jewels: Modules/ModParser.lua "Legion modifiers" (the eight "... (%d+) ... (.+)" lines) and its
  // conquerorList (ModParser.lua:41). Abyss conquerors (type abyss_*) don't replace keystones (PassiveSpec.lua only
  // conquers radius nodes for jewel types below 7), so they are left out.
  const CONQUEST_LINES = [
    /^bathed in the blood of (\d+) sacrificed in the name of (.+)$/,
    /^carved to glorify (\d+) new faithful converted by high templar (.+)$/,
    /^commanded leadership over (\d+) warriors under (.+)$/,
    /^commissioned (\d+) coins to commemorate (.+)$/,
    /^denoted service of (\d+) dekhara in the akhara of (.+)$/,
    /^remembrancing (\d+) songworthy deeds by the line of (.+)$/,
  ];
  const CONQUERORS = {
    xibaqua: ["vaal", "1"], zerphi: ["vaal", "2"], doryani: ["vaal", "3"], ahuana: ["vaal", "2_v2"],
    deshret: ["maraketh", "1"], asenath: ["maraketh", "2"], nasima: ["maraketh", "3"], balbala: ["maraketh", "1_v2"],
    cadiro: ["eternal", "1"], victario: ["eternal", "2"], chitus: ["eternal", "3"], caspiro: ["eternal", "3_v2"],
    kaom: ["karui", "1"], rakiata: ["karui", "2"], kiloava: ["karui", "3"], akoya: ["karui", "3_v2"],
    venarius: ["templar", "1"], dominus: ["templar", "2"], avarius: ["templar", "3"], maxarius: ["templar", "1_v2"],
    vorana: ["kalguur", "1"], uhtred: ["kalguur", "2"], medved: ["kalguur", "3"],
  };

  /** The conqueror and radius index of a jewel's text, or null. Radius: Classes/Item.lua ParseRaw "Radius" line. */
  function timelessConquest(lines, tree) {
    let conqueror = null, radius = null;
    for (const line of lines) {
      const r = /^Radius:\s*([A-Za-z ]+)/.exec(line);
      if (r) radius = tree.radii[r[1].trim()];
      const lower = line.toLowerCase();
      for (const re of CONQUEST_LINES) {
        const m = re.exec(lower);
        if (m && CONQUERORS[m[2].trim()]) conqueror = CONQUERORS[m[2].trim()];
      }
    }
    return conqueror && radius ? { type: conqueror[0], id: conqueror[1], radius: String(radius) } : null;
  }

  // Cluster jewel size from its base: Data/ClusterJewels.lua sizeIndex (Small 0, Medium 1, Large 2).
  const CLUSTER_SIZE = { "small cluster jewel": 0, "medium cluster jewel": 1, "large cluster jewel": 2 };

  /**
   * The id of a cluster jewel's entrance node (where a keystone cluster puts its keystone), as PassiveSpec.lua
   * BuildSubgraph numbers it: 0x10000, plus (index << 6) for the large socket the chain starts at, plus (index << 9)
   * for a medium socket on the way, plus (jewel sizeIndex << 4). Null when the socket isn't a cluster socket or the
   * chain doesn't start at a large socket (PoB only builds sub-trees from large sockets).
   */
  function clusterNodeId(socketId, lines, tree) {
    if (!tree || !tree.clusterSockets[socketId]) return null;
    const base = lines.map((l) => CLUSTER_SIZE[l.toLowerCase()]).find((v) => v !== undefined);
    if (base === undefined) return null;
    let id = 0x10000, at = socketId, guard = 0;
    for (;;) {
      const sock = tree.clusterSockets[at];
      if (!sock || guard++ > 4) return null;
      const [size, index, parent] = sock;
      if (size === 2) { id += index << 6; break; }
      if (size === 1) id += index << 9;
      if (!parent) return null;
      at = parent;
    }
    return String(id + (base << 4));
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  /**
   * "3.29" for tree "3_29_ruthless". Taken from the version name, not PoB's numeric `num`, because num can't tell
   * 3.1 from 3.10 (GameVersions.lua: "3_10" has num 3.10 = 3.1).
   */
  function patchOf(treeVersion) {
    const m = /^(\d+)_(\d+)/.exec(treeVersion || "");
    return m ? m[1] + "." + m[2] : null;
  }

  /** Orders patch strings newest first: "3.29" before "3.10" before "3.9". */
  function comparePatchDesc(a, b) {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    return pb[0] - pa[0] || pb[1] - pa[1];
  }

  /**
   * The sets of one kind, in file order: [{id, title, el}]. Old builds with no sets (bare <Skill>, <Slot> or <Input>
   * children) have one implicit set, as SkillsTab/ItemsTab/ConfigTab Load create.
   */
  function setsOf(parent, tag) {
    if (!parent) return [{ id: "1", title: "Default", el: null }];
    const sets = X.children(parent, tag);
    if (sets.length === 0) return [{ id: "1", title: "Default", el: parent }];
    return sets.map((s) => ({ id: s.attrs.id, title: s.attrs.title || "Default", el: s }));
  }

  function activeIndex(sets, wantId) {
    const i = sets.findIndex((s) => s.id === (wantId || "1"));
    return i === -1 ? 0 : i;
  }

  const LINK = /\{([A-Za-z0-9,]+)\}/;
  function stripLink(title, link) {
    const name = title.replace("{" + link + "}", "").trim();
    return name || "Default";
  }

  /**
   * PoB's loadouts (Modules/Build.lua buildMode:SyncLoadouts, and the buildLoadouts drop-down handler for which sets a
   * loadout selects). A loadout is either
   *  - a tree spec with no {…} link, named like its spec ("[3.25] " in front when the spec's tree isn't the latest),
   *    when an item, skill and config set have exactly that title; or
   *  - one link id of a spec titled "Name {1,2}": "Name {1}", when an item, skill and config set carry that id.
   * A kind with only one set always matches, and that set is used.
   * @returns {{name, spec, item, skill, config}[]} indexes into the spec and set lists.
   */
  function loadoutsOf(specs, itemSets, skillSets, configSets, data) {
    const kinds = [itemSets, skillSets, configSets];
    const links = kinds.map((sets) => {
      const byLink = {};
      sets.forEach((s, i) => {
        const m = LINK.exec(s.title);
        if (m) for (const id of m[1].split(",").filter(Boolean)) byLink[id] = i; // the last set with an id wins
      });
      return byLink;
    });
    const specLinks = {};
    specs.forEach((s, i) => {
      const m = LINK.exec(s.title);
      if (m) for (const id of m[1].split(",").filter(Boolean)) specLinks[id] = i;
    });
    const out = [];
    // Exact-name loadouts first, then linked ones, as SyncLoadouts lists them.
    specs.forEach((s, i) => {
      if (LINK.test(s.title)) return;
      const prefix = s.treeVersion && s.treeVersion !== data.latestTree && data.trees[s.treeVersion] ? "[" + data.trees[s.treeVersion].display + "] " : "";
      const name = prefix + s.title;
      // Only titles without a link take part in exact matching (identifyLinks puts linked titles aside).
      const pick = kinds.map((sets) => (sets.length === 1 ? 0 : sets.findIndex((x) => !LINK.test(x.title) && x.title === name)));
      if (pick.every((p) => p !== -1)) out.push({ name: name, spec: specs.findIndex((x) => x.display === name), item: pick[0], skill: pick[1], config: pick[2] });
    });
    specs.forEach((s) => {
      const m = LINK.exec(s.title);
      if (!m) return;
      for (const id of m[1].split(",").filter(Boolean)) {
        const pick = kinds.map((sets, k) => {
          if (sets.length === 1) return 0;
          const name = stripLink(s.title, m[1]) + " {" + id + "}";
          // The handler's findSetId returns the first set if its title is exactly the loadout name, else the link.
          if (sets[0].title === name) return 0;
          return id in links[k] ? links[k][id] : -1;
        });
        if (pick.every((p) => p !== -1)) out.push({ name: stripLink(s.title, m[1]) + " {" + id + "}", spec: specLinks[id], item: pick[0], skill: pick[1], config: pick[2] });
      }
    });
    return out;
  }

  /** Class and ascendancy of a spec from its ids (classId 0-based, ascendClassId 1-based into the tree's lists). */
  function specClass(spec, tree) {
    if (!tree || !spec) return { className: null, ascendancy: null };
    const c = tree.classes[parseInt(spec.attrs.classId, 10)];
    const a = parseInt(spec.attrs.ascendClassId, 10);
    return { className: c ? c.name : null, ascendancy: c && a > 0 ? c.ascendancies[a - 1] || null : null };
  }

  /**
   * @returns {object} the stored fields: the build as saved (its active spec, item set and skill set) plus
   * `loadouts`, each with the same per-loadout fields. Stats exist only for the saved state. Throws if the XML is
   * not a PoB build.
   */
  function readBuild(xml, data) {
    const ix = indexes(data);
    const doc = X.parse(xml);
    if (doc.name !== "PathOfBuilding") throw new Error("Not a Path of Building build");
    const build = X.child(doc, "Build");
    if (!build) throw new Error("Build has no <Build> element");
    const b = build.attrs;

    // Stats PoB saved (Modules/Build.lua buildMode:Save: <PlayerStat stat value> in <Build>).
    const stats = {};
    for (const s of X.children(build, "PlayerStat")) {
      const v = num(s.attrs.value);
      if (s.attrs.stat && v !== undefined) stats[s.attrs.stat] = v;
    }
    // DPS: FullDPS when PoB computed a non-zero one, else CombinedDPS, else TotalDPS.
    let dps, dpsStat;
    for (const k of ["FullDPS", "CombinedDPS", "TotalDPS"]) {
      if (stats[k] !== undefined && (k !== "FullDPS" || stats[k] > 0)) { dps = stats[k]; dpsStat = k; break; }
    }

    const treeEl = X.child(doc, "Tree");
    const specs = X.children(treeEl, "Spec").map((el) => ({ el: el, title: el.attrs.title || "Default", treeVersion: el.attrs.treeVersion || null }));
    for (const s of specs) {
      const prefix = s.treeVersion && s.treeVersion !== data.latestTree && data.trees[s.treeVersion] ? "[" + data.trees[s.treeVersion].display + "] " : "";
      s.display = prefix + s.title; // TreeTab.lua GetSpecList
    }
    const itemsEl = X.child(doc, "Items");
    const skillsEl = X.child(doc, "Skills");
    const configEl = X.child(doc, "Config");
    const itemSets = setsOf(itemsEl, "ItemSet");
    const skillSets = setsOf(skillsEl, "SkillSet");
    const configSets = setsOf(configEl, "ConfigSet");
    const itemText = {};
    for (const it of X.children(itemsEl, "Item")) if (it.attrs.id) itemText[it.attrs.id] = it.text;
    // Build.lua Load: mainSkillIndex, else mainSocketGroup, else 1.
    const mainIndex = parseInt(b.mainSkillIndex, 10) || parseInt(b.mainSocketGroup, 10) || 1;

    const active = {
      spec: Math.max(0, Math.min(specs.length - 1, (parseInt(treeEl && treeEl.attrs.activeSpec, 10) || 1) - 1)),
      item: activeIndex(itemSets, itemsEl && itemsEl.attrs.activeItemSet),
      skill: activeIndex(skillSets, skillsEl && skillsEl.attrs.activeSkillSet),
      config: activeIndex(configSets, configEl && configEl.attrs.activeConfigSet),
    };
    // Class and ascendancy come from the tree spec (PassiveSpec classId / ascendClassId, which PoB shows as
    // build.spec.curClassName); the <Build> attributes are only a fallback for a spec without ids.
    function classOf(specRec, treeVersion) {
      const c = specClass(specRec && specRec.el, data.trees[treeVersion]);
      if (c.className) return c;
      return { className: b.className || null, ascendancy: b.ascendClassName && b.ascendClassName !== "None" ? b.ascendClassName : null };
    }
    const state = readState(specs[active.spec], itemSets[active.item], skillSets[active.skill], itemsEl, itemText, mainIndex, data, ix);
    Object.assign(state, classOf(specs[active.spec], state.treeVersion));

    const loadouts = loadoutsOf(specs, itemSets, skillSets, configSets, data).map(function (l) {
      const isActive = l.spec === active.spec && l.item === active.item && l.skill === active.skill && l.config === active.config;
      const s = isActive ? Object.assign({}, state) : readState(specs[l.spec], itemSets[l.item], skillSets[l.skill], itemsEl, itemText, mainIndex, data, ix);
      if (!isActive) Object.assign(s, classOf(specs[l.spec], s.treeVersion));
      return Object.assign({ name: l.name, active: isActive }, s);
    });

    return Object.assign(state, {
      level: num(b.level) !== undefined ? num(b.level) : null,
      dps: dps !== undefined ? dps : null,
      dpsStat: dpsStat || null,
      life: stats.Life !== undefined ? stats.Life : null,
      es: stats.EnergyShield !== undefined ? stats.EnergyShield : null,
      stats: stats,
      loadouts: loadouts,
      readerVersion: READER_VERSION,
    });
  }

  /** The fields one combination of tree spec, item set and skill set gives. */
  function readState(specRec, itemSet, skillSet, itemsEl, itemText, mainIndex, data, ix) {
    const spec = specRec ? specRec.el : null;
    const treeVersion = (spec && spec.attrs.treeVersion) || null;
    const tree = treeVersion ? data.trees[treeVersion] : undefined;
    const allocated = new Set(((spec && spec.attrs.nodes) || "").split(",").map((s) => s.trim()).filter(Boolean));
    const keystones = new Set();
    if (tree) for (const id of allocated) if (tree.keystones[id]) keystones.add(tree.keystones[id]);
    let bloodline = null;
    const secondary = spec ? parseInt(spec.attrs.secondaryAscendClassId, 10) : 0;
    if (tree && secondary > 0) bloodline = tree.alternateAscendancies[secondary - 1] || null;

    // Items: worn in the item set, plus jewels socketed in allocated tree sockets.
    const worn = equippedItemIds(itemSet, itemsEl, { treeVersion: treeVersion, allocated: allocated, tree: tree });
    const sockets = spec ? X.children(X.child(spec, "Sockets"), "Socket") : [];
    for (const s of sockets) {
      if (!s.attrs.itemId || s.attrs.itemId === "0" || !allocated.has(s.attrs.nodeId)) continue;
      worn.push(s.attrs.itemId);
      // A cluster jewel's keystone ("Adds <keystone>", e.g. The Front Line) is the entrance node of its sub-tree; it
      // counts once that node is allocated. Its id comes from the socket chain (clusterNodeId).
      const jewel = itemText[s.attrs.itemId] !== undefined ? itemRarityAndName(itemText[s.attrs.itemId]) : null;
      const keystoneNode = jewel && clusterNodeId(s.attrs.nodeId, jewel.lines, tree);
      if (keystoneNode && allocated.has(keystoneNode)) {
        for (const line of activeItemLines(jewel.lines)) {
          const m = /^adds (.+)$/i.exec(line);
          const name = m && data.clusterKeystones.find((k) => k.toLowerCase() === m[1].trim().toLowerCase());
          if (name) keystones.add(name);
        }
      }
      // A timeless jewel replaces each keystone in its radius with its conqueror's keystone (PassiveSpec.lua
      // BuildAllDependsAndPaths: "<type>_keystone_<id>" from tree.legion.nodes).
      const info = tree && itemText[s.attrs.itemId] !== undefined ? itemRarityAndName(itemText[s.attrs.itemId]) : null;
      const conquest = info && timelessConquest(activeItemLines(info.lines), tree);
      const inRadius = conquest && tree.socketKeystones[s.attrs.nodeId] && tree.socketKeystones[s.attrs.nodeId][conquest.radius];
      const replacement = conquest && tree.legionKeystones[conquest.type + "_keystone_" + conquest.id];
      if (inRadius && replacement) {
        for (const id of inRadius) {
          if (!allocated.has(id) || !tree.keystones[id]) continue;
          keystones.delete(tree.keystones[id]);
          keystones.add(replacement);
        }
      }
    }
    const uniques = new Set();
    for (const id of worn) {
      const info = itemText[id] !== undefined ? itemRarityAndName(itemText[id]) : null;
      if (!info) continue;
      if (info.rarity === "UNIQUE" || info.rarity === "RELIC") uniques.add(info.name);
      // A keystone granted by an item is a line that is exactly a keystone's name (ModParser.lua), kept only when the
      // build's tree knows that keystone (ModTools.lua modLib.mergeKeystones: tree.keystoneMap).
      const known = ix.keystoneMaps[treeVersion];
      for (const line of activeItemLines(info.lines)) {
        const name = ix.itemKeystones[line.toLowerCase()];
        if (name && known && known.has(name)) keystones.add(name);
      }
    }

    // Skills: the main socket group is one index for the whole build, clamped to the skill set's groups
    // (CalcSetup.lua: mainSocketGroup = min(max(#socketGroupList, 1), mainSocketGroup)).
    const groups = skillSet && skillSet.el ? X.children(skillSet.el, "Skill") : [];
    let mainId = null;
    const mainGroup = groups[Math.min(Math.max(groups.length, 1), mainIndex) - 1];
    if (mainGroup) {
      const list = groupSkillIds(mainGroup, data, ix);
      if (list.length) mainId = list[Math.min(list.length, parseInt(mainGroup.attrs.mainActiveSkill, 10) || 1) - 1];
    }
    // Every active skill in the set, in group order: the choices for setting the main skill by hand.
    const active = [];
    for (const g of groups) for (const id of groupSkillIds(g, data, ix)) if (active.indexOf(data.skills[id].n) === -1) active.push(data.skills[id].n);

    return {
      bloodline: bloodline,
      mainSkill: mainId ? data.skills[mainId].n : null, // PoB's main skill, exactly as PoB shows it
      autoMainSkill: autoMainSkill(groups, mainId, mainGroup, data, ix), // our pick (see autoMainSkill)
      activeSkills: active,
      skills: allGemNames(groups, data, ix),
      treeVersion: treeVersion,
      patch: patchOf(treeVersion),
      patchLabel: tree ? tree.display : treeVersion,
      ruthless: /ruthless/.test(treeVersion || ""),
      alternate: /alternate/.test(treeVersion || ""),
      keystones: Array.from(keystones).sort(),
      uniques: Array.from(uniques).sort(),
    };
  }

  /** "Cyclone Slayer": the main skill (`skill`, else our pick, else PoB's) and the ascendancy (or class). */
  function defaultName(info, skill) {
    const who = info.ascendancy || info.className || "";
    return [skill || info.autoMainSkill || info.mainSkill, who].filter(Boolean).join(" ") || "Unnamed build";
  }

  /** The challenge league released in a patch ("3.29" -> Allflame), from data/leagues.js. */
  function leagueForPatch(patch, leagues) {
    if (!patch) return null;
    const l = leagues.find((x) => x.version.split(".").slice(0, 2).join(".") === patch);
    return l ? l.name : null;
  }

  /** The challenge league running at a time (ms), or null between leagues. */
  function leagueAt(ms, leagues) {
    for (const l of leagues) {
      if (!l.start) continue;
      const s = Date.parse(l.start), e = l.end ? Date.parse(l.end) : Infinity;
      if (ms >= s && ms <= e) return l.name;
    }
    return null;
  }

  // Bumped whenever readBuild gains or changes a field; stored builds read by an older version are read again.
  const READER_VERSION = 2;

  const api = { READER_VERSION, isDamageSkill, readBuild, resolveGem, groupSkills, defaultName, leagueForPatch, leagueAt, patchOf, comparePatchDesc, activeItemLines, equippedItemIds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobBuildInfo = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
