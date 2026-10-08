# ADR-0009 — Content parity across stages: one geometry per theme, applied to every stage

- **Status:** Accepted
- **Date:** 2026-10-08
- **Tags:** css, theming, parity, geometry, preview, overlay
- **Supersedes:** the "we drop Edit↔Preview spacing parity" decision and the "Edit and Preview are
  decoupled" consequence of ADR-0003 (its mechanism routing and per-surface *behaviour* contracts
  stay in force).
- **Related:** task 532 (this ADR's task, steps 1-3), task 110 (the Preview-only rhythm this
  replaces), task 443 (vscode prose parity against VS Code's own preview, kept as the external
  oracle), task 480, ADR-0003, ADR-0004 (build-time patching used for the geometry tokens),
  `test/parity/` (the gate), `media-src/src/main.css` section 3a.

## Context

The same document is drawn by five stages: the instant-paint overlay, IR, WYSIWYG, the full
Preview and the split pane. ADR-0003 decided that editing surfaces may use roomier block spacing
than the Preview, and task 110 then gave the Preview VS Code's own rhythm (40px list indent, 0.7em
block gap, 1.571 leading) while the editors kept Vditor's (28px, 16px, 1.5). Measured in real VS
Code under the user's `vscode-dark-2026` (task 532, `tmp/fable-preview/report.md`) that decision
shows up as a jump on every switch to the Preview and on every open: lists move 12px per nesting
level, the document is up to 82px shorter, code blocks differ by a line-height. Nothing structural
stopped such drift, and seven parity specs each compared one pair of stages under one theme with a
threshold written for one historical bug (several even asserted the divergence as correct).

## Decision

1. **Geometry is a property of the content, not of the surface.** Indent, block gap, leading,
   heading rhythm and code leading have ONE definition, read by every stage through
   `--vmarkd-geo-*` custom properties (set: `scripts/vditor-geometry-patch.mjs` `GEO_TOKENS`).
   Vditor's own rules are rewritten at build time to `var(--vmarkd-geo-*, <Vditor value>)`
   (`varifyVditorGeometry`, count-asserted exactly like `varifyVditorPalette`); rules Vditor has no
   counterpart for live in `main.css` section 3a, rooted at `.vditor-reset`, never at a surface.
2. **A theme owns a geometry profile and sets tokens only.** `vscode-*-2026` = VS Code's native
   preview rhythm (1.6 leading, 0.7em gap, 40px indent, 1.25 headings, 1.5 code); `github-*` =
   GitHub's (1.5, 16px, 2em, 1.25, 1.5). The **default profile** — no content theme (`auto` under
   any other workbench theme or high contrast) and `material-dark` — is VS Code's rhythm, declared
   once on `body` in `main.css` one specificity step below the `body.markdown-body` the themes set,
   because the editor lives in VS Code and its native preview is what users compare with. A theme
   file must declare the whole token set or `@profile: default`, and may not name a surface
   (`test/backend/parity-geometry-lint.test.ts`).
3. **Surface-scoped geometry stays only as tagged edit chrome.** A `main.css` rule scoped to one
   surface that sets a geometry property must carry `@surface-only: <why it is geometry-neutral>`
   (dual-node anti-jank, h:0 markers, gutter markers, scroller boxes); the tagged count is an exact
   ratchet in the same test and can only shrink. This keeps ADR-0003's behaviour contracts (no
   jank, no phantom strut) and removes only the *rhythm* freedom.
4. **One gate decides parity.** `test/parity/` compares per element kind, per stage pair, per theme
   configuration (computed style, block rects, decoration markers, DOM shape) modulo a checked-in,
   value-pinned allow-list of intended differences; an entry that no longer suppresses anything
   fails the run, so the list can only shrink. The chromium harness runs it on every PR, the
   real-VS-Code spec in the fast (1 boot) and full (10 boots) tiers.

## Consequences

- **+** Switching to the Preview, and the overlay handing over to the live editor, no longer move
  the text under the vscode and github profiles; a new theme or element cannot drift silently.
- **+** `github-*` Previews stop being 40px-indented (task 110's side effect) and follow GitHub.
- **−** The editors' list indent grows from 28px to 40px under the VS Code profile (DOM-driven list
  editing is unaffected; the gutter markers are floated and recomputed from the tokens).
- **−** Vditor content themes that override margins with plain selectors (`ant-design`, `wechat`)
  are not reachable from the extension and would bypass the tokens; they are out of scope.
- **−** Some kinds still differ for structural reasons (IR source panels vs rendered output,
  footnote definitions, diagram wrappers); they are listed in the allow-list with a reason and a
  task, not hidden.

## Alternatives considered

- **VS Code rhythm on every theme (B).** Simplest, but makes the github themes un-GitHub.
- **Vditor's rhythm everywhere (C, i.e. revert task 110).** One deletion, zero jump, but gives up
  the VS Code fidelity task 110 was asked for and makes `font-parity` fail by design.
- **An amendment inside ADR-0003.** Rejected: the dropped-parity clause is a decision reversal, not
  a clarification; ADR-0003 carries a pointer here instead.
