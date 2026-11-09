// Reference: @xmldom/xmldom (an independent XML parser) reading the same input. Tolerance: exact element names,
// attributes and text.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { DOMParser } = require("@xmldom/xmldom");
const X = require("../src/xml.js");

function fromDom(el) {
  const node = { name: el.nodeName, attrs: {}, children: [], text: "" };
  for (let i = 0; i < el.attributes.length; i++) node.attrs[el.attributes[i].name] = el.attributes[i].value;
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) node.children.push(fromDom(c));
    else if (c.nodeType === 3 || c.nodeType === 4) node.text += c.nodeValue;
  }
  return node;
}

const dir = path.join(__dirname, "fixtures", "golden");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".xml"))) {
  test("same tree as xmldom: " + f, () => {
    const xml = fs.readFileSync(path.join(dir, f), "utf8");
    assert.deepEqual(X.parse(xml), fromDom(new DOMParser().parseFromString(xml, "text/xml").documentElement));
  });
}

test("entities, CDATA, comments, single quotes, self-closing tags", () => {
  const xml = `<?xml version="1.0"?><!-- c --><a x='1 &amp; 2' y="&lt;&#65;&#x42;&quot;&apos;&gt;"><b/>t&amp;u<![CDATA[<raw>&amp;]]><!-- in --><c k="v" /></a>`;
  const r = X.parse(xml);
  assert.deepEqual(r, fromDom(new DOMParser().parseFromString(xml, "text/xml").documentElement));
  assert.equal(r.attrs.x, "1 & 2");
  assert.equal(r.attrs.y, "<AB\"'>");
  assert.equal(r.text, "t&u<raw>&amp;");
  assert.equal(X.child(r, "c").attrs.k, "v");
  assert.equal(X.child(r, "nope"), undefined);
  assert.deepEqual(X.children(null, "a"), []);
});

test("unknown entities are left as they are", () => {
  assert.equal(X.decodeEntities("a &nbsp; b &#xFFFFFFF; c"), "a &nbsp; b &#xFFFFFFF; c");
});

test("malformed XML throws", () => {
  for (const bad of ["", "text only", "<a>", "<a></b>", "<a><b></a></b>", "<a/><b/>", "<a x=1/>", "<!-- open", "<a><![CDATA[x</a>", "<?xml", "<a></a junk>", "<1/>", "</a>"]) {
    assert.throws(() => X.parse(bad), /Bad XML/, JSON.stringify(bad));
  }
  assert.throws(() => X.parse(null), /must be a string/);
  assert.throws(() => X.parse("<a/>trailing"), /outside the root/);
});
