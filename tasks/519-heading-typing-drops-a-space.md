# 519 — typing a heading drops the space after the first word

**Status:** ✅ FIXED 2026-08-13 — bug, found by QA probe · **Impact:** 🔴 high — hits anyone who types a
multi-word heading, which is close to every user · **Found:** 2026-08-13 while implementing
[task 516](516-qa-journey-coverage-plan.md) (incidental to journey A7, chased down separately).

## Symptom

Type `# Untitled journey` character by character in the vMarkd editor. The document ends up as:

```
# Untitledjourney
```

The space between the first and second word is gone. The space after `#` survives.

## Scope — measured, not assumed

| Condition | Result |
|---|---|
| ordinary `file:` document | **reproduces** |
| `untitled:` document | **reproduces** (where it was first noticed) |
| empty document | **reproduces** |
| document with existing content, typing in a fresh paragraph | **reproduces** |
| 60 ms/char and 150 ms/char | **reproduces** at both — not speed-sensitive |
| after an extra 2 s settle post-boot | **reproduces** — not a boot race |
| plain text, no `#` (`alpha beta`) | clean — **heading-specific** |
| Space pressed as its own discrete action, separated from the surrounding keystrokes | clean |
| chromium harness (`media-src/e2e`), all of the above | **never reproduces** — real-webview only |

## What it is NOT (ruled out with controls, so nobody re-runs these)

- **Not the marker-promotion/spin pass in isolation.** Ten harness cells (heading vs plain text ×
  empty vs non-empty, slower delays, space as a separate keypress, the exact phrase, zero settle
  after boot) all type cleanly. Heading promotion by itself does not eat the space.
- **Not the prepaint teaser's scroll capture reading Space as PageDown.** This was the leading
  hypothesis (the overlay does hijack Space — see `prepaint-scroll.spec.ts`). Refuted twice over:
  a synthetic Space keydown on the focused editable reports `defaultPrevented: false`, and the bug
  reproduces identically in sessions where `__vmarkdHadTeaser` is `false` for both the first and a
  later document — no capture listener installed, bug still present.
- **Not a Playwright artifact.** Same behaviour whether the newline is a literal `\n` inside the
  typed string or an explicit Enter, and the live webview's `getValue()` agrees with the
  TextDocument text.

## Where to look

The bug needs the space to arrive in the **same continuous keystroke burst** as the character that
triggers `# ` → heading promotion; a discrete, separately-timed Space is fine. That points at a
caret-restore racing the DOM rebuild that promotion performs (`SpinVditorIRDOM`, the
`blockElement.innerHTML = html` swap) — the caret is restored to an offset computed against the
pre-swap DOM, and the keystroke that lands next overwrites or skips the space. **Not confirmed by
patching** — a probe does not fork the engine; confirming this is step one of the fix.

Why it is real-webview-only is itself a clue: the chromium harness lacks VS Code's injected CSS and
the custom-editor pipeline, and does not wire several main.ts observers (`focus-restore.ts`,
`caret-scroll.ts`). One of those is a plausible second participant in the race.

## Secondary lead (one data point, NOT confirmed)

Placing the caret between `alpha` and `beta` in a pre-existing `alphabeta` (selection verified:
anchorOffset 5) and pressing Space once left the document **completely unchanged** — no space
inserted anywhere. Could be the same race or a Playwright focus-routing quirk in a document that
has never received a keystroke. Worth one probe before treating it as real.

## Regression coverage already in place

`test/vscode-e2e/heading-space-drop.spec.ts` pins the exact broken text `"# Untitledjourney\n"`
with the full trace in its header. Fixing this MUST flip that probe — update it to the correct
expectation in the same commit as the fix, never delete it.

## Verification

- `# Untitled journey` typed character by character produces `# Untitled journey` on both `file:`
  and `untitled:` documents, empty and non-empty, at fast and slow typing speeds.
- The probe is rewritten to the fixed contract and green.
- Plain-text typing and the discrete-Space case stay clean (they are the controls).
- Manual: type a few multi-word headings in the installed extension.
