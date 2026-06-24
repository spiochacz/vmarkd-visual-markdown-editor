# Task 137 — PlantUML diagram-type coverage (verify what the TeaVM build supports)

> **Status:** 💡 investigation — created 2026-06-24. We don't actually know which PlantUML diagram
> types our offline TeaVM engine (task 87) renders. Builds on task 87.

## Problem
PlantUML supports many diagram types: sequence, class, usecase, activity (legacy + beta), component,
state, object, deployment, timing, ER, **gantt**, **mindmap/wbs**, **json/yaml**, **salt** (UI
mockups), **ditaa**, **nwdiag/network**, **AsciiMath/JLaTeXMath** (math), etc. The TeaVM
(`plantuml.js`) build may not include all of them (some pull extra deps — ditaa, math, salt). We ship
it as a black box and haven't mapped what works vs what silently fails to a compile error.

## Goal
Produce a **support matrix**: render one minimal example of each diagram type through our actual engine
(`media/vditor/dist/js/plantuml/plantuml.js`) and record PASS / FAIL / partial. Turn the result into:
- a short doc/table (which types work offline),
- a decision on the FAILs (accept + document, or pursue),
- (optionally) clearer messaging when an unsupported type is used.

## Approach
- Throwaway harness (like `tmp/d2-compare`) or a real-VS-Code spec that feeds each ` ```plantuml `
  type and checks for an `<svg>` vs an error.
- Cover at least: sequence, class, usecase, activity-beta, component, state, object, deployment, ER,
  gantt, mindmap, wbs, json, yaml, salt, ditaa, nwdiag, timing, math.
- Note which need stdlib/sprites (overlaps task 136 — C4 etc.).

## Decision gates
- For each FAIL: is it worth pursuing (likely no for ditaa/math/salt; maybe yes for gantt/mindmap)?
  Default = document as unsupported + keep the loud raw-source fallback.

## Acceptance / tests
- A committed support matrix (doc) + a small real-VS-Code test asserting the core types render an SVG.
- Unsupported types fall back to raw source loudly (faithful-by-construction), ideally with a type-aware
  note.

## Related
Task 87 (engine), 136 (stdlib/C4 — a coverage subcase). Engine at `media-src/vendor/plantuml/`.
