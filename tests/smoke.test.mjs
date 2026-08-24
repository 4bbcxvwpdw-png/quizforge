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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
