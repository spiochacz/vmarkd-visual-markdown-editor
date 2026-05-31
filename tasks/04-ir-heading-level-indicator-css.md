# Task: Heading-level indicators in IR mode (CSS)

> **Status:** ✅ Done. Scope grew beyond centering: full-width left-gutter
> clip-fix (markers were cut to just "1"), per-heading vertical centering via
> line-height + a 1px nudge on H1–H4, and relabelled the link-ref-defs marker
> "A" → ↩. All in `media-src/src/main.css`.
> **Source:** `Inferno214221/vscode-markdown-editor` — quick-fixes §4
> **Derived from (removed plan):** `quick-fixes-and-hardening-plan.md`
> **Value / Risk:** 🟡 cosmetic / none (pure CSS)

## Goal
Vertically center the `::before` heading-level markers (H1…H6) Vditor renders in
IR mode. **Skip entirely if your IR headings already look fine.**

## Steps
1. `media-src/src/main.css` — add (repeat for h2…h6 as needed):
   ```css
   .vditor-ir .vditor-reset > h1 { position: relative; }
   .vditor-ir .vditor-reset > h1::before {
     position: absolute;
     top: calc(50% - 4.175px);     /* account for the heading underline */
     transform: translateY(-50%);
   }
   ```
2. Rebuild the webview (`foy build`).

## Verify
IR-mode heading markers are vertically centered.
