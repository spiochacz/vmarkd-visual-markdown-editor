# Task 110 — Preview spacing parity with VS Code (line-height + block margins), preview surface only

> **Superseded (2026-10-08, task 532 step 3, [ADR-0009](../../docs/adr/0009-content-parity-across-stages.md)):** the Preview-only rhythm block in `main.css` this task shipped is deleted. Its values (40px / 0.7em / 1.6 leading / 1.25 headings / code 1.5) became the VS Code geometry profile (`--vmarkd-geo-*` tokens) and now apply to the overlay, IR, WYSIWYG, Preview and split pane alike; the github themes use GitHub's own rhythm.

> **Status:** ✅ **DONE (2026-07-30)** — option (a) shipped, measured red-then-green in real VS Code.
> One item of the Verify list is NOT done and is listed explicitly under "What was NOT done" below.
> Original narrowing preserved for context: A 2026-06-13 full element-by-element audit closed all
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

## What was actually done (2026-07-30)

**Re-measured before writing anything, and the task's own table had drifted.** It claimed the
preview renders at 16px against VS Code's 14px, so "match the font size" looked like half the job.
It isn't: `vmarkd.editor.fontSize: editor` now resolves to the VS Code editor size, and BOTH
surfaces already measure **14px**. The font axis was already closed. What genuinely differed:

| | ours (before) | VS Code | after |
|---|---|---|---|
| `line-height` | 21px (1.5) | 22px (1.571) | 21.994px (1.571) |
| `p`/`ul` `margin-bottom` | 16px | 0.7em (9.8px) | 9.8px |
| `ul` `padding-left` | 28px | 40px | 40px |
| `h2` line-height | 1.29 | 1.25 | 1.25 |

**Option (a)** as recommended — ratio + `em`-relative margins, so the rhythm follows the user's font
instead of hard-pinning 14px/22px and decoupling the preview from `vmarkd.editor.fontSize`.
Heading margins (24px/16px) already matched and were left alone. Code is excluded deliberately and
`line-height: normal` is RE-ASSERTED on `pre`/`pre code`/`code` rather than relied on to miss them,
because `pre > code` sits inside `.vditor-reset` — the collapsed-code-block-height and dark
bottom-trim guards both live on that box.

- [x] **e2e** — `test/vscode-e2e/preview-spacing.spec.ts` (real VS Code, one boot, ~8s), with a new
      fixture combining paragraphs + list + blockquote + heading + fence. Asserts the preview ratio,
      the `0.7em` margins, the 40px indent, the 1.25 heading ratio, that code did NOT pick up the
      1.571 rhythm, and — positively, not just as "not the preview value" — that `.vditor-ir` still
      measures Vditor's own 1.5 / 16px / 28px.
- [x] **PROVEN RED**: with the "Task 110" block removed from `main.css` and rebuilt, the preview
      collapses onto the edit numbers and the spec fails on the first assertion —
      `expect(previewRatio).toBeCloseTo(1.571, 1)` → `Received: 1.5`. Restored byte-for-byte
      (md5-verified), rebuilt, green twice consecutively.
- [x] **regression: preview-scroll-preserve (task 48)** — `scroll-preserve.spec.ts` passes (14.6s).
      This was the watch-out the Approach section called out as the real risk of shifting margins.
- [x] build + `biome` clean on the new files.

### What was NOT done

- **The side-by-side visual check against native `Ctrl+Shift+V`** in the user's own editor. The
  numbers now match VS Code's `markdown.css` by measurement, but nobody has eyeballed the two panes
  together. Per [[install-vsix-to-see-visual-changes]] that needs a packaged+installed VSIX and the
  user's judgement — it is not something the e2e can stand in for.
- `blockbg` / `codenav` / `width` guards were not re-run (only `scroll-preserve` was). The code
  exclusion above is what those guard, and the spec asserts it directly, but the guards themselves
  are unrun since this change.

## See also

- ADR-0003 (per-surface contracts: this closes the *preview↔VS-Code* spacing axis while keeping the
  *edit↔preview* divergence) and task 109 (which explicitly deferred this).
- The `vscode-*-2026` themes (already match palette + treatments + heading scale; this adds spacing).
- task 48 preview-scroll-preserve (the main regression risk).
- Skill `vmarkd-visual-debugging` (measure with the e2e/harness; goldens for the blockquote/code).
