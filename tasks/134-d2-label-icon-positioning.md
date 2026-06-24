# Task 134 — D2 label / icon positioning (`label.near` / `icon.near`)

> **Status:** 💡 idea / planned (low-medium) — created 2026-06-24. Untasked D2 gap (a distinct docs
> section). Needs a Go+WASM field extraction → batch with task 121/124 Phase B. Builds on task 104 and
> the icon work (task 124 item 3).

## Problem
D2 can position a shape's **label** or **icon** at a corner/edge instead of the centre:
```d2
server: Server { label.near: top-center }
db: Database { shape: cylinder; icon: ...; icon.near: top-left }
```
We **always centre** the label (`textAttrs` call sites place text at `cx,cy`), and icons aren't drawn
yet (task 124). `grep label.near` = nothing — `label.near` / `icon.near` are ignored.

## Root cause
`main.go` doesn't marshal `label.near` / `icon.near`; the webview centres unconditionally.

## Approach
- **WASM:** add `labelNear` / `iconNear` to `outShape` (the 8 viewport-style constants D2 allows for
  in-shape placement: `top-left … bottom-right`, plus `outside-*` variants d2 supports). Update
  `d2-wasm.ts`.
- **toSVG:** compute the label anchor from `labelNear` (corner/edge of the shape box, with padding +
  `text-anchor`/baseline adjusted) instead of the hard-coded centre. Same for the icon box once icons
  land (task 124). Keep centre as the default.
- Note: the bespoke shapes already special-case label position (person below, cylinder below the cap,
  callout above the tail) — `label.near` should override those when set.

## Decision gates
- Scope: the 8 inside positions first; d2's `outside-*` (label outside the shape) needs extra box room
  in `dimsToFit` — defer.
- Interplay with the existing per-shape label offsets (person/cylinder/callout) — `label.near` wins.

## Acceptance / tests
- Unit: a shape with `label.near: top-center` renders its `<text>` anchored at the top-centre of the
  box (not the middle); default (unset) stays centred (byte-stable on the 8 samples).
- Keep `d2-quality.test.ts` / typecheck / lint green.

## Related
Tasks 104, 124 (icons), 121/124 (WASM bump). `textAttrs` call sites + the per-shape label offsets in
`d2-render.ts`; extraction in `main.go`.
