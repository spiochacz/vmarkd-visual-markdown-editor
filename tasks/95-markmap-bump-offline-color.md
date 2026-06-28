# Task 95 — Full markmap bump (0.14.3 → 0.18.x) + offline bundle + color strategy

> **Status:** ✅ DONE (bump + offline bundle) / ❌ colour-strategy DROPPED (2026-06-28).
> The bump SHIPPED (it landed in commit `dfbd952`): `media-src/vendor/markmap/` is a **custom combined
> offline bundle** = d3 7.9.0 (tree-shaken) + markmap-lib 0.18.12 + markmap-view 0.18.12, concatenated
> onto `window.markmap` (no CDN autoloader — the inert jsdelivr/unpkg strings from markmap-view aren't
> on the render path; CSP `default-src 'none'` + the e2e prove offline). **0.18.12 is the current latest**
> (npm markmap-lib/view both 0.18.12). The spike blocker (`Markmap.create` "n is not a constructor") is
> **resolved in shipped code** — real-VS-Code e2e renders markmap (markmap-resize/diagram-zoom/
> diagram-width specs). This round closed the verification gap: added a **pin guard**
> (`custom-diagrams-pin.test.ts`: sha + `window.markmap`/`Markmap`/`Transformer` + version 0.18.12 +
> MIT/ISC) and confirmed the e2e. The esbuild `?v=` patch emits `markmap.min.js?v=0.18.12`.
>
> **Colour strategy: NOT done — and dropped by decision (2026-06-28, user): markmap stays baked, no
> theming, ever** (ADR-0006 §6). markmap keeps its multi-colour identity; no live re-theme. The rest of
> this file's colour design is historical only.

## Problem
1. **Stale + can't drop-in.** Bundled markmap is **0.14.3** (combined UMD with d3 6.7.0).
   `markmapRender.ts` expects `window.markmap = { Transformer, Markmap, deriveOptions, globalCSS }`
   and calls `Markmap.create(svg, null)`. In **0.18** those live in **separate** packages
   (`Transformer` ← markmap-lib; `Markmap`/`deriveOptions`/`globalCSS` ← markmap-view; **d3** is
   an external peer). Upstream's browser story is now `markmap-autoloader` — which **fetches from
   a CDN at runtime** → breaks our offline guarantee + CSP `default-src 'none'`. So a bump needs a
   **self-built offline bundle**, not a file swap and not the autoloader.
2. **No theming hook.** markmap colors branches with a categorical d3 palette and draws on a
   transparent background — there's no CSS/options "theme". On some content themes the text,
   links, and fold circles can be low-contrast. Needs a deliberate color strategy (below).
3. No `?v=` cache-buster on the current load (`markmap.min.js`).

## Part A — Offline bundle + bump (the engineering)
1. **Build a combined UMD offline** (esbuild, our own step — e.g. `media-src/scripts/build-markmap.mjs`
   or a `build.mjs` sub-step): bundle `markmap-lib` + `markmap-view` + the `d3` pieces markmap-view
   needs into ONE file that assigns `window.markmap = { Transformer, Markmap, deriveOptions,
   globalCSS, … }` — the exact shape `markmapRender.ts` reads. Pin the versions; **no CDN, no
   autoloader**. Verify the global shape head/tail (like the Mermaid global check).
2. **Vendor + sync** like the others: `media-src/vendor/markmap/{markmap.min.js,source.json,
   LICENSE,NOTICE}` (markmap is **MIT**; d3 is **ISC/BSD** — ship both notices), `build.mjs`
   `syncMarkmap()` sha-verifies + copies over `media/vditor/dist/js/markmap/markmap.min.js`.
3. **Cache-buster** — add `?v=<version>` via an esbuild patch on `markmapRender.ts`
   (`fixMarkmapVersion`, mirror `fixMermaidVersion`) since none exists today.
4. **API compat (verify)** — confirm 0.18 still exposes `Transformer`, `Markmap.create(svg, opts)`,
   `deriveOptions`, `globalCSS`, and that `transformer.transform(code)` → `{root, frontmatter}` +
   `transformer.getAssets()` behave as `markmapRender.ts` expects. Patch the renderer only if the
   call shape drifted. Watch d3 v6 (bundled) → d3 v7 (0.18 era) changes.
5. **Size** — d3 + markmap is ~MB; measure the built bundle vs the current 824 KB. Lazy-load is
   already the case (loaded only when a `markmap` block exists).

## Part B — Color strategy (ANALYZE — open design question)
markmap has **no stylesheet to theme**; its only levers are the **`color` option** (a
`(node) => string` function), `colorFreezeLevel`, and the SVG's inherited text/line colors.
Goal: look good on **any** content-theme background (light/dark/palette) without killing markmap's
signature multi-color branches. **Investigate + decide** (record the choice in this file):
- **Option 1 — keep categorical, fix contrast:** keep markmap's per-branch hues but pick a
  categorical scheme with adequate contrast on both light and dark surfaces (or two schemes chosen
  by the content theme's `mode`). Text/links use `fg`/`line` from the palette so structure reads on
  any bg; branch color stays decorative.
- **Option 2 — palette-derived scheme:** derive the categorical `color` range from the content
  theme's `accent` (+ a few rotations) so branches harmonize with the theme. Reuses the shared
  palette mapping (task 86/90) — `paletteToMarkmapColors(palette)`.
- **Option 3 — monochrome by depth:** `colorFreezeLevel` + a single `accent`/`fg` ramp. Cleanest
  on any bg but loses the multi-color identity.
- **Cross-cutting:** ensure **link/curve color** and **fold-circle** color come from `line`/`fg`
  (not a hardcoded dark) so they're visible on dark themes — that's the actual readability bug.
Prototype 2–3 of these against a real outline on light + dark + a couple palettes; pick the best,
document why. Likely **Option 1 or 2** (preserve identity + guarantee contrast).

## Part C — Live re-theme
markmap paints once. Mirror `reRenderMermaid`'s offscreen-swap so a content-theme/VS Code flip
re-renders with the chosen colors; wire into `main.ts` `handleSetTheme` + `handleConfigChanged`.

## Tests (per AGENTS)
- **`test/backend/markmap-pin.test.ts`** — sha/version/global-shape (`window.markmap` exports) +
  MIT/d3 notice guards (mirror `mermaid-pin.test.ts`).
- **e2e** — a `\`\`\`markmap` block renders on the bumped bundle; loaded script src carries `?v=`;
  link/text colors are the palette's (not black) → readable on a dark theme; theme flip re-renders.

## See also
- Skill `vmarkd-renderer-theming` (offline-bundle/overwrite-after-sync/`?v=` gotchas; the
  "identify the lever" discipline — markmap's lever is the `color` fn, not CSS).
- Task 86 (`syncMermaid`/`fixMermaidVersion` precedent + shared palette mapping for Option 2),
  task 59 (`reRenderMermaid` to mirror).
- `media-src/node_modules/vditor/src/ts/markdown/markmapRender.ts`; upstream `markmap/markmap`
  (markmap-lib + markmap-view + markmap-autoloader — note the autoloader is CDN-based, avoid).
