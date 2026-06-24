# Task 136 — PlantUML `!include` / standard library / sprites (C4, AWS, Azure, archimate)

> **Status:** 💡 idea / investigation (HIGH priority) — created 2026-06-24. Biggest real gap in our
> offline PlantUML (task 87). Builds on task 87 (TeaVM engine, `patchPlantumlRender` in
> `media-src/esbuild-shared.mjs`).

## Problem
PlantUML diagrams routinely pull external content:
```plantuml
!include <C4/C4_Container>
!include <awslib/AWSCommon>
!include <azure/AzureCommon>
!includeurl https://.../archimate.puml
```
`!include` (bundled stdlib), `!includeurl` (remote), and the standard-library sprite sets (C4,
AWS/Azure icons, archimate, …) reference files. We render **fully offline** with no filesystem and a
strict CSP, so:
- `!includeurl <remote>` → blocked (no remote fetch, by design — privacy + offline).
- `!include <stdlib/...>` → works ONLY if the TeaVM `plantuml.js` build bundles plantuml-stdlib.
  **Unverified.** If it doesn't, C4/AWS/Azure diagrams fail (compile error → raw source fallback).

C4 + AWS/Azure architecture diagrams are extremely common, so this is the highest-value gap.

## Step 0 — VERIFY (do this first, it decides everything)
Render a `!include <C4/C4_Container>` (and an `<awslib/...>`) diagram through our actual engine
(`media/vditor/dist/js/plantuml/plantuml.js`, e.g. a throwaway harness like `tmp/d2-compare`'s, or the
real-VS-Code suite) and see whether the stdlib resolves. Outcomes:
- **Bundled** → C4/AWS already work; downgrade this task to "add a C4 example + test" and document it.
- **Not bundled** → proceed below.

## Approach (if stdlib is NOT bundled)
- **Vendor plantuml-stdlib** (the `stdlib/` from `plantuml/plantuml-stdlib`, MIT) and teach the TeaVM
  engine / our `plantumlRender` patch to resolve `!include <...>` against it (an in-memory file map the
  engine can read). Size-gate it (sha-pinned like the engine) and lazy-load — the full stdlib is large,
  so consider shipping only the popular sets (C4, AWS, Azure) or all behind the lazy plantuml load.
- **`!includeurl` (remote):** keep unsupported (offline). Detect it → clear note ("remote includes are
  disabled offline"), like the d2-imports task (131). Optionally host-side resolve later (the extension
  host has network/FS) — separate, gated.
- **Local `!include "file.puml"`** (sibling file): like d2 imports — needs host-side resolution against
  the `.md` folder; defer / separate.

## Decision gates
- Bundle the whole stdlib (big) vs a curated subset (C4/AWS/Azure) vs none-just-document. Decide after
  Step 0 + a size check.

## Acceptance / tests
- A C4 (`!include <C4/C4_Container>`) diagram renders an SVG offline (real-VS-Code), or — if out of
  scope — shows a precise "stdlib/include not available offline" note (never a silent failure).
- Keep typecheck / lint / `npm test` green.

## Related
Task 87 (PlantUML offline), 131 (d2 imports — same offline/no-FS shape), 67 (CSP). Patch +
`themePumlSvg` in `media-src/esbuild-shared.mjs`; vendored engine `media-src/vendor/plantuml/`.
