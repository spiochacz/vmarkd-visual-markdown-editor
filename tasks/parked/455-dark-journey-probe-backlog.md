# Task 455 — Dark-journey probe backlog (the residue of task 190 §5)

**Status:** 📋 OPEN — a backlog of cheap throwaway probes, not a single deliverable ·
**Impact:** 🟡 unknown by construction (that is the point: each probe asks whether a journey works
at all) · **Origin:** split out of [task 190](190-user-journey-test-coverage-plan.md) when 190 was
closed, 2026-07-30.

## Why this exists

Task 190's implementation phases (P0/P1/P2 + infra) are complete, so 190 is closed. Its §5 was
never a phase — it is a menu of **exploratory probes** for journeys that may not work at all,
explicitly sequenced as "opportunistically, one per session, before touching adjacent code". Closing
190 without rehoming them would silently drop the list. They live here instead, with the ones that
have since been covered elsewhere already struck off.

Discipline is 190's own: run each as a cheap throwaway FIRST; promote to a permanent net only what
matters, after fixing whatever the probe finds. A probe that asserts nothing belongs in the `@probe`
tier (task 449) — see `test/backend/probe-tier-convention.test.ts`.

## Still open

- [ ] **IME composition** — CDP `Input.imeSetComposition` in IR prose and inside a highlighted code
      block; duplication/caret check. Grepped 2026-07-30: zero `imeSetComposition` anywhere in
      `test/vscode-e2e`. Completely dark, and the highest-value item here — CJK input is a whole
      user population, and the WYSIWYG highlight path (`wrapLuteFlatten`, caret-as-char-offset) is
      exactly the machinery composition events break.
- [ ] **Untitled → save-as** — untitled md → `openWith` vMarkd → type → saveAs. The manifest
      registers untitled but the path is never exercised end-to-end (`block-fidelity.spec.ts`
      mentions untitled but does not drive the save-as journey).
- [ ] **Line-targeted vMarkd open** — click a VS Code global-search result that resolves to a
      markdown file; does the custom-editor open carry the selection at all? Overlaps task 52
      (reveal-line) and task 229 (code-line links) — probe before either implements a second path.
- [ ] **Wiki link-text rewrite on target rename** — rename `b.md` while a chip to it is open in
      `a.md`; grep the doc for the stale name. No spec matches `renameFile` today.
- [ ] **Drag-drop text/file → link** — synthetic drop carrying `text/plain` + a file item; only
      images are handled today (`image-upload-wire.spec.ts` covers the image path only).
- [ ] **Untrusted/virtual workspace** — launch vscode-test in restricted mode; does the editor open?
      Nothing in the suite touches workspace trust. Note this now has a security edge: task 359's
      link allowlist deliberately reasons about untrusted documents.
- [ ] **Config interaction pairs** (fullWidth×outline, fontSize×lineNumbers) — cheap parametrized
      harness boot; promote to a net only if a probe finds breakage. Do this at the CHROMIUM layer,
      not real VS Code — task 450's lesson is that per-parameter VS Code boots are the expensive
      mistake.

## Already covered since 190 was written — do NOT re-probe

- **Theme-flip during active diagram edit** → `theme-flip-during-first-render.spec.ts` +
  `diagram-fast-edit-safety.spec.ts`.
- **Callout arrow-nav** → `callout-edit.spec.ts` / `callout-rename.spec.ts`.
- **Copy as HTML** → `copy-clipboard.spec.ts`.
- **Ctrl+F find (does the UI open at all)** → answered 2026-08 by task 514: it opens, and the
  focus-theft bug it surfaced is fixed + pinned by `test/vscode-e2e/find-widget-focus.spec.ts`.
  The remaining find-journey surface is planned in [task 516](../516-qa-journey-coverage-plan.md) Phase 2.

## Out of scope

- Turning every probe into a permanent net regardless of what it finds — that is how the suite got
  to ~1.5-2 h (task 447/448). Promote only what protects behaviour someone depends on.

## Verification

Per item: the probe RAN and its finding is recorded (in this file or a new task). A probe with no
recorded finding has not been done.
