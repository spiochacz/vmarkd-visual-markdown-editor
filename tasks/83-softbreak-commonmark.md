# Task: Soft line breaks like CommonMark (flow wrapped lines)

> **Status:** 📋 TODO (planned, needs research).
> **Source:** user request (2026-06-09) — comparing the GitHub/VS Code markdown
> preview render to vMarkd's render of the same file (task 82 theme work). A
> paragraph (or blockquote) that is soft-wrapped across several source lines shows
> as **separate lines** in vMarkd, but **flows into one wrapped paragraph** on
> GitHub / in VS Code's preview.
> **Value / Risk:** 🟡 fidelity-to-CommonMark / **medium** — touches the
> markdown render + round-trip (serialization back to disk) and all editor modes.
> **Engines:** Lute (bundled) — likely a Lute option.

## Problem
CommonMark treats consecutive non-blank lines inside one paragraph as a **soft
break**, rendered as a space → the text reflows/wraps. GitHub and VS Code's
markdown preview do this. vMarkd (Vditor IR / Lute) instead **preserves the source
line breaks** — each `>`/paragraph line stays on its own visual line.

Concretely, the top blockquote of e.g. `tasks/13-outline-heading-flash.md`
(`> **Status:** … \n > **Source:** … \n > **Value / Risk:** …`) renders as 3+
stacked lines in vMarkd, vs one flowing paragraph on GitHub (see task 82 screenshots).

This is **independent of the content theme** (github/material/vscode all show it) —
it's a markdown *rendering* behaviour, not theming.

## Goal
Make soft (single-newline) line breaks inside a paragraph/blockquote **flow** like
CommonMark/GitHub/VS Code — without breaking:
- **round-trip**: editing + saving must not rewrite/reflow the user's source line
  wrapping on disk (the editor is two-way synced to the file);
- **hard breaks**: a real hard break (trailing two spaces, or `\` , or a blank
  line) must still break;
- **all modes**: IR, WYSIWYG, SV, and the host-side prerender/preview.

## Investigate (decide during implementation)
1. **Lute / Vditor knob.** Find the option controlling soft-break → `<br>` vs
   space. Candidates: Lute `SetSoftBreak2HardBreak(false)`, or a Vditor
   `options.preview.markdown.*` flag. Check how it's currently set (likely defaults
   to preserving breaks for editor fidelity). Spike with the Node Lute shim
   (`[[lute-runs-in-node]]` pattern — shim window/self + require lute.min.js) to see
   the HTML/IR-DOM output with the flag on vs off, BEFORE wiring it.
2. **Round-trip safety.** The big risk: IR is WYSIWYG-ish and round-trips the DOM
   back to markdown. If soft breaks become spaces in the DOM, does serialize
   (`VditorIRDOM2Md` / the incremental path, task 69) **re-join** the lines on save →
   silently rewriting the user's wrapped source to one long line? That would be a
   regression. Verify serialize preserves the on-disk wrapping (or scope the change
   to **preview/prerender only**, leaving the editable IR as-is).
3. **Scope options:**
   - (a) only the **preview** pane + host prerender flow soft breaks (safe, no
     round-trip impact) — likely the right call;
   - (b) the live IR editing surface too (riskier round-trip);
   - (c) a setting (`vmarkd.editor.softWrap`?) if behaviour should be opt-in.

## Tests (per AGENTS)
- **Unit/spike:** Lute output for `a\nb` (one paragraph) → flowed (space) vs `<br>`;
  serialize round-trip of a soft-wrapped paragraph returns the SAME source (no
  reflow) — guards the round-trip risk.
- **E2e:** a soft-wrapped paragraph + blockquote render as one flowing block (one
  line box at wide width), and editing+`getValue()` returns the original wrapping.

## Verify
Open `tasks/13-outline-heading-flash.md`: the `> **Status:** …` blockquote and the
multi-line "Goal" paragraph render as flowing wrapped paragraphs (like GitHub),
not stacked lines. Edit + save → the file's line wrapping on disk is unchanged.

## See also
- `82-custom-editor-themes.md` — surfaced this while matching GitHub/VS Code render.
- task 69 — incremental IR serialize (the round-trip path to protect).
