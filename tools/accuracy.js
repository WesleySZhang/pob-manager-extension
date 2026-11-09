// Accuracy check: reads real builds with src/buildinfo.js and with headless Path of Building v2.67.2
// (tools/pob_fields.lua), and compares class, ascendancy, level, main skill, keystones and uniques. Exact match:
// both sides read the same build XML, and PoB is the reference.
// Usage: node tools/accuracy.js [source ...]
//   A source is a folder (searched recursively) or file: *.xml (build XML), *.txt (a PoB code), *.json with a "code"
//   field (PoE-Sim's poe.ninja sweep). Default: ../PoE-Sim/.local/ninja and ../PoE-Sim/tests/golden.
// Real builds hold account names, so everything this writes goes in .local/accuracy (gitignored).
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");
const { readBuild } = require("../src/buildinfo.js");
const data = require("../data/pobdata.js");

const root = path.join(__dirname, "..");
const work = path.join(root, ".local", "accuracy");
const sources = process.argv.slice(2);
if (sources.length === 0) sources.push(path.join(root, "..", "PoE-Sim", ".local", "ninja"), path.join(root, "..", "PoE-Sim", "tests", "golden"));

function decodeCode(code) {
  return zlib.inflateSync(Buffer.from(code.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8");
}

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) yield* walk(path.join(p, f));
  else yield p;
}

function loadXml(file) {
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".xml")) return text;
  if (file.endsWith(".txt")) return /^\s*</.test(text) ? null : decodeCode(text);
  if (file.endsWith(".json")) {
    let j;
    try { j = JSON.parse(text); } catch (e) { return null; }
    return j && typeof j.code === "string" ? decodeCode(j.code) : null;
  }
  return null;
}

function main() {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, "xml"), { recursive: true });
  const builds = [];
  for (const src of sources) {
    for (const file of walk(src)) {
      let xml;
      try { xml = loadXml(file); } catch (e) { console.log("skip " + file + ": " + e.message); continue; }
      if (!xml) continue;
      const out = path.join(work, "xml", builds.length + ".xml").replace(/\\/g, "/");
      fs.writeFileSync(out, xml);
      builds.push({ source: file, xmlPath: out, xml: xml });
    }
  }
  console.log(builds.length + " builds");
  fs.writeFileSync(path.join(work, "list.txt"), builds.map((b) => b.xmlPath).join("\n") + "\n");
  const pobOut = path.join(work, "pob.jsonl");
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "pob_fields.ps1"),
    path.join(work, "list.txt"), pobOut], { stdio: ["ignore", "ignore", "inherit"], maxBuffer: 1 << 28 });
  const pob = new Map();
  for (const line of fs.readFileSync(pobOut, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    pob.set(r.file, r);
  }

  const fields = ["className", "ascendancy", "level", "mainSkill", "keystones", "uniques"];
  let loadoutsCompared = 0;
  const autoLevelDiffs = [];
  const mismatches = Object.fromEntries(fields.concat(["loadouts"]).map((f) => [f, []]));
  let compared = 0, pobErrors = 0, readerErrors = 0;
  for (const b of builds) {
    const p = pob.get(b.xmlPath);
    if (!p || p.error) { pobErrors++; console.log("PoB could not load " + b.source + ": " + (p ? p.error : "no result")); continue; }
    let r;
    try { r = readBuild(b.xml, data); } catch (e) { readerErrors++; mismatches.className.push({ b, want: "a build", got: e.message }); continue; }
    compared++;
    // Level: the reader shows the level the build was saved with. With characterLevelAutoMode="true", PoB re-estimates
    // the level from the tree's points on load (Build.lua EstimatePlayerProgress), so the two can differ by design;
    // those builds are counted and listed, not compared.
    const autoLevel = /<Build\b[^>]*characterLevelAutoMode="true"/.test(b.xml);
    if (autoLevel && p.level !== r.level) autoLevelDiffs.push(path.relative(root, b.source) + ": saved " + r.level + ", PoB Auto " + p.level);
    for (const f of fields) {
      if (f === "level" && autoLevel) continue;
      const want = Array.isArray(p[f]) ? p[f].join(" / ") : p[f];
      const got = Array.isArray(r[f]) ? r[f].join(" / ") : r[f];
      if (want !== got) mismatches[f].push({ b, want, got });
    }
    // Loadouts: the same names in the same order, and each loadout's fields as PoB shows them once it is selected.
    const pl = p.loadouts || [];
    const names = (list) => list.map((l) => l.name).join(" | ");
    if (names(pl) !== names(r.loadouts)) mismatches.loadouts.push({ b, want: names(pl), got: names(r.loadouts) });
    else {
      loadoutsCompared += pl.length;
      pl.forEach((want, i) => {
        for (const f of ["className", "ascendancy", "mainSkill", "keystones", "uniques"]) {
          const w = Array.isArray(want[f]) ? want[f].join(" / ") : want[f];
          const g = Array.isArray(r.loadouts[i][f]) ? r.loadouts[i][f].join(" / ") : r.loadouts[i][f];
          if (w !== g) mismatches.loadouts.push({ b, want: want.name + " " + f + ": " + w, got: g });
        }
      });
    }
  }
  console.log("loadouts compared: " + loadoutsCompared);
  console.log("Auto-level builds where PoB's estimate differs from the saved level (not a failure): " + autoLevelDiffs.length);
  for (const d of autoLevelDiffs.slice(0, 5)) console.log("     " + d);
  let failed = pobErrors + readerErrors;
  console.log("compared " + compared + ", PoB load errors " + pobErrors + ", reader errors " + readerErrors);
  for (const f of fields.concat(["loadouts"])) {
    const list = mismatches[f];
    failed += list.length;
    console.log((list.length ? "FAIL " : "ok   ") + f + ": " + list.length + " mismatches");
    for (const m of list.slice(0, 8)) {
      console.log("     " + path.relative(root, m.b.source) + " (" + path.basename(m.b.xmlPath) + ")\n       PoB:    " + m.want + "\n       reader: " + m.got);
    }
  }
  if (compared === 0) { console.log("FAIL nothing was compared"); failed++; }
  console.log(failed ? "FAIL" : "PASS");
  process.exit(failed ? 1 : 0);
}

main();
