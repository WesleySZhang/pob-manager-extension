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
    await popup.screenshot({ path: shot, fullPage: true });
    console.log("screenshot: " + path.relative(root, shot));
    console.log("PASS");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
