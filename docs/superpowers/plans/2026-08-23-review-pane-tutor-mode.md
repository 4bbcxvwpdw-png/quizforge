# Review Pane and Tutor Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make answer review comfortable on desktop with a resizable explanation pane and add an optional Tutor Mode that reveals feedback after each answer.

**Architecture:** Keep the static, dependency-free player intact. `quiz.html` owns the new persisted setting, per-question reveal state, and the accessible drag divider; narrow screens retain the existing stacked layout. The existing final submission and attempt-history transaction remain unchanged.

**Tech Stack:** Static HTML, CSS, browser JavaScript, localStorage, Node.js with jsdom.

## Global Constraints

- Normal mode continues to hide all answers until final submission.
- Tutor Mode reveals and locks only answered questions; final submission still saves one attempt.
- The divider is mouse, touch, and keyboard adjustable and appears only when feedback is visible on a wide screen.
- Existing `?id=` and `?src=` loading paths, sanitization, themes, skins, and score history remain intact.

---

### Task 1: Add failing behavior tests

**Files:**
- Modify: `tests/smoke.test.mjs`

**Interfaces:**
- Consumes: `buildDom(search, stubFetch)` and the demo shipped quiz.
- Produces: regression checks for `#tutor-switch`, per-question reveal, normal-mode delay, and `#review-divider` keyboard resizing.

- [ ] Add a normal-mode test that selects an answer and asserts the explanation remains hidden.
- [ ] Add a Tutor Mode test that toggles the switch, answers once, and asserts answer feedback, explanation visibility, and row locking.
- [ ] Add a divider keyboard test that checks its ARIA value and persisted width change.
- [ ] Run `node tests/smoke.test.mjs`; expect the new assertions to fail before implementation.

### Task 2: Implement Tutor Mode

**Files:**
- Modify: `quiz.html`

**Interfaces:**
- Consumes: `selected[]`, `questions[]`, `render()`, and the `_ls` storage wrapper.
- Produces: `revealed[]`, `tutorModeOn()`, `toggleTutorMode()`, and `chooseAnswer(index)`.

- [ ] Add a settings switch labeled “Tutor Mode” with the description “Reveal each answer immediately.”
- [ ] Persist the preference under `quizTutorMode` and keep `aria-checked` synchronized.
- [ ] Route pointer and keyboard answer selection through `chooseAnswer(index)`.
- [ ] In Tutor Mode, mark the current question revealed after its first answer and prevent later answer changes.
- [ ] Make choice colors, explanation visibility, rail dots, and navigation dots use `submitted || revealed[questionIndex]`.
- [ ] Run `node tests/smoke.test.mjs`; expect Tutor Mode and normal-mode assertions to pass.

### Task 3: Implement the resizable review pane

**Files:**
- Modify: `quiz.html`

**Interfaces:**
- Consumes: the per-question feedback visibility computed by `render()`.
- Produces: `#review-layout`, `#review-divider`, `setReviewPanePercent()`, and persisted `quizReviewPanePercent`.

- [ ] Wrap the question and explanation in a review layout with a semantic `aside` for feedback.
- [ ] Show a three-column question/divider/explanation grid whenever feedback is visible on screens wider than 1000 px.
- [ ] Give the question and explanation panes independent vertical scrolling.
- [ ] Add pointer dragging and Left/Right/Home/End keyboard controls to the divider.
- [ ] Expose `role="separator"`, `aria-orientation="vertical"`, `aria-controls`, and live min/max/current values.
- [ ] Stack the explanation below the question and hide the divider at 1000 px and below.
- [ ] Run `node tests/smoke.test.mjs`; expect all new assertions to pass.

### Task 4: Regression verification

**Files:**
- Test: `tests/smoke.test.mjs`
- Test: `tests/sanitizer.test.mjs`

**Interfaces:**
- Consumes: the completed static player.
- Produces: evidence that loading, sanitization, normal mode, Tutor Mode, and divider controls coexist.

- [ ] Run `node tests/smoke.test.mjs`; expected: zero failures.
- [ ] Run `node tests/sanitizer.test.mjs`; expected: zero failures.
- [ ] Parse every inline script from `quiz.html` with Node; expected: no syntax errors.
- [ ] Inspect `git diff --check`; expected: no whitespace errors.
- [ ] Manually exercise a local `?src=` quiz at desktop and mobile widths; expected: split desktop review, stacked mobile review, and unchanged final score saving.
