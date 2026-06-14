# Task 110 — Preview spacing parity with VS Code (line-height + block margins), preview surface only

> **Status:** 📋 TODO (planned) — narrowed. A 2026-06-13 full element-by-element audit closed all
> the STRUCTURE/treatment gaps for vscode-2026 (tables → horizontal rules only + left headers +
> th-border rgba .69 + cell padding 5×10; hr → 1px; code-block radius 3px; code → editor font;
> link/checkbox → theme colour). What REMAINS for true 1:1 is the pure **spacing axis**:
> line-height `1.5`→`1.571` (21→22px), block margin-bottom `16px`→`0.7em`, and list indent
> `28px`→`40px` (UA default) — plus confirm inline-code padding vs the VS Code shell. These need
> the careful margin-collapse + preview-surface scoping + scroll-preserve (task 48) verification
> below, which is why they were split out rather than done blind in the treatment pass.
> The deliberately-deferred "close the pixel spacing" follow-up that task 109 + ADR-0003 scoped OUT.
> **Source:** User (2026-06-13) — comparing the vMarkd `vscode-*-2026` render to VS Code's native
> markdown preview: the **blockquote background sits a few px taller** than VS Code's. Measured:
> the blockquote TREATMENT is pixel-identical (padding `0 16px 0 10px`, border-left only, radius 2px,
> bg hugs text 1:1 — topGap/bottomGap = 0); the height delta is purely **line-height / font-size /
> block-margin scale**. So the gap is general block spacing, not a blockquote bug.
> **Value / Risk:** 🟡 fidelity to VS Code preview / **medium** — touches block spacing across the
> whole preview; risk of regressing the preview-scroll-preserve anchors (task 48) and the collapsed
> code-block height guards if scoped sloppily. Preview-only ⇒ edit surfaces untouched.
> **Engines:** none (CSS scoped to the preview surface).

## Problem (measured 2026-06-13)

Our preview render rides Vditor's structure, which uses Vditor's reading-size metrics, not VS Code's
markdown-preview metrics:

| metric | vMarkd preview (measured) | VS Code preview (`markdown.css`, source-verified) |
|---|---|---|
| font-size | 16px (Vditor reading size; or the user's `vmarkd.editor.fontSize`) | `14px` (fixed `--markdown-font-size`) |
| line-height | `24px` (≈1.5) | `22px` (≈1.571, `--markdown-line-height`) |
| p / ul / ol / table margin-bottom | `16px` | `0.7em` |
| li > p margin-bottom | 16px | `0.7em` |
| heading margin | (Vditor) | `margin: 24px 0 16px; line-height: 1.25` |
| heading scale | ✅ already matched (task: vscode-2026) h1 2em…h6 0.85em | same |
| blockquote padding / border / radius | ✅ already identical (`0 16px 0 10px`, border-left, 2px) | same |
| code-block padding / radius | check | `padding: 16px; border-radius: 3px` (radius already; padding TBD) |
| body horizontal padding | (Vditor/full-width logic) | `0 26px` |

Net effect: a 2-line blockquote bg is ~64px for us vs ~54px in VS Code — entirely from line-height
(24 vs 22) + inter-paragraph margin (16 vs ~9.8px). Same for every block.

## Goal

Make the **Preview surface** match VS Code's markdown-preview block spacing: line-height, block
bottom-margins, heading margins/line-height. **Scope: preview ONLY** — the `.vditor-preview` pane
(SPLIT right side) + the IR/WYSIWYG "Preview" button overlay (both are `.vditor-preview`). The
**edit surfaces (IR / WYSIWYG / SV) keep Vditor's roomier editing spacing** (ADR-0003 dropped
edit↔preview parity on purpose; this task is about preview↔VS-Code parity, the other axis).

## Key decision (resolve in implementation)

**Font-size in preview.** VS Code's preview is always a fixed `14px`. Ours follows
`vmarkd.editor.fontSize` (default `editor` → VS Code editor font). Two options:
- **(a) Recommended — match PROPORTIONS, keep the user's font.** Set preview `line-height` to VS
  Code's ratio (`22/14 ≈ 1.571`) and block margins to `0.7em` (em-relative → scales with whatever
  font the user picked). Gets VS Code's *rhythm* without overriding the font-size the user chose.
- (b) Hard-pin preview to `14px / 22px` (byte-identical to VS Code, but decouples the preview font
  from the `fontSize` setting — surprising if the user set a larger editor font).

Recommend (a). Either way, NOT applied to edit surfaces.

## Approach

Per ADR-0003 this is "our own geometry → `main.css`, scoped". Add a preview-scoped section to
`media-src/src/main.css` overriding Vditor's content-theme block spacing **only under the preview
surface**, e.g. `.vditor-preview .vditor-reset { line-height: 1.571 }` and
`.vditor-preview .vditor-reset :is(p, ul, ol, table, blockquote) { margin-bottom: 0.7em }`,
`.vditor-preview .vditor-reset :is(h1,h2,h3,h4,h5,h6) { margin: 24px 0 16px; line-height: 1.25 }`,
etc. Verify the exact selectors against the rendered preview DOM (the `.vditor-reset` inside
`.vditor-preview`), and that they do NOT leak to `.vditor-ir`/`.vditor-wysiwyg`/`.vditor-sv`.

Watch-outs:
- **preview-scroll-preserve (task 48)** anchors on top-level blocks by index across IR↔Preview;
  changing preview block margins shifts pixel offsets — re-verify the toggle doesn't land wrong.
- **collapsed code-block height** + **dark code bottom padding** guards (blockbg.spec) are about the
  code render box; don't let a blanket `line-height`/`margin` rule hit `code.hljs` / the dual-node
  preview (scope to text blocks, exclude code).
- Don't touch `--vmarkd-*` palette — this is spacing only.

## Verify

- **e2e** (extend a spec or add `preview-spacing.spec.ts`): in the preview surface, a paragraph's
  `line-height` ≈ VS Code ratio and block `margin-bottom` ≈ `0.7em`; the SAME blocks in IR/WYSIWYG
  keep Vditor's spacing (proves preview-only). A 2-line blockquote bg height drops to ~VS-Code value.
- **regression:** blockbg / codenav / width guards green; preview-scroll-preserve still lands on the
  right block when toggling IR↔Preview on a long doc with mixed blocks.
- **real VS Code:** side-by-side the SPLIT pane / Preview overlay vs native `Ctrl+Shift+V` on a
  doc with paragraphs + blockquote + lists + headings — block rhythm should now match.
- build + `lint:ci` clean.

## See also

- ADR-0003 (per-surface contracts: this closes the *preview↔VS-Code* spacing axis while keeping the
  *edit↔preview* divergence) and task 109 (which explicitly deferred this).
- The `vscode-*-2026` themes (already match palette + treatments + heading scale; this adds spacing).
- task 48 preview-scroll-preserve (the main regression risk).
- Skill `vmarkd-visual-debugging` (measure with the e2e/harness; goldens for the blockquote/code).
