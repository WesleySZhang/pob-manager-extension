// The toolbar popup: lists the stored builds (src/store.js) with the filters and sort of src/filter.js. Reads the
// store directly; every change (rename, creator, retry, delete) goes to the background script.
"use strict";
(function () {
  const ext = typeof browser !== "undefined" ? browser : chrome;
  const F = globalThis.PobFilter;
  const B = globalThis.PobBuildInfo;
  const LEAGUES = globalThis.PobLeagues || [];
  const $ = (id) => document.getElementById(id);

  let builds = [];
  let filters = Object.assign({}, F.EMPTY);
  const viewChoice = {}; // build key -> view index picked in its Loadout drop-down (this popup session)
  let editing = null; // key of the build whose editor is open
  let confirmDelete = null;
  let keyOptions = null; // the latest filter options, for the keystone and unique type-aheads

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
    return [filters.creator, filters.dpsMin || filters.dpsMax, filters.lifeMin || filters.lifeMax]
      .filter(Boolean).length + filters.keystones.length + filters.uniques.length;
  }

  // ---------- filter controls ----------
  function renderFilters(opts) {
    // A saved filter value that no build has any more is dropped, so the list never filters on something hidden.
    filters.patch = fillSelect($("patch"), [["", "All patches"]].concat(opts.patches.map((p) => [p.patch, p.patch + (p.league ? " · " + p.league : "")])), filters.patch);
    filters.className = fillSelect($("className"), [["", "All classes"]].concat(opts.classes.map((c) => [c, c])), filters.className);
    const ascList = filters.className ? (opts.ascendanciesByClass[filters.className] || []) : opts.allAscendancies;
    filters.ascendancy = fillSelect($("ascendancy"), [["", "All ascendancies"]].concat(ascList.map((a) => [a, a])), filters.ascendancy);
    filters.creator = fillSelect($("creator"), [["", "Any"], [F.NO_CREATOR, "No creator"]].concat(opts.creators.map((c) => [c, c])), filters.creator);
    filters.keystones = filters.keystones.filter((k) => opts.keystones.indexOf(k) !== -1);
    filters.uniques = filters.uniques.filter((u) => opts.uniques.indexOf(u) !== -1);
    $("sort").value = filters.sort;
    if (document.activeElement !== $("search")) $("search").value = filters.search;
    for (const k of ["dpsMin", "dpsMax", "lifeMin", "lifeMax"]) if (document.activeElement !== $(k)) $(k).value = filters[k];
    $("keystoneList").replaceChildren(...opts.keystones.map((k) => el("option", { value: k })));
    $("uniqueList").replaceChildren(...opts.uniques.map((u) => el("option", { value: u })));
    renderChips("keystoneChips", "keystoneInput", "keystones");
    renderChips("uniqueChips", "uniqueInput", "uniques");
    const n = activeExtraFilters();
    $("moreSummary").textContent = "More filters" + (n ? " (" + n + " active)" : "");
    for (const k of ["dpsMin", "dpsMax", "lifeMin", "lifeMax"]) {
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
      list.replaceChildren(el("div", { class: "empty", text: "No builds match these filters." }));
      return;
    }
    list.replaceChildren(...rows.map(renderRow));
  }

  function renderRow(row) {
    const b = row.build;
    const views = F.viewsOf(b);
    let vi = row.view;
    if (viewChoice[b.key] !== undefined && views[viewChoice[b.key]]) vi = viewChoice[b.key];
    const view = views[vi];
    const info = view ? view.info : null;

    const name = el("span", { class: "name", text: F.displayName(b), title: F.displayName(b) });
    const line1 = el("div", { class: "line" }, [name,
      el("button", { class: "icon", type: "button", title: "Edit name and creator", text: "✎", onclick: (e) => { e.stopPropagation(); editing = editing === b.key ? null : b.key; render(); } }),
      b.creator ? el("span", { class: "by", text: "by " + b.creator }) : null,
      el("span", { class: "site", text: b.label })]);

    let line2;
    if (b.status === "pending") line2 = el("div", { class: "line meta", text: "Reading build…" });
    else if (b.status === "error" || !info) line2 = el("div", { class: "line meta" }, [el("span", { class: "error", text: b.error || "Could not read this build" })]);
    else {
      const parts = [];
      parts.push(el("span", { text: (info.ascendancy || info.className || "?") + (b.info.level ? " · Lv " + b.info.level : "") }));
      if (info.mainSkill) parts.push(el("span", { class: "skill", text: "· " + info.mainSkill }));
      if (info.ruthless) parts.push(el("span", { class: "tag", text: "Ruthless" }));
      if (info.alternate) parts.push(el("span", { class: "tag", text: "Alternate" }));
      if (info.patch) parts.push(el("span", { class: "tag", text: info.patch, title: "Patch from the passive tree: " + (info.patchLabel || info.patch) }));
      const stats = view.saved;
      parts.push(el("span", { class: "dps", text: "· " + (stats ? F.formatAmount(b.info.dps) : "—") + " DPS",
        title: stats ? "As exported: " + (b.info.dpsStat || "no DPS stat") : "Stats exist only for the loadout the build was saved on" }));
      parts.push(el("span", { text: "· " + (stats ? F.formatAmount(b.info.life) : "—") + " Life" }));
      if (stats && b.info.es >= 1) parts.push(el("span", { text: "· " + F.formatAmount(b.info.es) + " ES" }));
      const league = B.leagueAt(b.lastSeen, LEAGUES);
      parts.push(el("span", { class: "date", text: shortDate(b.lastSeen), title: "Last visited " + new Date(b.lastSeen).toLocaleString() + (league ? " (during " + league + ")" : "") + " · " + b.visits + " visit" + (b.visits === 1 ? "" : "s") }));
      line2 = el("div", { class: "line meta" }, parts);
    }

    const actions = el("div", { class: "actions" }, [
      views.length > 1 ? el("select", { class: "loadout", title: "Loadout", onclick: (e) => e.stopPropagation(),
        onchange: (e) => { viewChoice[b.key] = Number(e.target.value); render(); } },
        views.map((v, i) => { const o = el("option", { value: String(i), text: "Loadout: " + v.name + (v.saved ? " (saved)" : "") }); if (i === vi) o.selected = true; return o; })) : null,
      el("span", { class: "spacer" }),
      b.status === "error" ? el("button", { type: "button", text: "Retry", onclick: (e) => { e.stopPropagation(); send({ type: "retry", key: b.key }).then(reload); } }) : null,
      el("button", { type: "button", text: "Open in PoB", title: b.pobUri, onclick: (e) => { e.stopPropagation(); ext.tabs.create({ url: b.pobUri }); } }),
      el("button", { type: "button", text: "Copy link", onclick: (e) => { e.stopPropagation(); navigator.clipboard.writeText(b.link).then(() => { e.target.textContent = "Copied"; }); } }),
      el("button", { type: "button", class: "danger", text: confirmDelete === b.key ? "Confirm delete" : "Delete",
        onclick: (e) => { e.stopPropagation(); if (confirmDelete !== b.key) { confirmDelete = b.key; render(); return; } confirmDelete = null; send({ type: "delete", key: b.key }).then(reload); } }),
    ]);

    const children = [line1, line2, actions];
    if (editing === b.key) children.push(renderEditor(b));
    return el("div", { class: "build", title: b.link, onclick: () => ext.tabs.create({ url: b.link }) }, children);
  }

  function renderEditor(b) {
    const nameIn = el("input", { value: b.customName || "", placeholder: b.info ? B.defaultName(b.info) : "Name" });
    const creatorIn = el("input", { value: b.creator || "", placeholder: "Who made the build (optional)" });
    function save() {
      send({ type: "edit", key: b.key, changes: { customName: nameIn.value, creator: creatorIn.value } }).then(function (r) {
        if (r.ok) editing = null;
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
      el("div", { class: "buttons" }, [
        el("button", { type: "button", class: "primary", text: "Save", onclick: save }),
        el("button", { type: "button", text: "Cancel", onclick: () => { editing = null; render(); } })]),
    ]);
    setTimeout(() => nameIn.focus(), 0);
    return box;
  }

  // ---------- wiring ----------
  function bind() {
    for (const id of ["patch", "className", "ascendancy", "creator", "sort"]) {
      $(id).addEventListener("change", (e) => { filters[id] = e.target.value; if (id === "className") filters.ascendancy = ""; changed(); });
    }
    for (const id of ["search", "dpsMin", "dpsMax", "lifeMin", "lifeMax"]) {
      $(id).addEventListener("input", (e) => { filters[id] = e.target.value; changed(); });
    }
    $("keystoneInput").addEventListener("change", (e) => addChip("keystones", e.target, keyOptions ? keyOptions.keystones : []));
    $("uniqueInput").addEventListener("change", (e) => addChip("uniques", e.target, keyOptions ? keyOptions.uniques : []));
    $("clearAll").addEventListener("click", () => { filters = Object.assign({}, F.EMPTY, { sort: filters.sort }); changed(); });
    ext.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "builds-changed") reload(); });
  }

  bind();
  loadFilters().then(reload);
})();
