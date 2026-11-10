// The toolbar popup: lists the stored builds (src/store.js) with the filters and sort of src/filter.js. Reads the
// store directly; every change (rename, creator, retry, delete) goes to the background script.
"use strict";
(function () {
  const ext = typeof browser !== "undefined" ? browser : chrome;
  const F = globalThis.PobFilter;
  const B = globalThis.PobBuildInfo;
  const LEAGUES = globalThis.PobLeagues || [];
  const D = globalThis.PobDetails;
  const V = globalThis.PobBuildView;
  const DATA = globalThis.PobData;
  const $ = (id) => document.getElementById(id);

  let builds = [];
  let filters = Object.assign({}, F.EMPTY);
  let editing = null; // key of the build whose editor is open
  let confirmDelete = null;
  const expanded = new Set(); // keys of the rows open in this popup session
  let keyOptions = null; // the latest filter options, for the keystone, unique and skill type-aheads

  // ---------- storage of the popup's own state ----------
  // Promise forms: Firefox's browser.* only returns promises, and Chrome's MV3 APIs return them too.
  async function loadFilters() {
    try {
      const r = await ext.storage.local.get("filters");
      if (r && r.filters) filters = Object.assign({}, F.EMPTY, r.filters);
    } catch (e) { /* saved filters are a convenience */ }
  }
  function saveFilters() {
    try { Promise.resolve(ext.storage.local.set({ filters: filters })).catch(function () {}); } catch (e) { /* not fatal */ }
  }

  async function send(msg) {
    try {
      return (await ext.runtime.sendMessage(msg)) || { ok: false, error: "No reply from the background script" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  async function reload() {
    const store = await globalThis.PobStore.open(indexedDB);
    try { builds = await store.allBuilds(); } finally { store.close(); }
    render();
  }

  // ---------- helpers ----------
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of children || []) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  }
  /** Fills a drop-down and returns the value it shows (the first option when `value` is no longer offered). */
  function fillSelect(select, options, value) {
    select.replaceChildren(...options.map(([v, label]) => el("option", { value: v, text: label })));
    select.value = options.some(([v]) => v === value) ? value : options[0][0];
    return select.value;
  }
  function shortDate(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : "");
  }
  function activeExtraFilters() {
    return [filters.creator, filters.added, filters.dpsMin || filters.dpsMax, filters.lifeMin || filters.lifeMax, filters.esMin || filters.esMax,
      filters.levelMin || filters.levelMax].filter(Boolean).length + filters.keystones.length + filters.uniques.length + filters.skills.length;
  }

  const KIND_CLASS = { skill: "skill", manual: "skill manual", tag: "tag", dps: "dps" }; // buildview part kinds → classes

  // ---------- filter controls ----------
  function renderFilters(opts) {
    // A saved filter value that no build has any more is dropped, so the list never filters on something hidden.
    filters.patch = fillSelect($("patch"), [["", "All patches"]].concat(opts.patches.map((p) => [p.patch, p.patch + (p.league ? " · " + p.league : "")])), filters.patch);
    filters.className = fillSelect($("className"), [["", "All classes"]].concat(opts.classes.map((c) => [c, c])), filters.className);
    const ascList = filters.className ? (opts.ascendanciesByClass[filters.className] || []) : opts.allAscendancies;
    filters.ascendancy = fillSelect($("ascendancy"), [["", "All ascendancies"]].concat(ascList.map((a) => [a, a])), filters.ascendancy);
    filters.creator = fillSelect($("creator"), [["", "Any"], [F.NO_CREATOR, "No creator"]].concat(opts.creators.map((c) => [c, c])), filters.creator);
    filters.added = fillSelect($("added"), [["", "Any time"]].concat(Object.keys(F.ADDED).map((d) => [d, F.ADDED[d]])), filters.added);
    filters.keystones = filters.keystones.filter((k) => opts.keystones.indexOf(k) !== -1);
    filters.uniques = filters.uniques.filter((u) => opts.uniques.indexOf(u) !== -1);
    filters.skills = filters.skills.filter((s) => opts.skills.indexOf(s) !== -1);
    $("sort").value = filters.sort;
    $("favorites").setAttribute("aria-pressed", filters.favorites ? "true" : "false");
    if (document.activeElement !== $("search")) $("search").value = filters.search;
    for (const k of F.RANGES) if (document.activeElement !== $(k)) $(k).value = filters[k];
    $("keystoneList").replaceChildren(...opts.keystones.map((k) => el("option", { value: k })));
    $("uniqueList").replaceChildren(...opts.uniques.map((u) => el("option", { value: u })));
    $("skillList").replaceChildren(...opts.skills.map((s) => el("option", { value: s })));
    renderChips("keystoneChips", "keystoneInput", "keystones");
    renderChips("uniqueChips", "uniqueInput", "uniques");
    renderChips("skillChips", "skillInput", "skills");
    const n = activeExtraFilters();
    $("moreSummary").textContent = "More filters" + (n ? " (" + n + " active)" : "");
    for (const k of F.RANGES) {
      $(k).style.borderColor = Number.isNaN(F.parseAmount(filters[k])) ? "var(--danger)" : "";
    }
  }
  function renderChips(boxId, inputId, field) {
    const box = $(boxId), input = $(inputId);
    box.replaceChildren(...filters[field].map((v) => el("span", { class: "chip" }, [v,
      el("button", { type: "button", title: "Remove", text: "×", onclick: () => { filters[field] = filters[field].filter((x) => x !== v); changed(); } })])), input);
  }
  function addChip(field, input, known) {
    const v = input.value.trim();
    const match = known.find((k) => k.toLowerCase() === v.toLowerCase());
    if (match && filters[field].indexOf(match) === -1) filters[field] = filters[field].concat([match]);
    if (match || !v) input.value = "";
    changed();
  }

  function changed() {
    saveFilters();
    render();
  }

  // ---------- list ----------
  function render() {
    const opts = F.filterOptions(builds, LEAGUES);
    keyOptions = opts;
    renderFilters(opts);
    const rows = F.apply(builds, filters);
    $("count").textContent = (rows.length === builds.length ? builds.length : rows.length + " of " + builds.length) + " builds";
    const list = $("list");
    if (builds.length === 0) {
      list.replaceChildren(el("div", { class: "empty", text: "No builds yet. Open a PoB share link (pobb.in, poe.ninja/poe1/pob, Maxroll, pob.codes, poedb, Pastebin, Rentry) and it shows up here." }));
      return;
    }
    if (rows.length === 0) {
      const noFavorites = filters.favorites && !builds.some((x) => x.favorite === true);
      list.replaceChildren(el("div", { class: "empty", text: noFavorites ? "No favorites yet. Click ☆ on a build to add it." : "No builds match these filters." }));
      return;
    }
    list.replaceChildren(...rows.map(renderRow));
    fitStats(list);
  }

  function renderRow(row) {
    const b = row.build;
    const views = F.viewsOf(b);
    const vi = row.view;
    const view = views[vi];
    const info = view ? view.info : null;

    const name = el("span", { class: "name", text: F.displayName(b), title: F.displayName(b) });
    const fav = b.favorite === true;
    const star = el("button", { type: "button", class: "star" + (fav ? " on" : ""), text: fav ? "★" : "☆",
      title: fav ? "Remove from favorites" : "Add to favorites", "aria-pressed": fav ? "true" : "false",
      onclick: (e) => { e.stopPropagation(); send({ type: "edit", key: b.key, changes: { favorite: !fav } }).then(reload); } });
    const league = B.leagueAt(b.lastSeen, LEAGUES);
    const line1 = el("div", { class: "line" }, [star, name,
      el("button", { class: "icon", type: "button", title: "Edit name, creator, main skill and default loadout", text: "✎", onclick: (e) => { e.stopPropagation(); editing = editing === b.key ? null : b.key; render(); } }),
      b.creator ? el("span", { class: "by", text: "by " + b.creator }) : null,
      el("span", { class: "site", text: b.label + " · " + shortDate(b.lastSeen),
        title: "Last visited " + new Date(b.lastSeen).toLocaleString() + (league ? " (during " + league + ")" : "") + " · " + b.visits + " visit" + (b.visits === 1 ? "" : "s") }),
      el("button", { type: "button", class: "rowbtn primary", text: "Open link", title: b.link, onclick: (e) => { e.stopPropagation(); ext.tabs.create({ url: b.link }); } }),
      el("button", { type: "button", class: "rowbtn", text: "Open in PoB", title: b.pobUri, onclick: (e) => { e.stopPropagation(); ext.tabs.create({ url: b.pobUri }); } })]);

    let line2;
    if (b.status === "pending") line2 = el("div", { class: "line meta", text: "Reading build…" });
    else if (b.status === "error" || !info) line2 = el("div", { class: "line meta" }, [el("span", { class: "error", text: b.error || "Could not read this build" })]);
    else {
      const parts = V.summaryParts(b, view).map((p) => el("span", { class: KIND_CLASS[p.kind] || "", text: p.text, title: p.title || "" }));
      line2 = el("div", { class: "line meta" }, parts);
    }
    const stats = V.statParts(b);
    const line3 = stats ? el("div", { class: "line meta statline" }, stats.map((p) => el("span", { class: KIND_CLASS[p.kind] || "", text: p.text, title: p.title || "" }))) : null;

    const open = expanded.has(b.key);
    const children = [line1, line2].concat(line3 ? [line3] : []);
    if (open) children.push(renderDetails(b, views, vi));
    if (editing === b.key) children.push(renderEditor(b, views, vi));
    const toggle = () => { if (open) expanded.delete(b.key); else expanded.add(b.key); render(); };
    // A mouse-up that ends a text selection also fires a click (on the row when the drag crosses into its summary):
    // don't toggle then, so text in the row can be selected and copied.
    const onClick = () => { if (String(window.getSelection() || "") !== "") return; toggle(); };
    return el("div", { class: "build" + (open ? " open" : ""), "data-link": b.link, tabindex: "0", role: "button", "aria-expanded": open ? "true" : "false",
      onclick: onClick, onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); toggle(); } } }, children);
  }

  /**
   * Three stat columns are narrow: a line whose label no longer fits shows its value's short form (k, M, B; full
   * value on hover) instead (Wesley, Nov 8, 2026). Measured after layout, so only values that need it are shortened.
   */
  function fitStats(container) {
    for (const v of container.querySelectorAll(".stat .v[data-short]")) {
      if (!v.dataset.short) continue;
      const k = v.previousElementSibling;
      if (k.scrollWidth > k.clientWidth) { v.textContent = v.dataset.short; v.title = v.dataset.full; }
    }
  }

  const savedFrom = V.savedFrom;

  /** The expanded part: actions, then PoB's left-panel stats for the loadout on show, then what the build holds. */
  function renderDetails(b, views, vi) {
    const view = views[vi];
    const stop = (e) => e.stopPropagation();
    // The loadout on show, at the bottom of the expanded part (Wesley, Nov 8, 2026). Information only: a chip naming
    // the default loadout (set with ✎, else the saved one); hovering or focusing it lists every loadout, marking the
    // saved one (the one with stats) and the default. Nothing here can be picked.
    const loadout = views.length > 1 && view ? el("span", { class: "loadout", tabindex: "0", "aria-describedby": "loadouts-" + b.key }, [
      el("span", { class: "k", text: "Loadout" }),
      el("span", { class: "v", text: view.name }),
      el("span", { class: "count", text: views.length + " loadouts" }),
      el("div", { class: "loadout-pop", role: "tooltip", id: "loadouts-" + b.key }, [el("div", { class: "section-title", text: "Loadouts in this build" })]
        .concat(views.map((v) => el("div", { class: "item" + (v === view ? " on" : "") }, [
          el("span", { class: "lname", text: v.name }),
          v.saved ? el("span", { class: "tag", text: "saved · stats" }) : null,
          v === view ? el("span", { class: "tag accent", text: "default" }) : null,
        ])))
        .concat([el("div", { class: "hint", text: "Set the default with ✎." })])),
    ]) : null;
    const retry = b.status === "error" ? el("button", { type: "button", text: "Retry", onclick: (e) => { stop(e); send({ type: "retry", key: b.key }).then(reload); } }) : null;
    const del = el("button", { type: "button", class: "danger", text: confirmDelete === b.key ? "Confirm delete" : "Delete",
      onclick: (e) => { stop(e); if (confirmDelete !== b.key) { confirmDelete = b.key; render(); return; } confirmDelete = null; send({ type: "delete", key: b.key }).then(reload); } });
    // The bottom line (Wesley, Nov 8, 2026): the loadout chip on the left, Retry and Delete on the right.
    const bottom = el("div", { class: "actions bottom" }, [loadout, el("span", { class: "spacer" }), retry, del]);
    const parts = [];
    if (!view) return el("div", { class: "details", onclick: stop }, [bottom]);
    const info = view.info;

    {
      // The saved stats, whichever loadout is the default (see renderRow).
      const sections = D.statSections(b.info, DATA.statDefs);
      parts.push(el("div", { class: "stats", title: "Stats as PoB saved them" + savedFrom(views) }, sections.map((s) => el("div", { class: "section" }, [el("div", { class: "section-title", text: s.title })]
        .concat(s.rows.map((r) => el("div", { class: "stat", "data-stat": r.stat }, [el("span", { class: "k", text: r.label, title: r.label }),
          el("span", { class: "v", text: r.value, "data-full": r.value, "data-short": r.short || "" })])))))));
      parts.push(el("div", { class: "note", text: "Stats as PoB saved them" + (b.info.dpsStat ? " (DPS: " + (DATA.statDefs[b.info.dpsStat] ? DATA.statDefs[b.info.dpsStat].l : b.info.dpsStat) + ")" : "") + ", with the uploader's configuration." }));
    }

    const list = (title, items) => (items && items.length ? el("div", { class: "list" }, [el("span", { class: "section-title", text: title })]
      .concat(items.map((x) => el("span", { class: "chip", text: x })))) : null);
    parts.push(list("Keystones", info.keystones));
    parts.push(bottom);
    return el("div", { class: "details", onclick: stop }, parts);
  }

  /** Name, creator, the main skill of the loadout on show, and the default loadout. */
  function renderEditor(b, views, vi) {
    const view = views[vi];
    const m = V.editorModel(b, vi);
    const nameIn = el("input", { value: m.name.value, placeholder: m.name.placeholder });
    const creatorIn = el("input", { value: m.creator.value, placeholder: m.creator.placeholder });
    const select = (cls, f) => { const s = el("select", { class: cls }, f.options.map(([v, t]) => el("option", { value: v, text: t }))); s.value = f.value; return s; };
    const skillIn = m.mainSkill ? select("main-skill", m.mainSkill) : null;
    const defaultIn = m.defaultView ? select("default-loadout", m.defaultView) : null;
    function save() {
      const changes = V.editChanges(m, { name: nameIn.value, creator: creatorIn.value,
        mainSkill: skillIn && skillIn.value, defaultView: defaultIn && defaultIn.value });
      send({ type: "edit", key: b.key, changes: changes }).then(function (r) {
        if (r.ok) { editing = null; }
        reload();
      });
    }
    function keys(e) {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); editing = null; render(); }
    }
    nameIn.addEventListener("keydown", keys);
    creatorIn.addEventListener("keydown", keys);
    const box = el("div", { class: "editor", onclick: (e) => e.stopPropagation() }, [
      el("label", { text: "Name" }), nameIn,
      el("label", { text: "Creator" }), creatorIn,
      skillIn ? el("label", { text: "Main skill", title: views.length > 1 ? "For the loadout on show: " + view.name : "" }) : null, skillIn,
      defaultIn ? el("label", { text: "Default loadout" }) : null, defaultIn,
      el("div", { class: "buttons" }, [
        el("button", { type: "button", class: "primary", text: "Save", onclick: save }),
        el("button", { type: "button", text: "Cancel", onclick: () => { editing = null; render(); } })]),
    ]);
    setTimeout(() => nameIn.focus(), 0);
    return box;
  }

  // ---------- wiring ----------
  function bind() {
    for (const id of ["patch", "className", "ascendancy", "creator", "added", "sort"]) {
      $(id).addEventListener("change", (e) => { filters[id] = e.target.value; if (id === "className") filters.ascendancy = ""; changed(); });
    }
    for (const id of ["search"].concat(F.RANGES)) {
      $(id).addEventListener("input", (e) => { filters[id] = e.target.value; changed(); });
    }
    $("keystoneInput").addEventListener("change", (e) => addChip("keystones", e.target, keyOptions ? keyOptions.keystones : []));
    $("uniqueInput").addEventListener("change", (e) => addChip("uniques", e.target, keyOptions ? keyOptions.uniques : []));
    $("skillInput").addEventListener("change", (e) => addChip("skills", e.target, keyOptions ? keyOptions.skills : []));
    $("favorites").addEventListener("click", () => { filters.favorites = !filters.favorites; changed(); });
    $("clearAll").addEventListener("click", () => { filters = Object.assign({}, F.EMPTY, { sort: filters.sort }); changed(); });
    ext.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "builds-changed") reload(); });
  }

  bind();
  loadFilters().then(reload);
})();
