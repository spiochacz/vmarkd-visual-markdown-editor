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

- [x] **IME composition** — DONE 2026-08-13 via task 516 journey C5
      (`media-src/e2e/ime-composition.spec.ts`, harness layer + CDP, no VS Code boot needed).
      This item's own hunch was right and then some: composition IS broken, just not in the
      predicted direction — it TRUNCATES the pre-edit rather than duplicating it
      (`Helloにほ日本語`), and the WYSIWYG highlight path loses more than plain IR. A bare
      contenteditable control commits cleanly, so it is our surface.
      Bug + trace: [task 518](../518-ime-composition-corrupts-text.md).
- [x] **Untitled → save-as** — DONE 2026-08-13 via [task 516](../516-qa-journey-coverage-plan.md)
      journey A7: `test/vscode-e2e/untitled-save-as.spec.ts`. The journey WORKS end to end. Two
      gotchas worth keeping: the URI path must end in `.md` for the `filenamePattern: "*.md"` +
      `scheme: "untitled"` selector to match, and the native Save-As picker is unreachable from
      Playwright — `files.simpleDialog.enable` swaps in a DOM-rendered quick input that is
      drivable. Third, subtler: `vscode.openWith(uri, 'vmarkd.editor')` with an explicit viewType
      BYPASSES the customEditors selector entirely, so the manifest's `scheme: untitled`
      declaration only gates the "Open With" picker UI — removing it does NOT turn the spec red,
      and the spec therefore does not guard that registration.
- [ ] **Line-targeted vMarkd open** — click a VS Code global-search result that resolves to a
      markdown file; does the custom-editor open carry the selection at all? Overlaps task 52
      (reveal-line) and task 229 (code-line links) — probe before either implements a second path.
- [ ] **Wiki link-text rewrite on target rename** — rename `b.md` while a chip to it is open in
      `a.md`; grep the doc for the stale name. No spec matches `renameFile` today.
- [x] **Drag-drop text/file → link** — DONE 2026-08-13 via task 516 journey C7 (`PROBE-C7` in
      `media-src/e2e/dragdrop.spec.ts`). Answer: it does neither — it silently CRASHES the upload
      pipeline. Bug and trace in [task 517](../517-drop-file-with-text-crashes-upload.md).
- [ ] **Untrusted/virtual workspace** — launch vscode-test in restricted mode; does the editor open?
      Nothing in the suite touches workspace trust. Note this now has a security edge: task 359's
      link allowlist deliberately reasons about untrusted documents.
- [x] **Config interaction pairs** (fullWidth×outline, fontSize×lineNumbers) — DONE 2026-08-13 via
      task 516 journey D11 (`media-src/e2e/config-pairs.spec.ts`, chromium layer as this item
      prescribed). No breakage found, so it landed as a net rather than a throwaway: the outline
      never overlaps the reading column, fullWidth still widens it with the outline open, and the
      line-number gutter scales with font size instead of colliding with the code.

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
