// The popup's list logic, kept apart from the DOM so it can be tested: number input ("1.5m"), each build's views
// (its loadouts), filter options, filtering and sorting.
(function (root) {
  "use strict";

  const B = (typeof module !== "undefined" && module.exports) ? require("./buildinfo.js") : root.PobBuildInfo;

  /** "1.5m" -> 1500000, "800k" -> 800000, "6,100" -> 6100, "" -> null. Returns NaN for text that isn't a number. */
  function parseAmount(text) {
    if (text === undefined || text === null) return null;
    const t = String(text).trim().toLowerCase().replace(/[,_\s]/g, "");
    if (t === "") return null;
    const m = /^(\d+(?:\.\d*)?|\.\d+)([kmb]?)$/.exec(t);
    if (!m) return NaN;
    const mult = { "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]];
    return Math.round(parseFloat(m[1]) * mult * 1000) / 1000;
  }

  /** 4210000 -> "4.2M", 890000 -> "890k", 6100 -> "6.1k", 512 -> "512". */
  function formatAmount(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return "—";
    const a = Math.abs(n);
    const fmt = (v, s) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100) + s;
    if (a >= 1e9) return fmt(n / 1e9, "B");
    if (a >= 1e6) return fmt(n / 1e6, "M");
    if (a >= 1e3) return fmt(n / 1e3, "k");
    return String(Math.round(n));
  }

  /**
   * The ways a stored build can be shown: one per PoB loadout, or the saved state alone when it has none. When the
   * saved state is not one of the loadouts it comes first as "As saved". Only the saved state has stats.
   * @returns {{name, saved: boolean, info}[]}
   */
  function viewsOf(build) {
    const info = build.info;
    if (!info) return [];
    const savedView = { name: "As saved", saved: true, info: info };
    const loadouts = info.loadouts || [];
    if (loadouts.length === 0) return [savedView];
    const views = loadouts.map((l) => ({ name: l.name, saved: !!l.active, info: l }));
    if (!views.some((v) => v.saved)) views.unshift(savedView);
    return views;
  }

  /** The view shown first: the default loadout set by hand when it still exists, else the saved state. */
  function defaultViewIndex(build) {
    const views = viewsOf(build);
    const set = build.defaultView ? views.findIndex((v) => v.name === build.defaultView) : -1;
    if (set !== -1) return set;
    const saved = views.findIndex((v) => v.saved);
    return saved === -1 ? 0 : saved;
  }

  /**
   * The main skill shown for a view: the one set by hand for it, else our pick (buildinfo autoMainSkill), else PoB's.
   * @returns {{skill, source: "manual"|"auto"|"pob", pob}} pob = PoB's own main skill.
   */
  function mainSkillOf(build, view) {
    const i = view.info;
    const manual = build.mainSkills && build.mainSkills[view.name];
    if (manual) return { skill: manual, source: "manual", pob: i.mainSkill };
    if (i.autoMainSkill && i.autoMainSkill !== i.mainSkill) return { skill: i.autoMainSkill, source: "auto", pob: i.mainSkill };
    return { skill: i.mainSkill || i.autoMainSkill || null, source: "pob", pob: i.mainSkill };
  }

  function displayName(build) {
    if (build.customName && build.customName.trim()) return build.customName.trim();
    if (!build.info) return build.link;
    const view = viewsOf(build)[defaultViewIndex(build)];
    return B.defaultName(view.info, mainSkillOf(build, view).skill);
  }

  /** Values for the drop-downs and type-aheads, from every view of every build. */
  function filterOptions(builds, leagues) {
    const patches = new Set(), classes = new Set(), creators = new Set(), keystones = new Set(), uniques = new Set();
    const ascByClass = {};
    for (const b of builds) {
      if (b.creator && b.creator.trim()) creators.add(b.creator.trim());
      for (const v of viewsOf(b)) {
        const i = v.info;
        if (i.patch) patches.add(i.patch);
        if (i.className) {
          classes.add(i.className);
          ascByClass[i.className] = ascByClass[i.className] || new Set();
          if (i.ascendancy) ascByClass[i.className].add(i.ascendancy);
        }
        for (const k of i.keystones || []) keystones.add(k);
        for (const u of i.uniques || []) uniques.add(u);
      }
    }
    const sorted = (s) => Array.from(s).sort((a, b) => a.localeCompare(b));
    const asc = {};
    for (const c of Object.keys(ascByClass)) asc[c] = sorted(ascByClass[c]);
    return {
      patches: Array.from(patches).sort(B.comparePatchDesc).map((p) => ({ patch: p, league: B.leagueForPatch(p, leagues || []) })),
      classes: sorted(classes),
      ascendanciesByClass: asc,
      allAscendancies: sorted(new Set([].concat(...Object.values(asc)))),
      creators: sorted(creators),
      keystones: sorted(keystones),
      uniques: sorted(uniques),
    };
  }

  const EMPTY = { patch: "", className: "", ascendancy: "", search: "", creator: "", keystones: [], uniques: [],
    dpsMin: "", dpsMax: "", lifeMin: "", lifeMax: "", favorites: false, sort: "newest" };

  function inRange(value, minText, maxText) {
    const min = parseAmount(minText), max = parseAmount(maxText);
    if (min === null && max === null) return true;
    if (value === null || value === undefined) return false;
    if (min !== null && !Number.isNaN(min) && value < min) return false;
    if (max !== null && !Number.isNaN(max) && value > max) return false;
    return true;
  }

  function viewMatches(build, view, f) {
    const i = view.info;
    if (f.patch && i.patch !== f.patch) return false;
    if (f.className && i.className !== f.className) return false;
    if (f.ascendancy && i.ascendancy !== f.ascendancy) return false;
    for (const k of f.keystones || []) if ((i.keystones || []).indexOf(k) === -1) return false;
    for (const u of f.uniques || []) if ((i.uniques || []).indexOf(u) === -1) return false;
    const ranged = (f.dpsMin || f.dpsMax || f.lifeMin || f.lifeMax);
    if (ranged) {
      // Stats exist only for the state the build was saved in.
      if (!view.saved) return false;
      if (!inRange(build.info.dps, f.dpsMin, f.dpsMax) || !inRange(build.info.life, f.lifeMin, f.lifeMax)) return false;
    }
    const q = (f.search || "").trim().toLowerCase();
    if (q) {
      const hay = [displayName(build), build.creator || "", view.name, mainSkillOf(build, view).skill || ""].concat(i.skills || []).join("\n").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  const SORTS = {
    newest: { key: (b) => b.lastSeen, desc: true },
    oldest: { key: (b) => b.lastSeen, desc: false },
    dps: { key: (b) => (b.info ? b.info.dps : null), desc: true },
    life: { key: (b) => (b.info ? b.info.life : null), desc: true },
    level: { key: (b) => (b.info ? b.info.level : null), desc: true },
    name: { key: (b) => displayName(b).toLowerCase(), desc: false },
    visits: { key: (b) => b.visits, desc: true },
  };

  /**
   * @returns {{build, view: number}[]} the builds that match, sorted, each with the view to show: the first matching
   * one, trying the default loadout first, then the saved state, then the rest in order. Builds still being read or
   * failed are kept when no filter is set.
   */
  function apply(builds, filters) {
    const f = Object.assign({}, EMPTY, filters || {});
    const anyFilter = f.patch || f.className || f.ascendancy || f.search.trim() || f.creator || f.keystones.length ||
      f.uniques.length || f.dpsMin || f.dpsMax || f.lifeMin || f.lifeMax;
    const out = [];
    for (const b of builds) {
      // Favorites only: a starred build still being read or failed stays, like any build when no other filter is set.
      if (f.favorites && b.favorite !== true) continue;
      if (f.creator === "\u0000none" ? (b.creator && b.creator.trim()) : (f.creator && (b.creator || "").trim() !== f.creator)) continue;
      const views = viewsOf(b);
      if (views.length === 0) { if (!anyFilter) out.push({ build: b, view: -1 }); continue; }
      const first = defaultViewIndex(b);
      const rank = (i) => (i === first ? 0 : views[i].saved ? 1 : 2);
      const order = views.map((v, i) => i).sort((x, y) => rank(x) - rank(y) || x - y);
      const hit = order.find((i) => viewMatches(b, views[i], f));
      if (hit !== undefined) out.push({ build: b, view: hit });
    }
    const s = SORTS[f.sort] || SORTS.newest;
    out.sort((x, y) => {
      const a = s.key(x.build), b = s.key(y.build);
      const am = a === null || a === undefined, bm = b === null || b === undefined;
      if (am || bm) return am && bm ? 0 : am ? 1 : -1; // missing values last, whatever the direction
      const c = typeof a === "string" ? a.localeCompare(b) : a - b;
      return s.desc ? -c : c;
    });
    return out;
  }

  const api = { parseAmount, formatAmount, viewsOf, defaultViewIndex, mainSkillOf, displayName, filterOptions, apply, EMPTY, NO_CREATOR: "\u0000none" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobFilter = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
