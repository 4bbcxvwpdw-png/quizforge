/**
 * tests/sanitizer.test.mjs
 * Run with: node tests/sanitizer.test.mjs
 *
 * Tests the QuizForge HTML sanitizer with a jsdom-backed document so the
 * identical function body used in both HTML files can run in Node.js.
 */

import { JSDOM } from 'jsdom';

// ── Bootstrap a minimal browser environment ──────────────────────────────────
const { window } = new JSDOM('<!DOCTYPE html>');
global.document = window.document;

// ── Paste the sanitizer function VERBATIM (identical to both HTML files) ─────
/* sanitizeHtml(rawHtml, context)
   context: 'shipped' → only quizzes/media/ img src allowed
            'pasted'  → also data:image/(png|jpeg|gif|webp);base64, ≤2MB
   Implementation: template-element walking (no regex-only sanitizing).
   Allowed tags: strong, em, br, table, thead, tbody, tr, th, td, img.
   img: only src (policy-gated) and alt survive.
   All on-event handlers, style, class and other attributes stripped.
   Removed outright with subtree: script, iframe, object, embed, svg.
   Disallowed tags not in REMOVE: unwrapped (text content preserved). */
function sanitizeHtml(rawHtml, context) {
  var ALLOWED = {strong:1,em:1,br:1,table:1,thead:1,tbody:1,tr:1,th:1,td:1,img:1};
  var REMOVE  = {script:1,iframe:1,object:1,embed:1,svg:1};
  function allowedSrc(src) {
    if (/^quizzes\/media\/[A-Za-z0-9._-]+$/.test(src)) return true;
    if (context !== 'pasted') return false;
    var m = src.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+=*)$/);
    if (!m) return false;
    return Math.floor(m[2].length * 3 / 4) <= 2097152; /* 2 MB */
  }
  function walk(node) {
    var i = 0, child, tag, attrs, n, a;
    while (i < node.childNodes.length) {
      child = node.childNodes[i];
      if (child.nodeType === 3) { i++; continue; }            /* text: safe */
      if (child.nodeType !== 1) { node.removeChild(child); continue; } /* comment/PI: drop */
      tag = child.tagName.toLowerCase();
      if (REMOVE[tag]) { node.removeChild(child); continue; }  /* REMOVE: drop subtree */
      if (!ALLOWED[tag]) {
        /* unwrap: move children before this node, then remove it */
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        continue; /* don't increment — moved children now start at position i */
      }
      /* allowed tag: strip all attributes except the narrow allow-list */
      attrs = Array.prototype.slice.call(child.attributes);
      for (n = 0; n < attrs.length; n++) {
        a = attrs[n];
        var aName = a.name.toLowerCase();
        if (tag === 'img' && aName === 'alt') continue;
        if (tag === 'img' && aName === 'src' && allowedSrc(a.value)) continue;
        child.removeAttribute(a.name);
      }
      walk(child);
      i++;
    }
  }
  var tpl = document.createElement('template');
  tpl.innerHTML = rawHtml || '';
  walk(tpl.content);
  var div = document.createElement('div');
  div.appendChild(tpl.content.cloneNode(true));
  return div.innerHTML;
}

// ── Minimal test runner ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ': ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertNotContains(str, sub, msg) {
  if (str.includes(sub)) throw new Error(msg || 'expected "' + sub + '" to be absent, but found it in: ' + str.slice(0, 200));
}
function assertContains(str, sub, msg) {
  if (!str.includes(sub)) throw new Error(msg || 'expected "' + sub + '" to be present in: ' + str.slice(0, 200));
}

// ── XSS attempt tests ─────────────────────────────────────────────────────────

test('XSS: onerror img in pasted context - onerror stripped, img kept if src valid', () => {
  // External src should be removed; onerror should also be removed
  const out = sanitizeHtml('<img src="x" onerror="alert(1)">', 'pasted');
  assertNotContains(out, 'onerror', 'onerror attribute must be stripped');
  // src="x" is not a valid data URI or quizzes/media path → src stripped too
  assertNotContains(out, 'src=', 'non-whitelisted src must be stripped');
});

test('XSS: script tag - entire subtree removed including text content', () => {
  const out = sanitizeHtml('safe<script>alert(1)</script>also safe', 'pasted');
  assertNotContains(out, 'script', 'script tag must be gone');
  assertNotContains(out, 'alert', 'script content must be gone');
  assertContains(out, 'safe', 'surrounding text must survive');
  assertContains(out, 'also safe', 'text after script must survive');
});

test('XSS: javascript: href on anchor - a tag unwrapped, text content kept', () => {
  const out = sanitizeHtml('<a href="javascript:alert(1)">click me</a>', 'pasted');
  assertNotContains(out, 'href', 'href must be gone');
  assertNotContains(out, 'javascript', 'javascript: must be gone');
  assertContains(out, 'click me', 'link text must survive');
});

test('XSS: external img URL rejected in both contexts', () => {
  const html = '<img src="https://evil.com/track.png" alt="x">';
  const pasted = sanitizeHtml(html, 'pasted');
  const shipped = sanitizeHtml(html, 'shipped');
  assertNotContains(pasted, 'evil.com', 'external URL rejected in pasted');
  assertNotContains(shipped, 'evil.com', 'external URL rejected in shipped');
  // alt should survive
  assertContains(pasted, 'alt="x"', 'alt survives in pasted');
  assertContains(shipped, 'alt="x"', 'alt survives in shipped');
});

test('XSS: oversized data URI rejected in pasted context', () => {
  // 4 MiB of base64 chars → decoded ≈ 3 MB, above the 2 MB limit
  const bigB64 = 'A'.repeat(4 * 1024 * 1024);
  const out = sanitizeHtml('<img src="data:image/png;base64,' + bigB64 + '" alt="big">', 'pasted');
  assertNotContains(out, bigB64.slice(0, 20), 'oversized data URI src must be stripped');
  assertContains(out, 'alt="big"', 'alt must still survive');
});

test('XSS: SVG MIME type data URI rejected in pasted context', () => {
  const svgB64 = 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
  const out = sanitizeHtml('<img src="data:image/svg+xml;base64,' + svgB64 + '" alt="s">', 'pasted');
  assertNotContains(out, 'svg+xml', 'SVG data URI must be rejected');
});

test('XSS: iframe removed outright', () => {
  const out = sanitizeHtml('<iframe src="https://evil.com"></iframe>text', 'pasted');
  assertNotContains(out, 'iframe', 'iframe must be removed');
  assertContains(out, 'text', 'surrounding text must survive');
});

test('XSS: object/embed removed outright', () => {
  const out = sanitizeHtml('<object data="x.swf"></object><embed src="y.swf">after', 'pasted');
  assertNotContains(out, 'object', 'object must be removed');
  assertNotContains(out, 'embed', 'embed must be removed');
  assertContains(out, 'after', 'text after embed must survive');
});

test('XSS: svg removed outright', () => {
  const out = sanitizeHtml('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>safe', 'pasted');
  assertNotContains(out, 'svg', 'svg must be removed');
  assertNotContains(out, 'alert', 'svg script child must be gone');
  assertContains(out, 'safe', 'text after svg must survive');
});

test('XSS: style attribute stripped from allowed tag', () => {
  const out = sanitizeHtml('<strong style="display:none">text</strong>', 'pasted');
  assertNotContains(out, 'style', 'style attribute must be stripped');
  assertContains(out, '<strong>', 'strong tag must survive');
  assertContains(out, 'text', 'text must survive');
});

test('XSS: class attribute stripped from allowed tag', () => {
  const out = sanitizeHtml('<em class="hl">italic</em>', 'pasted');
  assertNotContains(out, 'class', 'class attribute must be stripped');
  assertContains(out, '<em>', 'em tag must survive');
});

// ── Happy path tests ──────────────────────────────────────────────────────────

test('Happy: strong, em, br pass through clean', () => {
  const html = '<strong>bold</strong> and <em>italic</em><br>';
  const out = sanitizeHtml(html, 'pasted');
  assertContains(out, '<strong>bold</strong>', 'strong must pass');
  assertContains(out, '<em>italic</em>', 'em must pass');
  assertContains(out, '<br>', 'br must pass');
});

test('Happy: table structure passes through', () => {
  const html = '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>';
  const out = sanitizeHtml(html, 'pasted');
  assertContains(out, '<table>', 'table must pass');
  assertContains(out, '<thead>', 'thead must pass');
  assertContains(out, '<tbody>', 'tbody must pass');
  assertContains(out, '<th>H</th>', 'th must pass');
  assertContains(out, '<td>D</td>', 'td must pass');
});

test('Happy: valid quizzes/media/ img src passes in shipped context', () => {
  const html = '<img src="quizzes/media/fig1.png" alt="Figure 1">';
  const shipped = sanitizeHtml(html, 'shipped');
  assertContains(shipped, 'src="quizzes/media/fig1.png"', 'shipped media src must pass in shipped');
  assertContains(shipped, 'alt="Figure 1"', 'alt must pass in shipped');
});

test('Happy: valid quizzes/media/ img src also passes in pasted context', () => {
  const html = '<img src="quizzes/media/photo.jpg" alt="Photo">';
  const pasted = sanitizeHtml(html, 'pasted');
  assertContains(pasted, 'src="quizzes/media/photo.jpg"', 'shipped media src must pass in pasted');
});

test('Happy: valid small data:image/png passes in pasted context only', () => {
  // Minimal valid-ish base64 (not a real PNG but passes size/mime checks)
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const html = '<img src="data:image/png;base64,' + tinyPng + '" alt="test">';
  const pasted = sanitizeHtml(html, 'pasted');
  assertContains(pasted, 'src=', 'valid small data URI must survive in pasted');
  // Same must be rejected in shipped context
  const shipped = sanitizeHtml(html, 'shipped');
  assertNotContains(shipped, 'data:image', 'data URI must be rejected in shipped context');
});

test('Happy: valid data:image/jpeg passes in pasted context', () => {
  const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC==';
  const html = '<img src="data:image/jpeg;base64,' + b64 + '" alt="jpg">';
  const out = sanitizeHtml(html, 'pasted');
  assertContains(out, 'src=', 'valid jpeg data URI must survive in pasted');
});

test('Happy: empty string returns empty', () => {
  const out = sanitizeHtml('', 'pasted');
  assert(out === '', 'empty input should return empty string');
});

test('Happy: plain text passthrough', () => {
  const out = sanitizeHtml('Hello &amp; world', 'pasted');
  assertContains(out, 'Hello', 'plain text must pass');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
