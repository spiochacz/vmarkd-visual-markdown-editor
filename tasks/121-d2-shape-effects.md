# Task 121 — D2 shape effects (shadow / 3d / multiple / double-border + fill-pattern)

> **Status:** 💡 idea / planned (decision-gated) — proposed 2026-06-21. **Unlike tasks 119
> (palettes) and 120 (sketch), this one needs a Go + WASM rebuild** — the effects are driven by D2
> `style.*` booleans our WASM does NOT currently extract. Builds on task 104. Decision gate: is it
> worth pulling in the Go toolchain for cosmetic effects? Recommendation: **yes, but batch** — bump
> the WASM ONCE and capture every missing style field.

## Problem
Real D2 renders `style.shadow`, `style.3d`, `style.multiple`, `style.double-border` (and
`fill-pattern`: dots/lines/grain/paper) for depth and texture. Our D2 (task 104) renders flat
shapes and never shows these.

## Root cause (the cost that makes this different from 119/120)
Our compile-only WASM entrypoint (`media-src/vendor/d2/build/main.go`) marshals only:
`fill, stroke, strokeWidth, strokeDash, opacity, fontColor, borderRadius, bold, italic`
(verified — `styleVal(o.Style.*)` list). The booleans these effects need
(`o.Style.Shadow`, `o.Style.ThreeDee`, `o.Style.Multiple`, `o.Style.DoubleBorder`,
`o.Style.FillPattern`, …) are simply **not read**, so the webview never knows a shape wants them.
Therefore this CANNOT be done purely in `toSVG()` like 119/120 — it requires extending the Go
marshaling and **rebuilding the 11 MB `d2-compile.wasm`** (Go toolchain via
`media-src/vendor/d2/build/build-d2-wasm.sh` + the font/latex stubs; see `build-notes.md`).

## Approach
1. **Extend `main.go` + rebuild WASM — ONCE, batched.** Add `styleVal(o.Style.Shadow/.ThreeDee/
   .Multiple/.DoubleBorder/.FillPattern)` and, since we're paying for a rebuild anyway, **every other
   missing style field too** (`underline`, `font-size`, anything D2 exposes we don't yet pass) so we
   never bump the WASM just for a style again. Rebuild via `build-d2-wasm.sh`; update `source.json`
   sha + `D2_VER` cache-buster (`d2-wasm.ts`).
2. **Extend the contract.** Add the new fields to `D2Shape` (`d2-wasm.ts`) to match the Go JSON
   (kept in sync, guarded by `d2-wasm.test.ts`).
3. **Render the effects in `toSVG()` (`d2-render.ts`) — pure, ours:**
   - **shadow** → an SVG `<filter>` with `feDropShadow` in `<defs>`, `filter="url(#…)"` on the shape.
   - **3d** (rect/square only) → an offset duplicate + side faces (a few polygons) behind the front.
   - **multiple** → 1–2 offset duplicate outlines behind the shape (stacked look).
   - **double-border** → a second inset rect/ellipse stroke.
   - **fill-pattern** → an SVG `<pattern>` (dots/lines/grain) in `<defs>` referenced by `fill`.
4. **Gradients (separate, pure-TS, no WASM).** D2 source has no per-shape gradient fill; the gradient
   look is theme/renderer-side. If wanted, SYNTHESIZE one — a `<linearGradient>` in `<defs>` derived
   from the shape's (task-119) palette colour. Track as a sub-option that **composes with task 119**,
   not a WASM concern.

## Gotchas
- **WASM rebuild is the gate.** Needs the Go toolchain + the embed stubs. Confirm a clean rebuild
  reproduces the current bytes (plus the new fields) before shipping; keep `source.json` sha honest.
- **Scope effects to the right shapes.** D2 `3d` applies to rectangle/square only; `multiple`/`shadow`
  are general. Mirror D2's applicability so we don't draw nonsense (3d on a cylinder).
- **Z-order.** Duplicates (3d/multiple) and shadows go **behind** the shape; emit them before the
  primitive (our `toSVG` already orders containers/grids behind leaves — extend that ordering).
- **currentColor / theme.** Shadow colour should be subtle and theme-aware (e.g. low-opacity
  `currentColor`, not hard black); pattern strokes follow `currentColor`/palette so they theme. 3d
  side-faces want a darker shade of the fill (`mix(fill, …)` via `mermaid-palettes.ts` helpers).
- **Compose with 119/120.** Effects sit on top of the shared `{fill, stroke, fontColor}` resolver
  (task 119) and must also work under sketch (task 120) — a sketched shape with a shadow/3d should
  still read; design the emit so effects wrap whatever primitive (crisp or rough) is produced.
- **Perf / size.** `<defs>` filters/patterns are cheap; 3d/multiple add a few elements per shape —
  fine. The real cost is the one-time WASM rebuild, not runtime.

## Tests (per AGENTS — unit + e2e + verify coverage)
- **Unit** (`d2-wasm.test.ts`) — the new style booleans round-trip from a D2 source through the
  rebuilt WASM into `D2Shape`. (`d2-render.test.ts`) — a shape with `shadow` emits a `<filter>`/
  `filter=` ref; `3d`/`multiple` emit the extra duplicate elements behind; `double-border` emits the
  second stroke; `fill-pattern` emits a `<pattern>`; a plain shape emits none of these.
- **e2e / real-VS-Code** — a ` ```d2 ` block using these styles renders the effects (live proof in
  `test/vscode-e2e/`, like task 104 / d2-elk; harness D2 assertions are `fixme`).

## See also
- Skill `vmarkd-renderer-theming` (we own this renderer end-to-end; CSP/`wasm-unsafe-eval` note).
- **Task 104** (D2 renderer + the WASM contract this extends), **119** (palettes — shared style
  resolver, gradient synthesis), **120** (sketch — effects must compose with it).
- D2 docs: `style.shadow` / `style.3d` / `style.multiple` / `style.double-border` / `fill-pattern`.
- Files: `media-src/vendor/d2/build/main.go` + `build-d2-wasm.sh` + `build-notes.md` + `source.json`,
  `media-src/src/d2-wasm.ts` (`D2Shape` + `D2_VER`), `media-src/src/d2-render.ts` (`toSVG`),
  `media-src/src/d2-wasm.test.ts` / `d2-render.test.ts`.
