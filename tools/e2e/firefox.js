// End-to-end (Firefox): install dist/firefox, visit a real share link and a page that must not be recorded, then open
// the popup page and rename the build. That last step goes through runtime.sendMessage, the promise-only API that
// differs from Chrome. Makes real GET requests to the sites. Screenshot: .local/e2e-firefox.png.
// Usage: npm run e2e:firefox [-- <share link>]   (E2E_FIREFOX overrides the browser path)
"use strict";
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const src = path.join(root, "dist", "firefox");
const ext = path.join(root, ".local", "e2e-firefox-ext");
// Firefox's automation can't navigate to a moz-extension:// page, so a test-only copy of the extension opens its popup
// page in a tab when it sees this URL (poe.ninja is a host it may read; the URL is no share link).
const OPEN_POPUP = "https://poe.ninja/__pob_manager_e2e_open_popup";
const shot = path.join(root, ".local", "e2e-firefox.png");
const link = process.argv[2] || "https://poe.ninja/poe1/pob/934b3"; // given by Wesley, Nov 8, 2026
// A fixed internal UUID, so the popup page has a known address (Firefox pref extensions.webextensions.uuids).
const UUID = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
const ID = JSON.parse(fs.readFileSync(path.join(src, "manifest.json"), "utf8")).browser_specific_settings.gecko.id;

function makeTestCopy() {
  fs.rmSync(ext, { recursive: true, force: true });
  fs.cpSync(src, ext, { recursive: true });
  const bg = path.join(ext, "src", "background.js");
  fs.appendFileSync(bg, [
    "",
    "// e2e only (tools/e2e/firefox.js)",
    "browser.tabs.onUpdated.addListener(function (id, info) {",
    "  if (info.url === " + JSON.stringify(OPEN_POPUP) + ") browser.tabs.update(id, { url: browser.runtime.getURL('popup/popup.html') });",
    "});",
    "",
  ].join("\n"));
}

function check(cond, msg) {
  if (!cond) throw new Error("FAIL " + msg);
  console.log("ok   " + msg);
}

(async () => {
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  makeTestCopy();
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: process.env.E2E_FIREFOX || "C:/Program Files/Mozilla Firefox/firefox.exe",
    headless: true,
    // Needed to script a moz-extension:// page over WebDriver BiDi.
    env: Object.assign({}, process.env, { MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: "1" }),
    extraPrefsFirefox: { "extensions.webextensions.uuids": JSON.stringify({ [ID]: UUID }) },
  });
  try {
    const id = await browser.installExtension(ext);
    console.log("installed " + id + ", " + (await browser.version()));
    const page = await browser.newPage();
    for (const url of ["https://poe.ninja/poe1/builds", link]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("     (page load: " + e.message + ")"));
    }
    const popup = await browser.newPage();
    await popup.goto(OPEN_POPUP, { waitUntil: "domcontentloaded" }).catch(() => {});
    await popup.waitForFunction(() => location.protocol === "moz-extension:" && document.getElementById("list"), { timeout: 20000, polling: 200 }).catch(() => {});
    console.log("     popup page: " + popup.url());
    await popup.waitForFunction(() => {
      const rows = document.querySelectorAll(".build");
      return rows.length === 1 && !/Reading build/.test(rows[0].textContent);
    }, { timeout: 60000 }).catch(() => {});
    const rows = await popup.$$eval(".build", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
    for (const r of rows) console.log("     row: " + r);
    if (rows.length === 0) console.log("     (no rows: if host access isn't granted, Firefox hides the tab URLs from the extension)");
    check(rows.length === 1, "1 build recorded, the ladder not");
    check(!/Could not|HTTP/.test(rows[0]), "the build was read");

    await popup.$eval(".build button.icon", (b) => b.click());
    await popup.waitForSelector(".editor input");
    const inputs = await popup.$$(".editor input");
    await inputs[0].type("Firefox rename");
    await inputs[0].press("Enter");
    await popup.waitForFunction(() => Array.from(document.querySelectorAll(".build .name")).some((n) => n.textContent === "Firefox rename"), { timeout: 10000 });
    check(true, "rename saved through the background script");
    await popup.screenshot({ path: shot });
    console.log("screenshot: " + path.relative(root, shot));
    console.log("PASS");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
