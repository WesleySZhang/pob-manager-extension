// A small, strict-enough XML reader for Path of Building build XML. Chrome's MV3 service worker has no DOMParser, so
// the background script reads builds with this; Firefox uses the same code for one code path. It handles what PoB's
// writer (runtime/lua/xml.lua) emits: the <?xml?> declaration, elements, attributes in double or single quotes,
// self-closing tags, text, comments, CDATA and the five named entities plus numeric references.
// Result nodes: { name, attrs: {name: value}, children: [node], text } where text joins the element's own text pieces.
// test/xml.test.js compares it with @xmldom/xmldom.
(function (root) {
  "use strict";

  const NAMED = { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" };

  function decodeEntities(s) {
    if (s.indexOf("&") === -1) return s;
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, function (m, e) {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
    });
  }

  const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
  const ATTR = /\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

  /** @returns the root element node. Throws on malformed input. */
  function parse(xml) {
    if (typeof xml !== "string") throw new Error("XML must be a string");
    xml = xml.replace(/\r\n?/g, "\n"); // XML 1.0 §2.11 end-of-line handling
    let i = 0;
    const n = xml.length;
    const stack = [];
    let rootNode = null;

    function fail(msg) { throw new Error("Bad XML at " + i + ": " + msg); }
    function addText(t) {
      if (stack.length === 0) {
        if (/\S/.test(t)) fail("text outside the root element");
        return;
      }
      stack[stack.length - 1].text += t;
    }

    while (i < n) {
      const lt = xml.indexOf("<", i);
      if (lt === -1) { addText(decodeEntities(xml.slice(i))); break; }
      if (lt > i) addText(decodeEntities(xml.slice(i, lt)));
      i = lt;
      if (xml.startsWith("<?", i)) {
        const end = xml.indexOf("?>", i);
        if (end === -1) fail("unclosed declaration");
        i = end + 2;
      } else if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i);
        if (end === -1) fail("unclosed comment");
        i = end + 3;
      } else if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i);
        if (end === -1) fail("unclosed CDATA");
        addText(xml.slice(i + 9, end));
        i = end + 3;
      } else if (xml.startsWith("<!", i)) {
        const end = xml.indexOf(">", i);
        if (end === -1) fail("unclosed doctype");
        i = end + 1;
      } else if (xml[i + 1] === "/") {
        NAME.lastIndex = i + 2;
        const m = NAME.exec(xml);
        if (!m) fail("bad closing tag");
        const top = stack.pop();
        if (!top || top.name !== m[0]) fail("closing </" + m[0] + "> does not match <" + (top ? top.name : "nothing") + ">");
        const end = xml.indexOf(">", NAME.lastIndex);
        if (end === -1 || /\S/.test(xml.slice(NAME.lastIndex, end))) fail("bad closing tag");
        i = end + 1;
      } else {
        NAME.lastIndex = i + 1;
        const m = NAME.exec(xml);
        if (!m) fail("bad tag name");
        const node = { name: m[0], attrs: {}, children: [], text: "" };
        let j = NAME.lastIndex;
        for (;;) {
          ATTR.lastIndex = j;
          const a = ATTR.exec(xml);
          if (!a) break;
          node.attrs[a[1]] = decodeEntities(a[3] !== undefined ? a[3] : a[4]);
          j = ATTR.lastIndex;
        }
        while (j < n && /\s/.test(xml[j])) j++;
        let selfClosing = false;
        if (xml[j] === "/" && xml[j + 1] === ">") { selfClosing = true; j += 2; }
        else if (xml[j] === ">") j += 1;
        else fail("bad tag <" + node.name + ">");
        if (stack.length) stack[stack.length - 1].children.push(node);
        else if (rootNode) fail("more than one root element");
        else rootNode = node;
        if (!selfClosing) stack.push(node);
        i = j;
      }
    }
    if (stack.length) fail("unclosed <" + stack[stack.length - 1].name + ">");
    if (!rootNode) fail("no root element");
    return rootNode;
  }

  function child(node, name) {
    if (!node) return undefined;
    for (const c of node.children) if (c.name === name) return c;
    return undefined;
  }

  function children(node, name) {
    return node ? node.children.filter(function (c) { return !name || c.name === name; }) : [];
  }

  const api = { parse, child, children, decodeEntities };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PobXml = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
