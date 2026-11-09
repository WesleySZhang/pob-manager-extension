// data/leagues.js (tools/gen_leagues.js) against the PoE wiki vault's league pages: wiki/leagues/*.md, poewiki Cargo
// `events` rows (data_version "poewiki Cargo 2026-10-30"). Tolerance: exact.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const leagues = require("../data/leagues.js");
const { challengeRows } = require("../tools/gen_leagues.js");

const vault = process.env.POE_WIKI || "C:/Users/Wesley/Documents/Obsidian/PoE";

test("challengeRows reads the Challenge league row of a page", () => {
  const md = [
    "| Event | Type | Release version | Release date | End date | Standard | Hardcore | Links |",
    "|---|---|---|---|---|---|---|---|",
    "| Affliction | Expansion | 3.23.0 | 2023-12-08 00:00:00 |  |  |  |  |",
    "| Affliction league | Challenge league | 3.23.0 | 2023-12-08 19:00:00 | 2024-03-26 21:00:00 | 1 | 1 | x |",
    "| Odd league | Challenge league | unknown | | | | | |",
  ].join("\n");
  assert.deepEqual(challengeRows(md), [{ name: "Affliction", version: "3.23.0", start: "2023-12-08T19:00:00Z", end: "2024-03-26T21:00:00Z" }]);
});

test("the generated table matches the wiki vault", () => {
  const dir = path.join(vault, "wiki", "leagues");
  assert.ok(fs.existsSync(dir), "PoE wiki vault expected at " + vault + " (set POE_WIKI)");
  const fresh = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
    for (const row of challengeRows(fs.readFileSync(path.join(dir, f), "utf8"))) fresh.push(Object.assign(row, { page: "wiki/leagues/" + f }));
  }
  fresh.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  assert.deepEqual(leagues, fresh);
});

test("one challenge league per 3.x patch, and known entries", () => {
  const byPatch = {};
  for (const l of leagues) {
    const p = l.version.split(".").slice(0, 2).join(".");
    (byPatch[p] = byPatch[p] || []).push(l.name);
  }
  for (const [p, names] of Object.entries(byPatch)) if (p.startsWith("3.")) assert.equal(names.length, 1, p + ": " + names);
  // wiki/leagues/Keepers league.md and Allflame league (league).md
  assert.deepEqual(leagues.find((l) => l.name === "Keepers"), { name: "Keepers", version: "3.27.0", start: "2025-10-31T19:00:00Z", end: "2026-03-02T21:00:00Z", page: "wiki/leagues/Keepers league.md" });
  assert.equal(leagues.find((l) => l.version === "3.29.0").name, "Allflame");
});
