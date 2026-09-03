/**
 * tests/smoke.test.mjs
 * Run with: node tests/smoke.test.mjs
 *
 * Integration smoke test: loads quiz.html into jsdom with a stubbed fetch,
 * sets ?src= to the demo quiz, executes all inline scripts, then asserts that
 * answer-option rows, the question stem, and the question count bar all render.
 * Also verifies the ?id= localStorage path renders identically.
 */

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUIZ_HTML  = readFileSync(resolve(__dirname, '../quiz.html'), 'utf8');
const DEMO_QUIZ  = JSON.parse(readFileSync(resolve(__dirname, '../quizzes/Demo/qf-demo-sample.r1.json'), 'utf8'));

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ' + name); passed++; }
  catch (e) { console.error('FAIL ' + name + ':\n  ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertContains(str, sub, msg) {
  if (!str.includes(sub)) throw new Error(msg || 'expected "' + sub + '" in: ' + str.slice(0, 200));
}

// Build a JSDOM instance that can execute quiz.html's inline scripts.
// fetch is stubbed; localStorage is in-memory (jsdom default).
async function buildDom(search, stubFetch) {
  const dom = new JSDOM(QUIZ_HTML, {
    url: 'http://localhost:18723/quiz.html' + search,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      // Stub fetch before any script runs
      win.fetch = stubFetch || (() => Promise.reject(new Error('no fetch stub')));
      // Stub anime so animation guards (motionOK) return false - keeps render synchronous
      win.anime = null;
      // Stub matchMedia (not provided by jsdom)
      win.matchMedia = () => ({ matches: false, addEventListener: () => {} });
    }
  });

  // Wait for all microtasks + the async initUI to settle.
  // A small real setTimeout lets the event loop flush the promise chain.
  await new Promise(resolve => setTimeout(resolve, 100));
  return dom;
}

// ── ?src= shipped quiz path ───────────────────────────────────────────────────
await (async () => {
  const src = 'quizzes/Demo/qf-demo-sample.r1.json';
  const stub = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(DEMO_QUIZ)
  });

  const dom = await buildDom('?src=' + encodeURIComponent(src), stub);
  const doc = dom.window.document;

  test('?src= path: choice rows render (answer options not blank)', () => {
    const rows = doc.querySelectorAll('#choices .choice-row');
    assert(rows.length === 4, 'expected 4 choice rows for Q1, got ' + rows.length);
  });

  test('?src= path: first option text is correct', () => {
    const opts = doc.querySelectorAll('#choices .choice-text-col');
    assert(opts.length === 4, 'need 4 option text cols');
    assertContains(opts[0].textContent, 'The liver', 'first option should be "The liver"');
  });

  test('?src= path: question stem renders', () => {
    const stem = doc.getElementById('question-text');
    assert(stem, 'question-text element must exist');
    assertContains(stem.textContent, 'pumps blood', 'stem should contain "pumps blood"');
  });

  test('?src= path: question count bar shows correct count', () => {
    const ef = doc.getElementById('ef-count');
    assert(ef, 'ef-count element must exist');
    assertContains(ef.textContent, '10', 'ef-count should show 10 questions');
  });

  test('?src= path: selected-answer label does not show undefined', () => {
    const cs = doc.getElementById('currently-selected');
    assert(cs, 'currently-selected element must exist');
    assert(!cs.textContent.includes('undefined'), 'label must not say "undefined"');
    assertContains(cs.textContent, 'No answer selected', 'should say "No answer selected" before any pick');
  });

  test('?src= path: selected[] array sized to 10 (not 0)', () => {
    // selected is a module-scope variable; we can check by counting choices and
    // ensuring the "no answer" label is for question 1 of 10 (proves length is right)
    const ef = doc.getElementById('ef-count');
    assertContains(ef.textContent, '1 OF 10', 'progress should read "1 OF 10"');
  });

  test('normal mode keeps feedback hidden after selecting an answer', () => {
    doc.querySelector('#choices .choice-row').click();
    assert(!doc.getElementById('explanation-box').classList.contains('visible'),
      'normal mode must keep the explanation hidden until submit');
    assert(!doc.querySelector('#choices .choice-row').classList.contains('locked'),
      'normal mode must still allow answer changes before submit');
  });

  test('Tutor Mode setting reveals and locks the answered question immediately', () => {
    const tutorSwitch = doc.getElementById('tutor-switch');
    assert(tutorSwitch, 'Tutor Mode switch must exist');
    tutorSwitch.click();
    assert(tutorSwitch.getAttribute('aria-checked') === 'true', 'Tutor Mode switch must announce on');

    // Move to a fresh question so the selection above does not affect this assertion.
    dom.window.navigate(1);
    doc.querySelector('#choices .choice-row').click();

    assert(doc.getElementById('explanation-box').classList.contains('visible'),
      'Tutor Mode must reveal the explanation after the first answer');
    assert(doc.querySelector('#choices .choice-row').classList.contains('locked'),
      'Tutor Mode must lock choices after feedback is revealed');
    assert(doc.getElementById('review-layout').classList.contains('feedback-visible'),
      'revealed feedback must activate the review layout');
  });

  test('review divider is keyboard adjustable and persists its width', () => {
    const divider = doc.getElementById('review-divider');
    assert(divider, 'review divider must exist');
    const before = Number(divider.getAttribute('aria-valuenow'));
    divider.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    const after = Number(divider.getAttribute('aria-valuenow'));
    assert(after > before, 'ArrowLeft must grow the right explanation pane');
    assert(Number(dom.window.localStorage.getItem('quizReviewPanePercent')) === after,
      'adjusted explanation width must persist');
  });

  dom.window.close(); // release setInterval timer so Node can exit
})();

// ── ?id= localStorage path (regression check) ────────────────────────────────
await (async () => {
  // Seed a minimal quiz into localStorage via the dom's window.localStorage
  const minimalQuiz = {
    id: 'test-smoke-id',
    title: 'Smoke Test Quiz',
    subtitle: 'Regression check',
    questions: [
      {
        text: 'Is this a test question?',
        options: ['Yes', 'No', 'Maybe'],
        correct: 0,
        explanation: '<strong>Yes</strong> is correct.'
      }
    ],
    addedTs: new Date().toISOString()
  };

  const dom = await buildDom('?id=test-smoke-id', null);
  // localStorage is available after the dom is created; seed it and re-run
  dom.window.localStorage.setItem('qf_quizzes', JSON.stringify([minimalQuiz]));

  // Re-execute init by re-loading (simplest way with jsdom runScripts)
  const dom2 = new JSDOM(QUIZ_HTML, {
    url: 'http://localhost:18723/quiz.html?id=test-smoke-id',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.anime = null;
      win.matchMedia = () => ({ matches: false, addEventListener: () => {} });
      // Pre-seed localStorage before scripts run
      Object.defineProperty(win, 'localStorage', {
        value: (() => {
          const store = { 'qf_quizzes': JSON.stringify([minimalQuiz]) };
          return {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
            removeItem: k => { delete store[k]; },
            key: i => Object.keys(store)[i] || null,
            get length() { return Object.keys(store).length; }
          };
        })()
      });
    }
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const doc2 = dom2.window.document;

  test('?id= path: choice rows render', () => {
    const rows = doc2.querySelectorAll('#choices .choice-row');
    assert(rows.length === 3, 'expected 3 choice rows for ?id= quiz, got ' + rows.length);
  });

  test('?id= path: question stem renders', () => {
    const stem = doc2.getElementById('question-text');
    assert(stem, 'question-text element must exist');
    assertContains(stem.textContent, 'test question', 'stem should contain "test question"');
  });

  test('?id= path: selected-answer label shows no-answer state', () => {
    const cs = doc2.getElementById('currently-selected');
    assert(cs, 'currently-selected must exist');
    assert(!cs.textContent.includes('undefined'), 'must not say "undefined"');
  });

  dom2.window.close(); // release setInterval timer so Node can exit
})();

// ── Protected quiz smoke tests ────────────────────────────────────────────────
// Uses Node 24 built-in WebCrypto to produce real encrypted fixtures, then
// stubs index.html and quiz.html to exercise the unlock/play path.

import { readFileSync as _rfs } from 'node:fs';

const INDEX_HTML = _rfs(resolve(__dirname, '../index.html'), 'utf8');

const _SALT_B64 = 'AAAAAAAAAAAAAAAAAAAAAA=='; // 16 zero bytes, base64
const _PASSPHRASE = 'smoke-test-passphrase';

// A minimal ArrayBuffer with valid QFE1 magic (bytes 0-3 = 0x51 0x46 0x45 0x31).
// _qfeDecrypt checks the magic before calling subtle.decrypt, so this is all
// the fetch stub needs to return — the decrypt stub ignores the ciphertext.
function _fakeQfe1Buf() {
  const b = new Uint8Array(32);
  b[0] = 0x51; b[1] = 0x46; b[2] = 0x45; b[3] = 0x31; // QFE1
  return b.buffer;
}

// Build a fake crypto.subtle that bypasses PBKDF2/AES-GCM entirely.
// importKey and deriveKey return a sentinel token; decrypt always resolves to
// the supplied plaintext ArrayBuffer. This lets the page's _qfeDeriveKey and
// _qfeDecrypt helpers complete without real WebCrypto, so the UI renders.
function _makeFakeCrypto(plaintextBuf) {
  const _fakeKey = { type: 'secret' };
  return {
    subtle: {
      importKey: () => Promise.resolve(_fakeKey),
      deriveKey: () => Promise.resolve(_fakeKey),
      decrypt:   () => Promise.resolve(plaintextBuf),
    }
  };
}

function _buildIndexDom(opts) {
  const { localStorage: lsOverride, fetchStub, cryptoOverride } = opts || {};
  const dom = new JSDOM(INDEX_HTML, {
    url: 'http://localhost:18723/index.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.anime = null;
      win.matchMedia = () => ({ matches: false, addEventListener: () => {} });
      win.fetch = fetchStub || (() => Promise.reject(new Error('no fetch stub')));
      if (cryptoOverride) {
        // crypto is a getter-only property in jsdom — must use defineProperty.
        // Also inject TextEncoder/TextDecoder, which jsdom omits from window scope
        // but the page's _qfeDeriveKey/_qfeDecrypt helpers call directly.
        Object.defineProperty(win, 'crypto', { value: cryptoOverride, configurable: true, writable: true });
        win.TextEncoder = TextEncoder;
        win.TextDecoder = TextDecoder;
      }
      if (lsOverride) {
        Object.defineProperty(win, 'localStorage', { value: lsOverride });
      }
    }
  });
  return dom;
}

function _buildProtectedManifest() {
  return JSON.stringify({
    sections: [
      {
        id: 'week-smoke',
        name: 'Smoke Week',
        quizzes: [{
          id: 'smoke-quiz-1',
          title: 'Smoke Protected Quiz',
          subtitle: 'Protected | smoke test | 1 question',
          file: 'quizzes/protected/smoke-quiz-1.r1.enc',
          revision: 1,
          question_count: 1
        }]
      }
    ]
  });
}

const _PROTECTED_QUIZ_JSON = JSON.stringify({
  id: 'smoke-quiz-1',
  title: 'Smoke Protected Quiz',
  subtitle: 'Protected | smoke test | 1 question',
  revision: 1,
  questions: [{
    text: 'What is the protected question?',
    options: ['Alpha', 'Beta', 'Gamma'],
    correct: 0,
    explanation: '<strong>Alpha</strong> is correct.'
  }]
});

const _PUBLIC_MANIFEST_WITH_PROTECTED = JSON.stringify({
  schema_version: 1,
  generated: '2026-09-03T00:00:00Z',
  sections: [{ id: 'demo', name: 'Demo', quizzes: [] }],
  protected: {
    manifest: 'quizzes/protected/manifest.enc',
    kdf: { salt: _SALT_B64, iterations: 200000 }
  }
});

// Pre-build plaintext buffers for the crypto stubs (no real PBKDF2 needed).
const _encManifestPlain = new TextEncoder().encode(_buildProtectedManifest()).buffer;
const _encQuizPlain     = new TextEncoder().encode(_PROTECTED_QUIZ_JSON).buffer;

// ── index.html: locked state (no qf_unlock_pw) hides protected content ────────
await (async () => {
  const ls = (() => {
    const store = {};
    return {
      getItem: k => k in store ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      key: i => Object.keys(store)[i] || null,
      get length() { return Object.keys(store).length; }
    };
  })();

  const fetchStub = url => {
    if (url.includes('manifest.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(_PUBLIC_MANIFEST_WITH_PROTECTED)) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  const dom = _buildIndexDom({ localStorage: ls, fetchStub });
  await new Promise(res => setTimeout(res, 200)); // wait for async loadManifest
  const doc = dom.window.document;

  test('[index.html locked] shipped-root has no protected sections when not unlocked', () => {
    const root = doc.getElementById('shipped-root');
    assert(root, 'shipped-root must exist');
    // Only the demo section (empty quizzes) should be present; no "Smoke Week"
    const text = root.textContent || '';
    assert(!text.includes('Smoke Week'), 'protected section name must not appear when locked');
    assert(!text.includes('Smoke Protected Quiz'), 'protected quiz title must not appear when locked');
  });

  test('[index.html locked] lock button is hidden when not unlocked', () => {
    const btn = doc.getElementById('lock-btn');
    assert(btn, 'lock-btn must exist in DOM');
    assert(btn.style.display === 'none', 'lock button must be hidden when not unlocked');
  });

  test('[index.html locked] brand-mark exists (unlock trigger element)', () => {
    const brand = doc.querySelector('.brand-mark');
    assert(brand, '.brand-mark must exist (5-click trigger target)');
  });

  dom.window.close();
})();

// ── index.html: unlocked state renders protected sections ─────────────────────
// Crypto stubbed: _makeFakeCrypto intercepts importKey/deriveKey/decrypt so
// the page's _qfeDeriveKey/_qfeDecrypt helpers complete without PBKDF2.
// Real crypto is covered by tests/crypto.test.mjs + browser verification.
await (async () => {
  const ls = (() => {
    const store = { 'qf_unlock_pw': _PASSPHRASE };
    return {
      getItem: k => k in store ? store[k] : null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
      key: i => Object.keys(store)[i] || null,
      get length() { return Object.keys(store).length; }
    };
  })();

  const fetchStub = url => {
    if (url.includes('manifest.json')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(_PUBLIC_MANIFEST_WITH_PROTECTED)) });
    }
    if (url.includes('manifest.enc')) {
      // Return a fake QFE1-magic buffer; the crypto stub ignores ciphertext bytes.
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(_fakeQfe1Buf()) });
    }
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  const dom = _buildIndexDom({
    localStorage: ls,
    fetchStub,
    cryptoOverride: _makeFakeCrypto(_encManifestPlain),
  });
  await new Promise(res => setTimeout(res, 200)); // fake crypto resolves in microtasks
  const doc = dom.window.document;

  test('[index.html unlocked] protected section name appears', () => {
    const root = doc.getElementById('shipped-root');
    assert(root, 'shipped-root must exist');
    assertContains(root.textContent, 'Smoke Week', 'protected section "Smoke Week" must appear when unlocked');
  });

  test('[index.html unlocked] protected quiz title appears', () => {
    const root = doc.getElementById('shipped-root');
    assertContains(root.textContent, 'Smoke Protected Quiz', 'protected quiz title must appear when unlocked');
  });

  test('[index.html unlocked] lock button is visible', () => {
    const btn = doc.getElementById('lock-btn');
    assert(btn, 'lock-btn must exist');
    assert(btn.style.display !== 'none', 'lock button must be visible when unlocked');
  });

  dom.window.close();
})();

// ── quiz.html: locked state shows "quiz is locked" message ───────────────────
await (async () => {
  const encSrc = 'quizzes/protected/smoke-quiz-1.r1.enc';
  const stub = url => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(_PUBLIC_MANIFEST_WITH_PROTECTED)) });

  // No qf_unlock_pw in localStorage
  const dom2 = new JSDOM(QUIZ_HTML, {
    url: 'http://localhost:18723/quiz.html?src=' + encodeURIComponent(encSrc),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.anime = null;
      win.matchMedia = () => ({ matches: false, addEventListener: () => {} });
      win.fetch = stub;
      win.crypto = globalThis.crypto;
    }
  });
  await new Promise(res => setTimeout(res, 150));
  const doc2 = dom2.window.document;

  test('[quiz.html locked] shows locked message when qf_unlock_pw absent', () => {
    const bl = doc2.getElementById('body-layout');
    assert(bl, 'body-layout must exist');
    assertContains(bl.textContent, 'locked', 'body should contain "locked" text when no passphrase');
  });

  test('[quiz.html locked] quiz chrome is hidden when locked', () => {
    const tools = doc2.getElementById('qbar-tools');
    assert(!tools || tools.style.display === 'none', 'qbar-tools must be hidden when locked');
  });

  dom2.window.close();
})();

// ── quiz.html: unlocked state decrypts and plays a protected quiz ─────────────
// Crypto stubbed: _makeFakeCrypto bypasses PBKDF2/AES-GCM; the fetch stub
// returns a fake QFE1-magic buffer that passes the magic check, then the
// decrypt stub returns the fixture plaintext so the quiz renders normally.
// Real crypto round-trip is covered by tests/crypto.test.mjs.
await (async () => {
  const encSrc = 'quizzes/protected/smoke-quiz-1.r1.enc';

  // Pre-seed qf_unlock_pw
  const lsStore = { 'qf_unlock_pw': _PASSPHRASE };
  const ls = {
    getItem: k => k in lsStore ? lsStore[k] : null,
    setItem: (k, v) => { lsStore[k] = String(v); },
    removeItem: k => { delete lsStore[k]; },
    key: i => Object.keys(lsStore)[i] || null,
    get length() { return Object.keys(lsStore).length; }
  };

  const fetchStub = url => {
    if (url.includes('manifest.json'))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(_PUBLIC_MANIFEST_WITH_PROTECTED)) });
    if (url.includes('smoke-quiz-1.r1.enc'))
      // Return a fake QFE1-magic buffer; the crypto stub ignores ciphertext bytes.
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(_fakeQfe1Buf()) });
    return Promise.reject(new Error('unexpected fetch: ' + url));
  };

  const dom3 = new JSDOM(QUIZ_HTML, {
    url: 'http://localhost:18723/quiz.html?src=' + encodeURIComponent(encSrc),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.anime = null;
      win.matchMedia = () => ({ matches: false, addEventListener: () => {} });
      win.fetch = fetchStub;
      // crypto is a getter-only property in jsdom — must use defineProperty.
      // Also inject TextEncoder/TextDecoder (omitted from jsdom's window scope).
      Object.defineProperty(win, 'crypto', { value: _makeFakeCrypto(_encQuizPlain), configurable: true, writable: true });
      win.TextEncoder = TextEncoder;
      win.TextDecoder = TextDecoder;
      Object.defineProperty(win, 'localStorage', { value: ls });
    }
  });
  await new Promise(res => setTimeout(res, 200)); // fake crypto resolves in microtasks
  const doc3 = dom3.window.document;

  test('[quiz.html unlocked] decrypts + renders protected quiz question stem', () => {
    const qt = doc3.getElementById('question-text');
    assert(qt, 'question-text must exist');
    assertContains(qt.textContent, 'protected question', 'stem should contain the decrypted question text');
  });

  test('[quiz.html unlocked] choice rows render for protected quiz', () => {
    const rows = doc3.querySelectorAll('#choices .choice-row');
    assert(rows.length === 3, 'expected 3 choice rows for protected quiz, got ' + rows.length);
  });

  test('[quiz.html unlocked] quiz title appears in topbar', () => {
    const tt = doc3.getElementById('topbar-title');
    assert(tt, 'topbar-title must exist');
    assertContains(tt.textContent, 'smoke test', 'topbar subtitle should contain "smoke test"');
  });

  dom3.window.close();
})();

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
