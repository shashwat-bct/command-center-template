/* Every spaced em dash in the dashboard's text reads as a comma; a lone "—" for a missing value stays */
(function () {
"use strict";
const DASH = /\s+—\s+/g;
const ATTRS = ["title", "data-help", "data-title", "aria-label", "placeholder"];
const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE)$/;
const plain = (s) => s.replace(DASH, ", ");
const has = (s) => s && s.includes("—") && DASH.test(s) && ((DASH.lastIndex = 0), true);

function fixText(t) {
  if (has(t.nodeValue) && !(t.parentElement && SKIP.test(t.parentElement.tagName))) t.nodeValue = plain(t.nodeValue);
}

function fixElement(el) {
  for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (has(v)) el.setAttribute(a, plain(v)); }
}

function fix(node) {
  if (node.nodeType === 3) return fixText(node);
  if (node.nodeType !== 1 || SKIP.test(node.tagName)) return;
  fixElement(node);
  for (const el of node.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(","))) fixElement(el);
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) fixText(t);
}

const watch = new MutationObserver((changes) => {
  for (const m of changes) {
    if (m.type === "characterData") fixText(m.target);
    else if (m.type === "attributes") fixElement(m.target);
    else for (const n of m.addedNodes) fix(n);
  }
});
watch.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
fix(document.body);
document.title = plain(document.title);
})();
