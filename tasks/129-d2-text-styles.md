# Task 129 — D2 extra text styles (font-size, font, underline, text-transform)

> **Status:** 💡 idea / planned (low priority) — created 2026-06-24. Untasked D2 gap found auditing
> `main.go`. Needs a Go+WASM field extraction → batch with task 121/124 Phase B. Builds on task 104.

## Problem
D2 supports per-shape/edge text styling: `style.font-size`, `style.font` (font family),
`style.underline`, `style.text-transform` (`uppercase`/`lowercase`/`capitalize`/`none`). We honour
only `bold`, `italic`, `font-color` (via `textAttrs` in `d2-render.ts`); the rest are ignored, so e.g.
a deliberately large title or an underlined label renders at the default size with no decoration.

## Root cause
`main.go` marshals `bold/italic/fontColor` but not `FontSize/Font/Underline/TextTransform`. Not in the
graph → not rendered.

## Approach
- **WASM:** add `fontSize`, `font`, `underline`, `textTransform` to `outShape` (+ edge text if d2 allows
  it there). Update `d2-wasm.ts` types.
- **toSVG/textAttrs:** `font-size` → the `<text>` font-size; `underline` → `text-decoration="underline"`;
  `text-transform` → apply in JS to the label string (SVG has no reliable `text-transform`), or emit
  the CSS property; `font` → a font-family **only if** the family is one we actually bundle (offline —
  otherwise ignore + document, like the icon/CSP note in task 124).
- **⚠️ Sizing:** `font-size` changes the box that fits the label. The sizer (`canvasMeasure`) +
  `dimsToFit` must measure at the shape's font-size, not the global `FONT_SIZE`, or the box clips. Thread
  per-shape font-size through `leafInfo`/`shapeBox`.

## Decision gates
- `font` (family) is mostly unusable offline (we ship one font stack) — likely ignore + note rather
  than implement. Confirm scope = font-size + underline + text-transform.

## Acceptance / tests
- Unit: a shape with `font-size: 28` produces a `<text font-size="28">` AND a box sized for it (no
  clip); `underline` adds the decoration; `text-transform: uppercase` upper-cases the rendered label.
- Keep `d2-quality.test.ts` / typecheck / lint green; byte-stable on the 8 samples (none set these).

## Related
Tasks 104, 121/124 (shared WASM bump). `textAttrs`, `canvasMeasure`, `dimsToFit`/`shapeBox` in
`d2-render.ts`; style extraction in `main.go`.
