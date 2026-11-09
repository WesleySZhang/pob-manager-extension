// Formats a saved PoB stat the way PoB's sidebar does: Modules/Build.lua buildMode:FormatStat with compact values off,
// thousands separators on (",") and "." for decimals (main.useCompactValues / showThousandsSeparators), using the
// stat's label and format from Modules/BuildDisplayStats.lua (data/pobdata.js statDefs).
// Number formatting copies LuaJIT's string.format: "%d" truncates toward zero, "%.Nf" rounds the double's exact value
// half to even (0.125 -> "0.12", 2.5 -> "2", 3.5 -> "4"); JavaScript's toFixed rounds exact ties up, so it isn't used.
// test/golden.test.js checks this against headless PoB's own FormatStat on every saved stat of the fixture builds.
(function (root) {
  "use strict";

  /** The exact decimal expansion of a finite double's magnitude: { int: "123", frac: "4500..." } (no rounding). */
  function exactDecimal(x) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, Math.abs(x));
    const hi = view.getUint32(0), lo = view.getUint32(4);
    const expBits = (hi >>> 20) & 0x7ff;
    let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    let exp;
    if (expBits === 0) exp = -1074; else { mant |= 1n << 52n; exp = expBits - 1075; }
    if (exp >= 0) return { int: (mant << BigInt(exp)).toString(), frac: "" };
    const k = -exp; // value = mant / 2^k = mant * 5^k / 10^k
    const digits = (mant * 5n ** BigInt(k)).toString().padStart(k + 1, "0");
    return { int: digits.slice(0, digits.length - k), frac: digits.slice(digits.length - k) };
  }

  /** "%.<places>f" as LuaJIT prints it (no sign). */
  function fixed(x, places) {
    const { int, frac } = exactDecimal(x);
    const keep = frac.padEnd(places, "0").slice(0, places);
    const rest = frac.slice(places);
    let n = BigInt(int + keep);
    const first = rest.charCodeAt(0) - 48;
    if (rest.length && first > 5) n += 1n;
    else if (rest.length && first === 5) {
      const beyond = /[1-9]/.test(rest.slice(1));
      if (beyond || n % 2n === 1n) n += 1n; // exact half: to even
    }
    const s = n.toString().padStart(places + 1, "0");
    return places ? s.slice(0, s.length - places) + "." + s.slice(s.length - places) : s;
  }

  /** string.format("%" .. fmt, val) for the formats BuildDisplayStats uses: [+][.N](d|f) then literal text, %% -> %. */
  function luaFormat(fmt, val) {
    const m = /^(\+)?(?:\.(\d+))?([df])(.*)$/.exec(fmt);
    if (!m) throw new Error("Unsupported stat format " + fmt);
    const [, plus, places, kind, rest] = m;
    const tail = rest.replace(/%%/g, "%");
    if (!Number.isFinite(val)) {
      if (Number.isNaN(val)) return (kind === "d" ? "0" : "nan") + tail;
      return (val < 0 ? "-" : plus ? "+" : "") + "inf" + tail;
    }
    let body, negative;
    if (kind === "d") {
      const t = Math.trunc(val);
      negative = t < 0;
      body = String(Math.abs(t));
    } else {
      negative = val < 0 || Object.is(val, -0);
      body = fixed(val, places === undefined ? 6 : Number(places));
    }
    return (negative ? "-" : plus ? "+" : "") + body + tail;
  }

  /** Common.lua formatNumSep with "," and ".": separators in the integer part of every run of 2+ digits. */
  function numSep(str) {
    return str.replace(/-?\d+\.?\d+/g, function (m) {
      const p = /^(-?)(\d+)(\.?\d*)$/.exec(m);
      if (!p) return m;
      return p[1] + p[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + p[3];
    });
  }

  /**
   * buildMode:FormatStat without colours. `def` = { f: fmt, pc, mod } from data/pobdata.js statDefs.
   * @param overCap the stat's over-cap value (resistances, block), shown as " (+N%)" when above 0.
   */
  function formatStat(value, def, overCap) {
    const val = value * (def.pc || def.mod ? 100 : 1) - (def.mod ? 100 : 0);
    let s = luaFormat(def.f, val);
    const m = /^([+-]?\d+\.\d+)(\D*)$/.exec(s);
    if (m) s = m[1].replace(/0+$/, "").replace(/\.$/, "") + m[2];
    s = numSep(s);
    if (overCap !== undefined && overCap !== null && overCap > 0) s += " (+" + luaFormat("d", overCap) + "%)";
    return s;
  }

  const api = { formatStat, luaFormat, numSep, exactDecimal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobStatFmt = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
