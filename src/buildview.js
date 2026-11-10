// What the popup row and the page box (src/page.js) both show and edit for one stored build, kept apart from the DOM so
// both use the same rules and they can be tested: the summary line, the main skill's explanation, and the editor's
// fields and the changes it sends (src/recorder.js edit()). Reference: the plan's popup rules (PoE-Sim-Notes
// pob-manager/PoB Manager Plan.md, "The popup").
(function (root) {
  "use strict";

  const F = (typeof module !== "undefined" && module.exports) ? require("./filter.js") : root.PobFilter;

  /** " (loadout X)" when the build has several loadouts: PoB saves stats for the saved loadout only. */
  function savedFrom(views) {
    const saved = views.find((v) => v.saved);
    return views.length > 1 && saved ? " (loadout " + saved.name + ")" : "";
  }

  /** The tooltip that says where the main skill on show comes from (F.mainSkillOf's source). */
  function mainSkillNote(ms) {
    if (ms.source === "manual") return "Main skill set by you" + (ms.pob ? " · PoB's main skill: " + ms.pob : "");
    if (ms.source === "auto") return "PoB's main skill is " + (ms.pob || "none") + " (a utility skill); this is the damage skill with the most supports";
    return "PoB's main skill";
  }

  /**
   * The summary of a read build, as parts: { text, title?, kind? } with kind "skill", "manual" (a skill set by hand),
   * "tag" or "dps". Null while the build is not read (pending, error).
   * @param build a stored record; view: one of F.viewsOf(build) (the one on show)
   */
  function summaryParts(build, view) {
    if (!build || build.status !== "ok" || !build.info || !view) return null;
    const info = view.info;
    const views = F.viewsOf(build);
    const parts = [{ text: (info.ascendancy || info.className || "?") + (build.info.level ? " · Lv " + build.info.level : "") }];
    const ms = F.mainSkillOf(build, view);
    if (ms.skill) parts.push({ text: "· " + ms.skill, title: mainSkillNote(ms), kind: ms.source === "manual" ? "manual" : "skill" });
    if (info.ruthless) parts.push({ text: "Ruthless", kind: "tag" });
    if (info.alternate) parts.push({ text: "Alternate", kind: "tag" });
    if (info.patch) parts.push({ text: info.patch, title: "Patch from the passive tree: " + (info.patchLabel || info.patch), kind: "tag" });
    return parts;
  }

  /**
   * The row's third line (Wesley, Nov 10, 2026): the saved DPS and EHP (PoB's TotalEHP) only, no Life or ES,
   * whichever loadout is the default; null when the build isn't read.
   */
  function statParts(build) {
    if (!build || build.status !== "ok" || !build.info) return null;
    const i = build.info;
    const from = savedFrom(F.viewsOf(build));
    const ehp = i.stats && i.stats.TotalEHP !== undefined ? i.stats.TotalEHP : null;
    const parts = [{ text: F.formatAmount(i.dps) + " DPS", title: "As exported: " + (i.dpsStat || "no DPS stat") + from, kind: "dps" }];
    parts.push({ text: "· " + F.formatAmount(ehp) + " EHP", title: "Effective hit pool, as exported (TotalEHP)" + from });
    return parts;
  }

  /**
   * The editor's fields for a build, showing loadout `viewIndex`:
   *   name: { value, placeholder }, creator: { value, placeholder },
   *   mainSkill: null | { view, value, options: [[value, label]] }   (the main skill of the loadout on show; "" = automatic)
   *   defaultView: null | { value, options: [[value, label]] }       (only with several loadouts; "" = as PoB saved it)
   */
  function editorModel(build, viewIndex) {
    const views = F.viewsOf(build);
    const view = views[viewIndex];
    const model = {
      name: { value: build.customName || "", placeholder: build.info ? F.displayName(Object.assign({}, build, { customName: "" })) : "Name" },
      creator: { value: build.creator || "", placeholder: "Who made the build (optional)" },
      mainSkill: null,
      defaultView: null,
    };
    if (view) {
      const auto = view.info.autoMainSkill || view.info.mainSkill;
      model.mainSkill = {
        view: view.name,
        value: (build.mainSkills && build.mainSkills[view.name]) || "",
        options: [["", "Automatic" + (auto ? " (" + auto + ")" : "")]].concat((view.info.activeSkills || []).map((s) => [s, s])),
      };
      if (views.length > 1) {
        model.defaultView = {
          value: views.some((v) => v.name === build.defaultView) ? build.defaultView : "",
          options: [["", "As PoB saved it"]].concat(views.map((v) => [v.name, v.name + (v.saved ? " (saved)" : "")])),
        };
      }
    }
    return model;
  }

  /**
   * The changes the editor sends (recorder edit()): name and creator always; the main skill and the default loadout
   * when the model offers them. `values` holds what the inputs show: { name, creator, mainSkill?, defaultView? }.
   */
  function editChanges(model, values) {
    const changes = { customName: values.name || "", creator: values.creator || "" };
    if (model.mainSkill) changes.mainSkill = { view: model.mainSkill.view, skill: values.mainSkill || "" };
    if (model.defaultView) changes.defaultView = values.defaultView || "";
    return changes;
  }

  const api = { savedFrom, mainSkillNote, summaryParts, statParts, editorModel, editChanges };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobBuildView = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
