// Measures, in real Edge, what opening a new share link costs (README, "How fast"):
//  - the share page's own load time (DOMContentLoaded and load) with the extension and without it;
//  - how long after the navigation starts the build is stored and read ("in the list");
//  - the extension's own steps for that read (record.timing: download, decode, read, save).
// Every run uses a fresh browser profile, so every link is new to the extension and nothing is cached.
// Usage: node tools/e2e/measure.js [runs, default 3] [share link ...]   (npm run build first)
"use strict";
const puppeteer = require("puppeteer-core");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const ext = path.join(root, "dist", "chrome");
const args = process.argv.slice(2);
const runs = /^\d+$/.test(args[0] || "") ? Number(args.shift()) : 3;
const links = args.length ? args : [
  "https://pobb.in/2FlZU8rRPp3F",
  "https://pobb.in/agb0V8xT8c-j",
  "https://poe.ninja/poe1/pob/934b3",
  "https://poe.ninja/pob/igw",
];
const PAUSE_MS = Number(process.env.MEASURE_PAUSE_MS || 15000);
const executablePath = process.env.E2E_CHROMIUM || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const KEY = { "pobb.in": (u) => "pobbin:" + u.pathname.slice(1), "poe.ninja": (u) => "poeninja:" + u.pathname.split("/").pop() };

async function pageTimes(page) {
  return page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
  });
}

/** One fresh browser: open each link, then (with the extension) wait for each build to be stored and read. */
async function run(withExtension) {
  const browser = await puppeteer.launch({ executablePath, headless: true,
    args: ["--no-first-run"].concat(withExtension ? ["--disable-extensions-except=" + ext, "--load-extension=" + ext] : []) });
  try {
    let extId = null;
    if (withExtension) {
      const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/src/background.js"), { timeout: 15000 });
      extId = new URL(sw.url()).host;
    }
    const page = await browser.newPage();
    const out = [];
    for (const link of links) {
      const started = Date.now();
      await page.goto(link, { waitUntil: "load", timeout: 60000 }).catch(() => {});
      out.push({ link: link, started: started, page: await pageTimes(page) });
    }
    if (withExtension) {
      const popup = await browser.newPage();
      await popup.goto("chrome-extension://" + extId + "/popup/popup.html");
      for (const r of out) {
        const u = new URL(r.link);
        const key = KEY[u.hostname](u);
        // Waiting on the store is this script's job: it watches for the build the extension reads in the background.
        const rec = await popup.waitForFunction(async (k) => {
          const s = await globalThis.PobStore.open(indexedDB);
          try { const b = await s.getBuild(k); return b && b.status !== "pending" ? b : false; } finally { s.close(); }
        }, { timeout: 60000, polling: 25 }, key).then((h) => h.jsonValue());
        r.status = rec.status;
        r.error = rec.error;
        r.inListMs = rec.readAt - r.started;
        r.timing = rec.timing;
      }
    }
    return out;
  } finally {
    await browser.close();
  }
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const fmt = (xs) => xs.length ? median(xs) + " (" + Math.min(...xs) + "–" + Math.max(...xs) + ")" : "—";

(async () => {
  const withExt = [], without = [];
  for (let i = 0; i < runs; i++) {
    // A pause between browsers, so the measuring itself doesn't trip the sites' rate limits (pobb.in answers 429).
    if (i > 0) await new Promise((r) => setTimeout(r, PAUSE_MS));
    without.push(await run(false));
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    withExt.push(await run(true));
    process.stdout.write("run " + (i + 1) + "/" + runs + " done\n");
  }
  console.log("\nMedian (min–max) over " + runs + " runs, milliseconds. Fresh profile per run.\n");
  console.log("| Link | Page load without | Page load with | Build in list after | Download | Decode | Read | Save | Code / XML size |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  links.forEach((link, i) => {
    const w = withExt.map((r) => r[i]), wo = without.map((r) => r[i]);
    const t = (k) => fmt(w.filter((r) => r.timing).map((r) => r.timing[k]));
    const size = w.find((r) => r.timing);
    console.log("| " + link.replace("https://", "") + " | " + fmt(wo.map((r) => r.page.load)) + " | " + fmt(w.map((r) => r.page.load)) +
      " | " + fmt(w.map((r) => r.inListMs)) + " | " + t("downloadMs") + " | " + t("decodeMs") + " | " + t("readMs") + " | " + t("saveMs") +
      " | " + (size ? Math.round(size.timing.codeBytes / 1024) + " KB / " + Math.round(size.timing.xmlBytes / 1024) + " KB" : "—") + " |");
  });
  const retried = withExt.flat().filter((r) => r.timing && r.timing.downloads > 1);
  if (retried.length) console.log("\nRetried after a 429 (the wait counts as download time): " + retried.map((r) => r.link).join(", "));
  const bad = withExt.flat().filter((r) => r.status !== "ok");
  if (bad.length) { console.log("\nNot read: " + bad.map((r) => r.link + " (" + r.status + ": " + r.error + ")").join(", ")); process.exitCode = 1; }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
