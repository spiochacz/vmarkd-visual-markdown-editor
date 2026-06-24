# Task 147 — Vditor patch-engine hardening (close the silent-drift holes)

> **Status:** 📋 TODO — created 2026-06-24 from an audit of the whole `VDITOR_TS_PATCHES` registry +
> the esbuild onLoad engine + its drift tests. Robustness, not a feature.
> **Source:** architecture review (2026-06-24).
> **Value / Risk:** 🟢 removes the few silent-failure paths in an otherwise strong system / low —
> assertions + tests + small consistency fixes, no behavioural change.

## What's already strong (do NOT regress)
- **One generic engine** `vditorSourcePatches` iterating a declarative `VDITOR_TS_PATCHES` registry
  (`media-src/esbuild-shared.mjs`) — replaced ~14 near-identical per-patch plugin objects.
- **23 patches, 22 fail-loud** with a named "version drift?" error when their anchor is missing.
- **Double drift net:** `test/backend/vditor-source-patches.test.ts` reads the REAL vendored Vditor
  source (chartRender, markmap, graphviz, flowchart, mindmap, plantuml, abc, ir/index, …) and runs
  each patch against it; AND `node build.mjs` runs in CI (`.github/workflows/ci.yml:40`) so the
  throwers fail the build on drift. This is the right design.

## Findings → work items (by ROI)

### 1. 🟠 Silent no-op cache-buster bumps — the one real hole
The SMILES registry entry does `if (!code.includes(anchor)) return code` (`esbuild-shared.mjs:1089`)
— **silent** — with a version-literal anchor (`smiles-drawer.min.js?v=2.1.7`), and the smiles source
is NOT asserted by the drift test. So a Vditor smiles-version bump → the `?v=` rewrite silently
doesn't apply → a **stale/cached asset ships**, with no build throw and no test failure. Same risk
class for any `?v=` literal anchor not asserted against real source.
- **Fix:** make every version-bump anchor fail-loud like the other 22 (throw on miss), OR add a
  real-source assertion in the drift test for each `?v=` patch (smiles, and verify mermaid/echarts/
  markmap version bumps are each covered against the actual vendored file). Prefer fail-loud — it's
  consistent with the rest and catches drift at build, not just in the test suite.

### 2. 🟠 Two whole-function string rewrites vs 21 surgical replaces
21 patches do a small targeted `code.replace(ANCHOR, …)` (robust — survives surrounding Vditor
changes). Only `patchPlantumlRender` + `patchGraphvizRender` replace the ENTIRE function via a JS
string (fragile + untyped). Already tracked in [task 144](144-plantuml-architecture-hardening.md)
(item 1 there covers BOTH plantuml and graphviz). Recorded here for the engine-wide picture: the 21
surgical replaces are the pattern to converge on.

### 3. 🟡 No mutual-exclusion guard on registry filters
The engine relies on esbuild running only the FIRST matching `onLoad` per file (documented). Adding a
second registry entry with an overlapping `file` filter would silently never run. Each entry targets
a distinct file today, but nothing enforces it.
- **Fix:** a one-time assert in `setup()` (or a unit test over `VDITOR_TS_PATCHES`) that no two
  filters match the same vendored file path — turns a future silent-drop into a loud error.

### 4. 🟡 Anchor fragility spectrum — prefer structural anchors
Anchors range from robust structural ones (`export const insertAfterBlock =`,
`plantumlEncoder.encode(text)`) to fragile cosmetic literals: the Chinese copy-tip string
(`已复制到剪切板`, `patchPreviewCopyTip`), version literals, and the whitespace-sensitive multiline
`itemStyle: { … }` (`patchMindmapThemeColors`). Cosmetic anchors break on a Vditor reformat / i18n
change even when the logic is intact (false drift) — or silently miss (#1).
- **Fix:** catalogue each patch's anchor + its fragility (structural vs literal vs whitespace), and
  re-anchor the fragile ones onto structural tokens where a stabler anchor exists.

### 5. 🟡 23-patch surface = a per-bump audit; give it a checklist
A Vditor version bump is a 23-anchor audit. Inherent to the fork-patch strategy, but undocumented as
a procedure. Add a consolidated "Vditor bump checklist" (in `DEVELOPMENT.md` or an ADR) enumerating
all 23 patches, the anchor each depends on, what it guards, and which are silent (#1). The drift test
partly serves this — the doc makes the procedure explicit.

## Tests (per AGENTS)
- **unit** — extend `vditor-source-patches.test.ts`: a real-source assertion for the smiles `?v=`
  anchor (and any other version-bump patch lacking one); a test that `VDITOR_TS_PATCHES` filters are
  mutually exclusive (#3).
- The existing per-patch unit tests + CI build remain the primary drift net.

## See also
- `media-src/esbuild-shared.mjs` (`VDITOR_TS_PATCHES` + `vditorSourcePatches` engine),
  `test/backend/vditor-source-patches.test.ts`, `.github/workflows/ci.yml`.
- [Task 144](144-plantuml-architecture-hardening.md) (the plantuml/graphviz string→module extraction).
- Memory: "Vditor index.css = single linked copy" (the CSS-is-NOT-in-this-registry rule / ADR-0004).
