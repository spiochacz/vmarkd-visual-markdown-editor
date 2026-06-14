# Task: Soft line breaks like CommonMark (flow wrapped lines)

> **Status:** 🟢 planned — **research DONE, design APPROVED (2026-06-13), ready to implement.**
> The open questions below (Lute knob, round-trip, scope) are now RESOLVED — see
> **"Resolved (2026-06-13)"**. The "Investigate" section is kept for context.
> **Source:** user request (2026-06-09) — comparing the GitHub/VS Code markdown
> preview render to vMarkd's render of the same file (task 82 theme work). A
> paragraph (or blockquote) that is soft-wrapped across several source lines shows
> as **separate lines** in vMarkd, but **flows into one wrapped paragraph** on
> GitHub / in VS Code's preview. Re-confirmed 2026-06-13 (VS Code 1.123 preview parity work).
> **Value / Risk:** 🟢 fidelity-to-CommonMark / **low (as scoped)** — preview-only +
> default-off setting makes it a single Vditor source-patch with no round-trip impact.
> **Engines:** Lute (bundled) — `SetSoftBreak2HardBreak`.

## Resolved (2026-06-13)

**Root cause (verified):** Lute exposes `SetSoftBreak2HardBreak`, default **`true`** (soft `\n` →
hard `<br>`). Vditor's `setLute.ts` calls ~18 Lute setters but **never** calls this one, so the
default wins → vMarkd emits `<br>`. The vendored `media/vditor/dist/js/lute/lute.min.js` DOES
expose `SetSoftBreak2HardBreak`. Vditor is the outlier — both VS Code (markdown-it/CommonMark) and
GitHub.com reflow soft-wrapped prose.

**Scope = PREVIEW ONLY (investigate option (a), confirmed safe).** `previewRender.ts → md2html()`
builds its **own** Lute (`const lute = setLute({…})` + `lute.Md2HTML()`) and renders **exactly** the
preview surfaces (SPLIT right pane + IR/WYSIWYG "Preview" button overlay `.vditor-preview`). The
edit surfaces (IR/WYSIWYG/SV) use **separate** Lute instances → patching only `md2html` flips reflow
in the preview while **editing keeps line-break preservation**. This makes the round-trip risk
(Investigate #2) **moot by construction**: the editor serializer is never touched, so on-disk
wrapping is unchanged. Host-side prerender (`src/lute-host.ts`) renders the **editor** first paint,
not the preview → leave it (consistent with "edit preserves breaks").

**Decisions (approved by user):**
- **Setting:** `vmarkd.preview.reflowLineBreaks` (boolean). `true` → reflow like VS Code/GitHub
  (`SetSoftBreak2HardBreak(false)`); `false` → keep `<br>` (current).
- **Default:** `false` (no behaviour change for existing docs; opt-in to parity).
- **Surface:** preview only (scope a) **+** a setting (scope c). NOT the live IR editing surface (b).

**Concrete approach (mechanism = `window.__vmarkd*` flag + esbuild source-patch — mirrors existing
patches; per ADR-0003 "behaviour, not CSS" → esbuild TS patch):**
1. `package.json` — add `vmarkd.preview.reflowLineBreaks` (boolean, default `false`) to the
   "Appearance" group; description notes "Preview surface only — editing keeps manual line breaks".
2. `src/extension.ts` — `collectConfigOptions()` (~line 1485) add
   `reflowLineBreaks: c.get<boolean>('preview.reflowLineBreaks')` (flows to webview via init +
   `config-changed`).
3. `media-src/esbuild-shared.mjs` — new `fixPreviewSoftBreak` (anchor-asserted, registered in
   `vditorSourceConfig.plugins`): in `previewRender.ts`, anchor on the unique `lute.SetHeadingID(true);`
   inside `md2html` and insert before it `lute.SetSoftBreak2HardBreak(!(window).__vmarkdReflowPreview);`
   (flag unset/false → `true` = current behaviour → no default regression).
4. `media-src/src/main.ts` — set `(window as any).__vmarkdReflowPreview = !!options.reflowLineBreaks`
   at init and in `handleConfigChanged`; best-effort live re-render of an open preview
   (`const iv=(window.vditor as any)?.vditor; if (iv?.preview?.element && iv.preview.element.style.display!=='none') iv.preview.render(iv)`).
   Consider an `applyReflowSetting(options)` helper in `live-config.ts` (parallel to
   `applyBodyOptions`/`applyLinkOpenSetting`). Editor lutes untouched.
5. Tests: e2e `softbreak.spec.ts` (preview path: flag on → no `<br>`; off → `<br>`; AND edit surface
   still `<br>` regardless — proves preview-only); backend `vditor-source-patches.test.ts`
   (patch injects `SetSoftBreak2HardBreak` + throws on missing anchor).

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
