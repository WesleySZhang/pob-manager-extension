// The page box: a content script on the PoB share sites (tools/build.js content_scripts). On a share page whose build is
// stored, a "PoB Manager" button sits in the bottom-right corner; it opens a panel that shows the build and edits it
// like the popup's ✎ (name, creator, main skill, default loadout), plus favorite and delete. The panel lives in a shadow
// root so the site's styles don't reach it, and every read and write goes through the background script (a content
// script can't open the extension's IndexedDB). Rules shared with the popup: src/buildview.js.
"use strict";
(function () {
  const ext = typeof browser !== "undefined" ? browser : chrome;
  const F = globalThis.PobFilter;
  const V = globalThis.PobBuildView;
  if (window.top !== window || document.getElementById("pob-manager-box")) return; // top page only, once

  let url = location.href;
  let found = null; // { key, record } from the background, or null
  let open = false;
  let dirty = false; // the editor holds unsaved input: background updates must not overwrite it
  let confirmDelete = false;
  let note = ""; // a short status line under the editor ("Saved", an error)

  // ---------- the shadow root ----------
  const host = document.createElement("div");
  host.id = "pob-manager-box";
  host.style.cssText = "all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  // Colours: popup/popup.css's tokens.
  style.textContent = `
    :host { --bg: #11141b; --panel: #191d27; --panel-2: #222735; --line: #2b3142; --line-strong: #3f4760;
      --text: #e4e7ee; --muted: #8a93a8; --accent: #d9a84e; --accent-text: #15120a; --danger: #e06c6c; --tag: #2f3647;
      --focus: #5b8def; color-scheme: dark; }
    * { box-sizing: border-box; }
    .wrap { font: 13px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text);
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .pill { background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); border-left: 3px solid var(--accent);
      border-radius: 4px; padding: 5px 10px; box-shadow: 0 2px 8px rgba(0,0,0,.5); cursor: pointer; font: inherit; }
    .pill:hover { border-color: var(--muted); border-left-color: var(--accent); }
    .pill .star { color: var(--accent); margin-left: 4px; }
    .panel { width: 360px; max-height: calc(100vh - 80px); overflow: auto; background: var(--bg); border: 1px solid var(--line-strong);
      border-left: 3px solid var(--accent); border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,.6); padding: 10px 12px; }
    .head { display: flex; align-items: center; gap: 6px; }
    .head .name { flex: 1; min-width: 0; font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .meta { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
    .meta .skill { color: var(--text); }
    .meta .skill.manual { text-decoration: underline dotted var(--accent); text-underline-offset: 3px; }
    .meta .dps { color: var(--accent); }
    .tag { background: var(--tag); color: var(--text); border-radius: 3px; padding: 0 5px; font-size: 11px; }
    .error { color: var(--danger); }
    .editor { display: grid; grid-template-columns: 96px 1fr; gap: 6px 8px; align-items: center; margin-top: 10px;
      padding-top: 10px; border-top: 1px solid var(--line); }
    .editor label { color: var(--muted); }
    .editor .buttons { grid-column: 2; display: flex; gap: 6px; align-items: center; }
    .note { color: var(--muted); font-size: 12px; }
    select, input, button { font: inherit; color: var(--text); background: var(--panel-2); border: 1px solid var(--line);
      border-radius: 3px; padding: 3px 6px; min-width: 0; width: 100%; }
    button { width: auto; cursor: pointer; }
    button:hover { border-color: var(--muted); }
    button:disabled { opacity: .5; cursor: default; }
    select:focus, input:focus, button:focus-visible { outline: 1px solid var(--focus); outline-offset: 0; }
    button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
    button.danger { color: var(--danger); }
    button.icon { border: 0; background: transparent; padding: 0 4px; color: var(--muted); font-size: 15px; line-height: 1; }
    button.icon:hover, button.icon.on { color: var(--accent); }
    .foot { display: flex; gap: 6px; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line); }
    .foot .spacer { flex: 1; }
    a { color: var(--muted); font-size: 12px; }
    a:hover { color: var(--text); }
  `;
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  shadow.append(style, wrap);
  // Keys typed in the panel stay in the panel: share sites have their own shortcuts.
  for (const t of ["keydown", "keyup", "keypress"]) wrap.addEventListener(t, (e) => e.stopPropagation());

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      if (k === "class") e.className = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    }
    for (const c of children || []) if (c !== null && c !== undefined && c !== false) e.append(c);
    return e;
  }

  async function send(msg) {
    try {
      return (await ext.runtime.sendMessage(msg)) || { ok: false, error: "No reply from the extension" };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  // ---------- state ----------
  async function refresh() {
    const r = await send({ type: "get", url: url });
    found = r.ok ? r.found : null;
    render();
  }
  async function loadOpen() {
    try { const r = await ext.storage.local.get("pageBoxOpen"); open = !!(r && r.pageBoxOpen); } catch (e) { /* a convenience */ }
  }
  function setOpen(v) {
    open = v;
    confirmDelete = false;
    note = "";
    try { Promise.resolve(ext.storage.local.set({ pageBoxOpen: v })).catch(function () {}); } catch (e) { /* not fatal */ }
    dirty = false;
    render();
  }

  // ---------- drawing ----------
  function render() {
    const b = found && found.record;
    if (!b) { host.remove(); return; } // not a share page, not a build, or not stored yet
    if (!host.isConnected) document.documentElement.append(host);
    if (dirty && open && wrap.querySelector(".editor")) return; // keep what is being typed
    const fav = b.favorite === true;
    const pill = el("button", { class: "pill", type: "button", title: open ? "Hide PoB Manager" : "Show this build in PoB Manager",
      onclick: () => setOpen(!open) }, ["PoB Manager", fav ? el("span", { class: "star", text: "★" }) : null]);
    wrap.replaceChildren(...(open ? [panel(b), pill] : [pill]));
  }

  function panel(b) {
    const views = F.viewsOf(b);
    const vi = F.defaultViewIndex(b);
    const view = views[vi];
    const fav = b.favorite === true;
    const head = el("div", { class: "head" }, [
      el("button", { class: "icon" + (fav ? " on" : ""), type: "button", text: fav ? "★" : "☆", "aria-pressed": fav ? "true" : "false",
        title: fav ? "Remove from favorites" : "Add to favorites",
        onclick: () => send({ type: "edit", key: b.key, changes: { favorite: !fav } }).then(refresh) }),
      el("span", { class: "name", text: F.displayName(b), title: F.displayName(b) }),
      el("button", { class: "icon", type: "button", text: "×", title: "Hide", onclick: () => setOpen(false) }),
    ]);
    const sub = el("div", { class: "sub", text: [b.creator ? "by " + b.creator : null, b.label,
      b.visits + " visit" + (b.visits === 1 ? "" : "s"), views.length > 1 && view ? "loadout " + view.name + " (" + views.length + " loadouts)" : null]
      .filter(Boolean).join(" · ") });

    const parts = [head, sub];
    if (b.status === "pending") parts.push(el("div", { class: "meta note", text: "Reading build…" }));
    else if (b.status === "error" || !b.info) {
      parts.push(el("div", { class: "meta" }, [el("span", { class: "error", text: b.error || "Could not read this build" })]));
    } else {
      const KIND = { skill: "skill", manual: "skill manual", tag: "tag", dps: "dps" };
      parts.push(el("div", { class: "meta" }, V.summaryParts(b, view).map((p) => el("span", { class: KIND[p.kind] || "", text: p.text, title: p.title || "" }))));
    }
    parts.push(editor(b, vi, views));
    parts.push(el("div", { class: "foot" }, [
      el("a", { href: b.pobUri, title: "Open this build in Path of Building (" + b.pobUri + ")", text: "Open in PoB" }),
      el("span", { class: "spacer" }),
      b.status === "error" ? el("button", { type: "button", text: "Retry",
        onclick: () => { note = "Reading…"; render(); send({ type: "retry", key: b.key }).then(() => { note = ""; refresh(); }); } }) : null,
      el("button", { type: "button", class: "danger", text: confirmDelete ? "Click again to delete" : "Delete",
        title: "Remove this build from PoB Manager. Opening the link again records it again.",
        onclick: () => {
          if (!confirmDelete) { confirmDelete = true; render(); return; }
          confirmDelete = false;
          send({ type: "delete", key: b.key }).then(refresh);
        } }),
    ]));
    return el("div", { class: "panel", role: "dialog", "aria-label": "PoB Manager" }, parts);
  }

  function editor(b, vi, views) {
    const m = V.editorModel(b, vi);
    const nameIn = el("input", { class: "name-in", value: m.name.value, placeholder: m.name.placeholder });
    const creatorIn = el("input", { class: "creator-in", value: m.creator.value, placeholder: m.creator.placeholder });
    const select = (cls, f) => { const s = el("select", { class: cls }, f.options.map(([v, t]) => el("option", { value: v, text: t }))); s.value = f.value; return s; };
    const skillIn = m.mainSkill ? select("main-skill", m.mainSkill) : null;
    const defaultIn = m.defaultView ? select("default-loadout", m.defaultView) : null;
    const saveBtn = el("button", { type: "button", class: "primary", text: "Save", disabled: "disabled", onclick: save });
    const revertBtn = el("button", { type: "button", text: "Revert", disabled: "disabled", onclick: () => { dirty = false; note = ""; render(); } });
    const noteEl = el("span", { class: "note", text: note });
    function changed() {
      dirty = true;
      note = "";
      noteEl.textContent = "";
      saveBtn.disabled = false;
      revertBtn.disabled = false;
    }
    function save() {
      const changes = V.editChanges(m, { name: nameIn.value, creator: creatorIn.value,
        mainSkill: skillIn && skillIn.value, defaultView: defaultIn && defaultIn.value });
      saveBtn.disabled = true;
      send({ type: "edit", key: b.key, changes: changes }).then(function (r) {
        dirty = false;
        note = r.ok ? "Saved" : "Not saved: " + r.error;
        refresh();
      });
    }
    for (const input of [nameIn, creatorIn]) {
      input.addEventListener("input", changed);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); if (dirty) save(); }
        if (e.key === "Escape") { e.preventDefault(); dirty = false; note = ""; render(); }
      });
    }
    for (const s of [skillIn, defaultIn]) if (s) s.addEventListener("change", changed);
    return el("div", { class: "editor" }, [
      el("label", { text: "Name" }), nameIn,
      el("label", { text: "Creator" }), creatorIn,
      skillIn ? el("label", { text: "Main skill", title: views.length > 1 ? "For the loadout on show: " + m.mainSkill.view : "" }) : null, skillIn,
      defaultIn ? el("label", { text: "Default loadout" }) : null, defaultIn,
      el("div", { class: "buttons" }, [saveBtn, revertBtn, noteEl]),
    ]);
  }

  // ---------- wiring ----------
  // Single-page sites (poe.ninja, Maxroll) change the address without loading a page: check it once a second.
  setInterval(function () {
    if (location.href === url) return;
    url = location.href;
    dirty = false;
    confirmDelete = false;
    note = "";
    refresh();
  }, 1000);
  // The background script says when a build changed (this page's visit was read, an edit from the popup).
  ext.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "builds-changed") refresh();
  });
  loadOpen().then(refresh);
})();
