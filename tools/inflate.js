// zlib Inflate for headless PoB in tools/pob_fields.lua. HeadlessWrapper.lua stubs Inflate (returns ""), which breaks
// the timeless jewel lookup tables (Modules/DataLegionLookUpTableHelper.lua); PoE-Sim's StatEngine replaces it with
// real zlib for the same reason. Usage: node tools/inflate.js <in> <out>. Exit 1 on bad data (PoB expects nil then).
"use strict";
const fs = require("fs");
const zlib = require("zlib");
const [input, output] = process.argv.slice(2);
const buf = fs.readFileSync(input);
let out;
try { out = zlib.inflateSync(buf); } catch (e) {
  try { out = zlib.inflateRawSync(buf); } catch (e2) { process.exit(1); }
}
fs.writeFileSync(output, out);
