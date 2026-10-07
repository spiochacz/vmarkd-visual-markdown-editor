# Task 529 — Integrate Vditor/Lute native callouts, GitHub-compatible

**Status:** 📋 planned — SPIKE first · **Impact:** 🟡 med (less custom code to maintain; native editing) ·
**Origin:** user decision 2026-10-07 during task 528 (Vditor 3.11.3): keep our callouts for now
(native ones forced off), and plan the switch with **GitHub compatibility as the hard requirement**.

## Problem

Vditor 3.11.3 (vditor#1866) turns on Lute's native callout node by default
(`preview.markdown.callout: true` → `lute.SetCallout(true)`). Measured in task 528 phase A with the
vendored Lute `591a695`:

- DOM becomes `blockquote[data-type=callout].callout` (our `callouts.ts` keys on the plain
  `blockquote[data-callout]`, so it stops matching).
- **The saved markdown changes**: `> [!NOTE]\n> Body` → `> [!NOTE] ✏️ Note\n>\n> Body`,
  `> [!WARNING]-` → `> [!WARNING] ⚠️ -`. A default emoji + title is injected into the user's file.

Task 528 ships with the native node forced OFF (`SetCallout(false)` + `preview.markdown.callout:
false`), so today's behaviour and files stay byte-identical. This task decides whether and how to
move to the native implementation and drop ours (`callouts.ts`, `callout-nav.ts`, the WYSIWYG
callout popover from task 459).

## Hard requirement — GitHub compatibility

A callout written or edited in vMarkd must render as an alert on GitHub, and opening + editing a file
must never rewrite a GitHub-valid callout into something GitHub does not render.

- GitHub alert syntax: `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` **alone on
  the first line** of the blockquote, body on the following `>` lines. Verify the exact rules against
  GitHub's docs and a real render before relying on them (title text after the marker, case,
  blank `>` line, nesting, unknown types).
- Round-trip: for every GitHub-valid callout, open → edit elsewhere → save must leave the callout
  bytes unchanged. No injected emoji, no injected default title, no added blank `>` line.
- Obsidian extensions (custom title after the marker, fold `-`/`+`, extra types — task 206) may be
  supported, but only as the user wrote them; never added by the editor.

## Steps

- [ ] **Spike (read + measure, no product change):** with Vditor 3.11.3 + the vendored Lute, enable
      native callouts in a harness and record, per variant (5 GitHub types, custom title, fold,
      nested, in a list, empty body, plain blockquote): IR/WYSIWYG DOM, `getValue()` after a no-op
      edit, and what the native editing UI does (type change, title, fold).
- [ ] Find the cause of the injected `✏️ Note` title: a Lute renderer default, a Vditor option, or
      the DOM Vditor builds. Look for Lute/Vditor options that turn it off (task 525 / memory:
      do NOT patch the Lute engine; patches at our layer or Vditor-source patches per ADR-0004
      are fine).
- [ ] Decide with the user: native (with which fixes), hybrid (native DOM + our serialization
      guard), or stay on ours until Vditor 4 (task 527).
- [ ] If switching: GitHub-render check on real files (push a scratch file or use GitHub's
      markdown API), round-trip net over the repo's real `.md` corpus (no callout byte changes),
      port the callout specs (`callout*.spec.ts`, both harnesses) to the native DOM, then remove
      our implementation.

## Verify

- [ ] Every GitHub-valid callout in the corpus round-trips byte-identically.
- [ ] Callouts created in vMarkd render as alerts on GitHub (checked on a real render).
- [ ] Callout editing parity with today (IR expand-to-source, arrow navigation, WYSIWYG type/title).

## See also

- Task 528 (Vditor 3.11.3; native callouts forced off), 527 (Vditor 4), 526 (Lute re-pin),
  206 (Obsidian callout aliases + fold), 106/179 (our callouts), 459 (WYSIWYG callout popover).
