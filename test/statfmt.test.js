// src/statfmt.js. References: LuaJIT 2.1 (PoE-Sim's .local/luajit, the engine PoB runs on) string.format output for the
// same numbers, run Nov 8, 2026, and PoB v2.67.2 Modules/Build.lua buildMode:FormatStat / Common.lua formatNumSep.
// Exact strings.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/statfmt.js");

test('"%d" truncates toward zero, like LuaJIT', () => {
  // LuaJIT: string.format("%d", v) for 3.7, -3.7, 2.5, 3.5, -2.5, 0.5, 1e15+0.5 -> 3 -3 2 3 -2 0 1000000000000000
  assert.deepEqual([3.7, -3.7, 2.5, 3.5, -2.5, 0.5, 1e15 + 0.5].map((v) => S.luaFormat("d", v)), ["3", "-3", "2", "3", "-2", "0", "1000000000000000"]);
});

test('"%.Nf" rounds the exact double half to even, like LuaJIT (not like toFixed)', () => {
  // LuaJIT: %.2f / %.0f of 0.125, 0.375, 2.675, 1.005, 0.05, 2.5, 3.5 -> 0.12|0 0.38|0 2.67|3 1.00|1 0.05|0 2.50|2 3.50|4
  const v = [0.125, 0.375, 2.675, 1.005, 0.05, 2.5, 3.5];
  assert.deepEqual(v.map((x) => S.luaFormat(".2f", x)), ["0.12", "0.38", "2.67", "1.00", "0.05", "2.50", "3.50"]);
  assert.deepEqual(v.map((x) => S.luaFormat(".0f", x)), ["0", "0", "3", "1", "0", "2", "4"]);
  assert.equal((0.125).toFixed(2), "0.13", "why toFixed is not used");
});

test("signs, infinity, NaN, literal suffixes", () => {
  assert.equal(S.luaFormat("+d%%", 20), "+20%");
  assert.equal(S.luaFormat("+.1f", -3.25), "-3.2");
  assert.equal(S.luaFormat(".1f", -0.04), "-0.0");
  assert.equal(S.luaFormat(".0f", Infinity), "inf"); // LuaJIT: string.format("%.0f", math.huge) -> inf
  assert.equal(S.luaFormat("+d", -Infinity), "-inf");
  assert.equal(S.luaFormat(".3fs", 1.5), "1.500s");
  assert.equal(S.luaFormat(".1fm", 2), "2.0m");
  assert.throws(() => S.luaFormat("x", 1), /Unsupported stat format/);
});

test("exact decimal expansion of a double", () => {
  const e = S.exactDecimal(0.125);
  assert.deepEqual([e.int, e.frac.replace(/0+$/, "")], ["0", "125"], "all of the double's decimal places, so trailing zeros");
  const k = S.exactDecimal(1024);
  assert.deepEqual([k.int, /^0*$/.test(k.frac)], ["1024", true]);
  assert.deepEqual(S.exactDecimal(2 ** 60), { int: String(2n ** 60n), frac: "" }, "a positive exponent");
  assert.equal(S.exactDecimal(0.1).frac.slice(0, 20), "10000000000000000555");
  assert.equal(S.exactDecimal(5e-324).int, "0", "subnormal");
});

test("FormatStat: pc and mod scaling, trailing zeros, separators, over-cap", () => {
  assert.equal(S.formatStat(5.82, { f: "d%%", pc: 1 }), "582%");
  assert.equal(S.formatStat(1.2, { f: "+d%%", mod: 1 }), "+20%");
  assert.equal(S.formatStat(1234567.891, { f: ".1f" }), "1,234,567.9");
  assert.equal(S.formatStat(12, { f: ".2f" }), "12");
  assert.equal(S.formatStat(45.5, { f: ".3f%%" }), "45.5%");
  assert.equal(S.formatStat(75, { f: "d%%" }, 34.6), "75% (+34%)");
  assert.equal(S.formatStat(75, { f: "d%%" }, 0), "75%");
  assert.equal(S.formatStat(-1234.5, { f: ".1f" }), "-1,234.5");
  assert.equal(S.numSep("100"), "100");
  assert.equal(S.numSep("1000000 and 2500.25"), "1,000,000 and 2,500.25");
});
