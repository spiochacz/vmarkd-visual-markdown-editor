# Task 100 — Bug: can't create `---` under `---`, and arrow-nav between two `<hr>` is stuck

> **Status:** ✅ DONE (2026-06-29). Typing `---` under content now renders a real rule, and the
> caret steps across void rules instead of getting stuck.

## Outcome (what shipped)

Both symptoms fixed (mechanism confirmed by a real-webview probe — see "Confirmed mechanism" below):
1. **Trailing `---` now promotes to `<hr>`.** `promoteThematicBreaks` (`gap-paragraph.ts`) renders a
   lone thematic-break paragraph (`---`/`***`/`___`) the caret has LEFT as a real `<hr>` — run from
   `observeGapParagraphs`' selectionchange rAF. Lute serialises `<hr>` back to `---` so the markdown
   round-trips; the focused paragraph stays editable source. The existing trailing invariant then
   offers an escape paragraph below the new rule (`endsWithBlock` already treats `<hr>` as atomic).
2. **Arrow-nav steps across void rules.** `setupHrArrowNav` (`hr-nav.ts`, wired in `main.ts`,
   mirroring `setupCalloutArrowNav`/`setupTrailingNav`): on ArrowDown/Up, when the caret is on a
   block's edge line toward an `<hr>`, step the caret past the whole run of rules to the adjacent
   editable block (or the EOF trailing paragraph), `preventDefault` so the native move can't drop the
   selection on the void rule.

**Known limitation (not addressed):** two DIRECTLY adjacent rules (`<hr><hr>`, no block between) still
have no caret slot *between* them — nav steps across the whole run. Inserting between stacked rules is
a rare authoring case; revisit only if reported.

## Tests
- **Unit** (`gap-paragraph.test.ts`, +8): `isThematicBreakParagraph` (markers/variants/rejects),
  `promoteThematicBreaks` (promote-on-leave, skip-focused, leaves normal paragraphs, multi-rule,
  trailing-invariant integration). New promotion code 100% unit-covered.
- **Real-VS-Code e2e** (`hr-edit.spec.ts` + `fixtures/hr-edit.md`): typing `---` under content
  promotes to a real `<hr>` (round-trips), and ArrowDown/Up steps the caret across a void `<hr>`
  instead of landing OUTSIDE. **RED-checked: both FAIL with the fixes disabled** (hrCount stuck at 1;
  ArrowDown lands "OUTSIDE"). `hr-nav.ts` is geometry/keyboard-driven → covered here, not in unit.
- Regression green: harness `gap`/`codenav`/`callout` (35) + real-VS-Code `trailing`/`bottom-gap`/
  `callout-edit` (4).

---

> **Reported:** 2026-06-16. In IR/WYSIWYG, a thematic break (`---` → `<hr>`) is a block with **no
> editable text**, so the caret had nowhere to land. Two symptoms:
> 1. **Can't create a second `---` directly under an existing `---`** — typing `---` below a rule
>    didn't produce a new rule (stayed literal `--- ` text).
> 2. **Arrow keys get stuck on a `<hr>`** — Up/Down dropped the caret on the void rule.
> **Source:** user report. **Value / Risk:** 🟢 nav/authoring correctness / low–medium —
> same class as the code-block/blockquote nav fixes; touch IR nav + a transient gap paragraph,
> not core Lute.

## Repro (real VS Code webview — likely won't repro in the Playwright harness)
1. New doc, IR mode. Type `---` Enter → one `<hr>`.
2. Try to add a second `---` on the line below the rule → fails / no new rule.
3. With two `<hr>` (separated by a blank line in source), put the caret above and press
   Down (and below, press Up) → caret can't sit between them / jumps past both.

## Confirmed mechanism (probed 2026-06-29, real VS Code IR webview)

Drove real keystrokes + dumped `vditor.ir.element` (probe since deleted). Two distinct sub-bugs:

1. **A trailing `---` never promotes to `<hr>`.** Typing `--- ` in a paragraph leaves a literal
   `<p>--- </p>` (normal IR: the focused block shows raw source). Pressing Enter promotes the
   PREVIOUS `---` to `<hr>` but the line you're now on is a fresh literal `<p>--- </p>`. Crucially the
   **last** `---` block stays `<p>--- </p>` **even after the caret leaves it** (clicking the H1 away
   did NOT promote it). Result with two rules typed: blocks = `H1, P, HR, P("--- "), #fix-table-ir-wrapper`
   → `hrCount=1` while `getValue()` is correct (`---\n\n---`). So the **markdown round-trips fine but the
   live render shows one rule + a stuck literal `--- ` line** — the "can't create `---` under `---`"
   the user sees.
   - Root: promotion needs a following block boundary. The last `---` paragraph is followed only by our
     non-content `#fix-table-ir-wrapper` (fix-table-ir.ts), and `gap-paragraph.ts`'s trailing invariant
     does NOT add a paragraph after it — `endsWithBlock` treats `<p>` as a plain TEXT_BLOCK, so a lone
     thematic-break paragraph at EOF gets no trailing `<p>`, no boundary, no promotion.
2. **Arrow-nav drops the caret on the void `<hr>`.** ArrowDown from the first paragraph across the rule
   traced `P → OUTSIDE → P → P …`: the `<hr>` is a void block with no text position, so the caret falls
   out of the block chain ("OUTSIDE") then snaps back — you can't rest the caret between / under a rule.

## Approach (investigate first — mirror the existing block-nav fixes)
- Reuse the pattern from [[codeblock-arrow-nav-empty-paragraph]] / `gap-paragraph.ts`
  (`observeGapParagraphs`, wired in `main.ts`) and the trailing-invariant work
  ([[codeblock-nav-no-empty-block]] / `endsWithBlock`): a **self-cleaning transient gap
  paragraph** adjacent to an `<hr>` so the caret can land + you can type the next `---`,
  reclaimed on `selectionchange` when left empty.
- Check whether `<hr>` needs the same treatment as code blocks in `endsWithBlock` (a doc
  ending in `<hr>` may need a trailing paragraph invariant too).
- **Primary lever (from the probe):** the trailing invariant must offer a paragraph after a LONE
  thematic-break paragraph too — i.e. `endsWithBlock` should not treat a `<p>` whose only content is a
  `---`/`***`/`___` marker as a plain TEXT_BLOCK (today it does → no boundary → the `---` never
  promotes to `<hr>`). Adding that escape `<p>` gives Lute the boundary to promote it AND a caret slot
  below. Verify it doesn't add a stray trailing line in the normal case (reclaim when empty, like the
  others). Then the arrow-nav net (`setupTrailingNav`/`setupCalloutArrowNav` pattern) for stepping the
  caret across the void `<hr>`.
- Files to look at: `media-src/src/gap-paragraph.ts`, the IR nav helpers in `main.ts`, and
  any `insertAfterBlock`/`insertBeforeBlock` esbuild patches (cf. the table-IR-wrapper /
  EOF caret work, `fix-table-ir-wrapper`).
- Decide WYSIWYG vs IR scope (report is general — verify both).

## Verification
- Real-VS-Code e2e (xvfb) in `test/vscode-e2e/` — webview-only nav; the Playwright harness
  likely can't repro (same as the other caret-nav bugs). Add a `codenav`-style spec:
  create `---` under `---`, arrow Up/Down across two rules, assert caret lands between them
  and a new rule is produced. **Verify the final caret behaviour WITH THE USER.**
