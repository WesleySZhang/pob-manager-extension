// End-to-end (Edge/Chromium): load dist/chrome, visit real share links and pages that must not be recorded, then use
// the popup page: the list, search, the patch filter, renaming and the creator field. Makes real GET requests to the
// sites (the same ones a visit makes). Screenshot: .local/e2e-edge.png.
// Usage: npm run e2e:edge [-- <share link> ...]   (E2E_CHROMIUM overrides the browser path)
"use strict";
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const ext = path.join(root, "dist", "chrome");
const shot = path.join(root, ".local", "e2e-edge.png");
const builds = process.argv.slice(2).length ? process.argv.slice(2) : [
  "https://poe.ninja/poe1/pob/934b3", // given by Wesley, Nov 8, 2026
  "https://pobb.in/agb0V8xT8c-j", // shared by Wesley (PoE-Sim tests/golden/README.md)
  "https://pobb.in/2FlZU8rRPp3F", // given by Wesley, Nov 8, 2026: PoB's main skill is Ambush, the build is Static Strike
];
const notBuilds = [
  "https://poe.ninja/poe1/builds", // the ladder: never recorded
  "https://pobb.in/about",
];

function check(cond, msg) {
  if (!cond) throw new Error("FAIL " + msg);
  console.log("ok   " + msg);
}

(async () => {
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: process.env.E2E_CHROMIUM || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    headless: true,
    args: ["--disable-extensions-except=" + ext, "--load-extension=" + ext, "--no-first-run"],
  });
  try {
    const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/src/background.js"), { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const page = await browser.newPage();
    for (const url of notBuilds.concat(builds)) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("     (page load: " + e.message + ")"));
    }
    // A second visit of the first build counts again.
    await page.goto(builds[0], { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});

    const popup = await browser.newPage();
    popup.on("pageerror", (e) => console.log("     popup error: " + e.message));
    popup.on("console", (m) => { if (m.type() === "error") console.log("     popup console: " + m.text()); });
    await popup.setViewport({ width: 560, height: 600 });
    await popup.goto("chrome-extension://" + extId + "/popup/popup.html");
    await popup.waitForFunction((n) => {
      const rows = document.querySelectorAll(".build");
      return rows.length === n && Array.from(rows).every((r) => !/Reading build/.test(r.textContent));
    }, { timeout: 60000 }, builds.length);
    const rows = await popup.$$eval(".build", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    for (const r of rows) console.log("     row: " + r);
    check(rows.length === builds.length, builds.length + " builds recorded, the ladder and pobb.in/about not");
    check(rows.every((r) => !/Could not|no build|HTTP/.test(r)), "every build read without error");
    const visits = await popup.evaluate(async () => {
      const s = await globalThis.PobStore.open(indexedDB);
      const all = await s.allBuilds();
      s.close();
      return all.map((b) => [b.key, b.visits, b.status, b.info && b.info.mainSkill]);
    });
    console.log("     stored: " + JSON.stringify(visits));
    check(visits.find((v) => v[0] === "poeninja:934b3")[1] === 2, "the repeat visit counted (2 visits)");

    // Search by skill.
    await popup.type("#search", "winter orb");
    await popup.waitForFunction(() => document.querySelectorAll(".build").length === 1);
    check((await popup.$eval(".build .name", (e) => e.textContent)) === "Winter Orb Occultist", "skill search finds the Winter Orb build by its generated name");
    await popup.$eval("#search", (e) => { e.value = ""; e.dispatchEvent(new Event("input")); });

    // Patch drop-down lists the patches with their league.
    const patches = await popup.$$eval("#patch option", (os) => os.map((o) => o.textContent));
    console.log("     patches: " + patches.join(" | "));
    check(patches.some((p) => /^3\.28 · Mirage$/.test(p)), "patch drop-down shows 3.28 · Mirage");

    // Rename and creator through the editor; both become searchable.
    await popup.waitForFunction(() => document.querySelectorAll(".build").length > 1);
    await popup.$$eval(".build", (els) => { const r = els.find((e) => /Winter Orb/.test(e.textContent)); r.querySelector("button.icon").click(); });
    await popup.waitForSelector(".editor input");
    check(await popup.$$eval(".build.open", (els) => els.length === 0), "opening the ✎ editor does not expand the row");
    const inputs = await popup.$$(".editor input");
    await inputs[0].type("CI Orb test");
    await inputs[1].type("Test Creator");
    await inputs[1].press("Enter");
    await popup.waitForFunction(() => !document.querySelector(".editor") && Array.from(document.querySelectorAll(".build .name")).some((n) => n.textContent === "CI Orb test"), { timeout: 10000 });
    check(true, "rename saved");
    await popup.type("#search", "test creator");
    await popup.waitForFunction(() => document.querySelectorAll(".build").length === 1);
    check((await popup.$eval(".build .by", (e) => e.textContent)) === "by Test Creator", "creator saved and searchable");
    const creators = await popup.$$eval("#creator option", (os) => os.map((o) => o.textContent));
    check(creators.includes("Test Creator"), "creator listed in the Creator filter");
    await popup.$eval("#search", (e) => { e.value = ""; e.dispatchEvent(new Event("input")); });
    // Our main skill pick, then a main skill and a default loadout set by hand (only when the default build list is used).
    if (builds.includes("https://pobb.in/2FlZU8rRPp3F")) {
      const rowText = () => popup.$$eval(".build", (els) => { const r = els.find((e) => e.dataset.link === "https://pobb.in/2FlZU8rRPp3F"); return r && r.innerText.replace(/\s+/g, " "); });
      const openEditor = () => popup.$$eval(".build", (els) => els.find((e) => e.dataset.link === "https://pobb.in/2FlZU8rRPp3F").querySelector("button.icon").click());
      check(/^[☆★]? ?Static Strike Slayer/.test(await rowText()), "the Ambush-saved build is named Static Strike Slayer");
      await openEditor();
      await popup.waitForSelector(".editor select.main-skill");
      await popup.select(".editor select.main-skill", "Ambush");
      await popup.click(".editor button.primary");
      await popup.waitForFunction(() => !document.querySelector(".editor"));
      await popup.waitForFunction(() => Array.from(document.querySelectorAll(".build .name")).some((n) => n.textContent === "Ambush Slayer"), { timeout: 10000 });
      check(true, "a main skill set by hand renames the build to Ambush Slayer");
      await openEditor();
      await popup.waitForSelector(".editor select.default-loadout");
      await popup.select(".editor select.default-loadout", "Endgame Red Maps");
      await popup.click(".editor button.primary");
      await popup.waitForFunction(() => !document.querySelector(".editor"));
      // The loadout is in the expanded part: expand the row (the editor no longer does).
      await popup.$$eval(".build", (els) => els.find((e) => e.dataset.link === "https://pobb.in/2FlZU8rRPp3F").querySelector(".meta").click());
      const chip = '.build[data-link="https://pobb.in/2FlZU8rRPp3F"] .details .loadout';
      await popup.waitForFunction((c) => { const s = document.querySelector(c + " .v"); return s && s.textContent === "Endgame Red Maps"; }, { timeout: 10000 }, chip);
      check(await popup.$$eval(".build .details select", (els) => els.length === 0), "the expanded row shows the default loadout (set in the editor), with nothing to pick");
      // Information on hover only: the card lists every loadout, the saved one and the default marked.
      const popShown = () => popup.$eval(chip + " .loadout-pop", (p) => getComputedStyle(p).display !== "none");
      check(!(await popShown()), "the loadout list is hidden until hovered");
      await popup.hover(chip);
      const pop = await popup.$eval(chip + " .loadout-pop", (p) => ({ shown: getComputedStyle(p).display !== "none",
        items: Array.from(p.querySelectorAll(".item")).map((i) => i.innerText.replace(/\s+/g, " ").trim()), clickable: p.querySelectorAll("button, select, a, input").length }));
      console.log("     hover: " + JSON.stringify(pop.items));
      await popup.screenshot({ path: shot.replace(/\.png$/, "-loadouts.png") });
      check(pop.shown && pop.items.length === 8 && pop.items.includes("Midgame saved · stats") && pop.items.includes("Endgame Red Maps default") && pop.clickable === 0,
        "hovering the loadout lists all 8 loadouts, marks the saved and default ones, and offers nothing to click");
      await popup.mouse.move(0, 0);
      await popup.waitForFunction(() => true);
      const row = await rowText();
      console.log("     row: " + row);
      check(/^[☆★]? ?Static Strike Slayer/.test(row), "the default loadout (Endgame Red Maps) is shown first and names the build");
      check(!/Stats exist only|Visited|Main skill/.test(row) && await popup.$$eval(".details .facts", (els) => els.length === 0),
        "the expanded row has no facts block (class, main skill, tree, level, visits) and no unsaved-loadout note");
      check(/KEYSTONES/.test(row) && !/UNIQUES|SKILLS/.test(row), "the expanded row lists keystones but not uniques or skills");
      // The saved stats (Midgame: PoB's <PlayerStat>, Life 4,089 as pobb.in shows) apply whichever loadout is the default.
      const lifeShown = await popup.$eval('.build[data-link="https://pobb.in/2FlZU8rRPp3F"] .details .stat[data-stat="Life"] .v', (v) => v.textContent).catch(() => null);
      check(/· 4\.09k Life/.test(row) && !/— Life/.test(row) && lifeShown === "4,089",
        "with Endgame Red Maps as default, the row and panel show the saved stats (Life " + lifeShown + ")");
    }
    // Clicking a row expands it (no new tab) to PoB's left-panel stats; "Open link" opens the share page.
    const tabsBefore = (await browser.pages()).length;
    // The ✎ editor does not expand its row (checked below); collapse the row first if an earlier step left it open.
    const rowOpen = () => popup.$$eval(".build", (els) => els.find((e) => e.dataset.link === "https://poe.ninja/poe1/pob/934b3").classList.contains("open"));
    const clickRow = () => popup.$$eval(".build", (els) => els.find((e) => e.dataset.link === "https://poe.ninja/poe1/pob/934b3").querySelector(".meta").click());
    if (await rowOpen()) { await clickRow(); await popup.waitForFunction(() => !document.querySelector('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"]')); }
    await clickRow();
    await popup.waitForFunction(() => document.querySelector('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .details .stats'), { timeout: 5000 });
    const detail = await popup.$eval('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"]', (r) => ({
      stats: Object.fromEntries(Array.from(r.querySelectorAll(".stat")).map((s) => [s.dataset.stat, s.querySelector(".v").textContent])),
      buttons: Array.from(r.querySelectorAll(".details .actions button")).map((x) => x.textContent),
    }));
    console.log("     expanded: " + JSON.stringify(detail.stats).slice(0, 300) + "…");
    check((await browser.pages()).length === tabsBefore, "clicking a row expands it and opens no tab");
    check(detail.stats.FireResist === "75% (+16%)" && detail.stats.ChaosMaximumHitTaken === "Immune" && detail.stats.FrenzyChargesMax === "12 / 12",
      "expanded row shows resistances with over-cap, max hits (CI: chaos Immune) and charges");
    check(["EffectiveBlockChance", "EffectiveSpellBlockChance", "EffectiveSpellSuppressionChance", "Armour", "Evasion", "PhysicalMaximumHitTaken"].every((k) => k in detail.stats),
      "block, spell block, suppression, armour, evasion and phys max hit are listed");
    // Regression: selecting text in an expanded row collapsed it on mouse-up. A drag that starts in the details and
    // ends on the row's summary line fires a click on the row itself, which used to toggle it shut.
    const box = async (sel) => { const h = await popup.$(sel); await h.scrollIntoView(); const b = await h.boundingBox(); return { x: b.x + 4, y: b.y + b.height / 2 }; };
    const from = await box('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .details .stat .v');
    const to = await box('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .meta');
    await popup.mouse.move(from.x, from.y); await popup.mouse.down(); await popup.mouse.move(to.x, to.y, { steps: 8 }); await popup.mouse.up();
    await new Promise((r) => setTimeout(r, 200));
    const selected = await popup.evaluate(() => String(getSelection()).length);
    check(selected > 0 && await rowOpen(), "selecting text in an expanded row keeps it open (selected " + selected + " chars)");
    await popup.evaluate(() => getSelection().removeAllRanges());
    const rowButtons = await popup.$eval('.build[data-link="https://poe.ninja/poe1/pob/934b3"]', (r) => Array.from(r.querySelectorAll(".line > button.rowbtn")).map((x) => x.textContent));
    check(rowButtons.join() === "Open link,Open in PoB", "the row itself has Open link and Open in PoB buttons");
    check(!detail.buttons.includes("Copy link") && !detail.buttons.includes("Open link"), "no Copy link button, and the buttons are not repeated in the details");
    const opened = new Promise((resolve) => browser.once("targetcreated", (t) => resolve(t.url())));
    await popup.$eval('.build[data-link="https://poe.ninja/poe1/pob/934b3"] button.rowbtn.primary', (b) => b.click());
    check((await opened).startsWith("https://poe.ninja/poe1/pob/934b3"), "Open link opens the share page");
    await popup.bringToFront();
    await popup.$eval('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .meta', (m) => m.click());
    await popup.waitForFunction(() => !document.querySelector('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"]'));
    check(true, "clicking again collapses it");

    // Favorites: the filter with none, star one build, the filter shows just that one.
    await popup.click("#favorites");
    await popup.waitForFunction(() => /No favorites yet/.test(document.getElementById("list").textContent));
    check(true, "favorites filter with nothing starred says so");
    await popup.click("#favorites");
    await popup.waitForFunction((n) => document.querySelectorAll(".build").length === n, {}, builds.length);
    await popup.$$eval(".build", (els) => els.find((e) => e.dataset.link === "https://pobb.in/agb0V8xT8c-j").querySelector("button.star").click());
    await popup.waitForFunction(() => document.querySelectorAll(".build button.star.on").length === 1);
    await popup.click("#favorites");
    await popup.waitForFunction(() => document.querySelectorAll(".build").length === 1);
    check((await popup.$eval(".build", (e) => e.dataset.link)) === "https://pobb.in/agb0V8xT8c-j", "starred build is the only one under Favorites");
    await popup.screenshot({ path: shot, fullPage: true });
    await popup.click("#favorites");
    console.log("screenshot: " + path.relative(root, shot));
    // Every row expanded at once: each open row is a card of its own (gap, border), so neighbours stay apart.
    await popup.waitForFunction((n) => document.querySelectorAll(".build").length === n, {}, builds.length);
    // (Rows an earlier step left open stay open; expand the rest one by one.)
    while (await popup.$$eval(".build:not(.open)", (els) => els.length) > 0) {
      const before = await popup.$$eval(".build.open", (els) => els.length);
      await popup.$$eval(".build:not(.open) .meta", (els) => els[0].click());
      await popup.waitForFunction((n) => document.querySelectorAll(".build.open").length === n, {}, before + 1);
    }
    const gaps = await popup.$$eval(".build.open", (els) => els.slice(1).map((e, i) => e.getBoundingClientRect().top - els[i].getBoundingClientRect().bottom));
    check(gaps.every((g) => g >= 6), "expanded rows are separated by a gap (" + gaps.join(", ") + " px)");
    // Bottom line: the loadout chip, then Delete to its right, as the last line of the expanded row.
    const layout = await popup.$$eval(".build.open .details", (ds) => ds.map((d) => {
      const last = d.lastElementChild, del = last.querySelector("button.danger"), chip = last.querySelector(".loadout");
      const sameLine = chip ? Math.abs(chip.getBoundingClientRect().top - del.getBoundingClientRect().top) < 6 : true;
      return { deleteLast: !!del, chip: !!chip, rightOfChip: chip ? del.getBoundingClientRect().left > chip.getBoundingClientRect().right && sameLine : null };
    }));
    check(layout.length > 0 && layout.every((x) => x.deleteLast), "Delete is on the bottom line of every expanded row");
    check(layout.some((x) => x.chip) && layout.every((x) => x.rightOfChip !== false), "on builds with loadouts, Delete is right of the loadout chip on the same line");
    // Three stat columns; a value whose line doesn't fit shows its short form (k, M, B), the full value on hover.
    const cols = await popup.$$eval(".build.open .details .stats", (els) => els.map((e) => getComputedStyle(e).columnCount));
    check(cols.length > 0 && cols.every((c) => c === "3"), "the stats are in three columns");
    const fit = await popup.$$eval(".build.open .details .stat", (els) => els.map((e) => {
      const k = e.querySelector(".k"), v = e.querySelector(".v");
      return { stat: e.dataset.stat, clipped: k.scrollWidth > k.clientWidth, short: !!v.dataset.short, shown: v.textContent, full: v.dataset.full, title: v.title || null };
    }));
    const shortened = fit.filter((f) => f.shown !== f.full);
    console.log("     shortened: " + JSON.stringify(shortened.map((f) => f.stat + " " + f.full + " -> " + f.shown)));
    check(fit.every((f) => !f.clipped || f.shown !== f.full || !f.short), "no line is cut off while its value could still be shortened");
    check(shortened.every((f) => f.title === f.full), "a shortened value shows the full one on hover");
    // At full width nothing may need shortening, so narrow the popup and redraw: long values must switch to k/M/B.
    const fitNarrow = async () => {
      await popup.evaluate(() => { document.body.style.width = "420px"; });
      await popup.$eval('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .meta', (m) => m.click());
      await popup.$eval('.build[data-link="https://poe.ninja/poe1/pob/934b3"] .meta', (m) => m.click());
      await popup.waitForSelector('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .stats');
      return popup.$$eval('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .stat', (els) => els.map((e) => {
        const k = e.querySelector(".k"), v = e.querySelector(".v");
        return { stat: e.dataset.stat, clipped: k.scrollWidth > k.clientWidth, short: v.dataset.short, shown: v.textContent, full: v.dataset.full, title: v.title || null };
      }));
    };
    const narrow = await fitNarrow();
    const narrowShort = narrow.filter((f) => f.shown !== f.full);
    console.log("     narrow (420px) shortened: " + JSON.stringify(narrowShort.map((f) => f.stat + " " + f.full + " -> " + f.shown)));
    check(narrowShort.length > 0 && narrowShort.every((f) => f.shown === f.short && f.title === f.full && /[kMB]$/.test(f.shown)),
      "in a narrow popup, values that don't fit switch to k/M/B, the full value on hover");
    check(narrow.every((f) => !f.clipped || !f.short || f.shown === f.short), "no value with a short form is left long while its line is cut off");
    check(narrow.filter((f) => !f.clipped).every((f) => f.shown === f.full || f.short), "values whose line fits are not shortened needlessly");
    // Back to the real width and redraw: the values return to full.
    await popup.evaluate(() => { document.body.style.width = ""; });
    await popup.$eval('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .meta', (m) => m.click());
    await popup.$eval('.build[data-link="https://poe.ninja/poe1/pob/934b3"] .meta', (m) => m.click());
    await popup.waitForSelector('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .stats');
    check(await popup.$$eval('.build.open[data-link="https://poe.ninja/poe1/pob/934b3"] .stat .v', (vs) => vs.every((v) => v.textContent === v.dataset.full)),
      "at the popup's own width, every value of this build fits in full");
    const shot2 = shot.replace(/\.png$/, "-expanded.png");
    await popup.screenshot({ path: shot2, fullPage: true });
    console.log("screenshot: " + path.relative(root, shot2));
    console.log("PASS");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
