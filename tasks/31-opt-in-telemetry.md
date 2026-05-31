# Task: Opt-in telemetry (createTelemetryLogger)

> **Status:** ⏸ Parked (2026-05-31). Unblocked, but deferred by decision —
> runs counter to the privacy posture (task 18 §2d, "never transmit content")
> and adds review scrutiny for little benefit. Revisit only with a concrete
> metric worth collecting.
> **Source:** vMark VS Code stable-API audit (opt-in telemetry)
> **Value / Risk:** ⚪ low priority — only if you actually want metrics / low
> **Engines:** ⚠️ `env.createTelemetryLogger` ≈ `^1.75` — requires an engines bump
> (moot if task 33 raises the floor to `^1.110`; see README engines note)

## When to do this
Only worth it if you want usage/error signals (e.g. which features are used, init
failures). Skip otherwise — telemetry adds privacy surface and review scrutiny.

## Goal
Respectful, opt-in telemetry that honors `telemetry.telemetryLevel` automatically.

## Steps
1. Create a logger via `vscode.env.createTelemetryLogger(sender)` where `sender`
   implements `sendEventData` / `sendErrorData`. The platform gates it on the user's
   telemetry setting — never send when disabled.
2. Instrument a few high-signal points: extension activation, editor open, init
   failure (the `initVditor` catch path already exists webview-side), upload errors.
   **Never** include document content or file paths.
3. Add a `telemetry` note to README + a privacy line; declare nothing that implies
   always-on collection.
4. Bump `engines.vscode` + `@types/vscode` to `^1.75` (or the task-33 floor).

## See also
- `18-security-hardening.md` §2d — same "never log/transmit content" rule.
- `33-themeicon-tab.md` — if taken, the engines floor is `^1.110` and this bump is free.

## Verify
With `telemetry.telemetryLevel: off` → no events sent (verify via the logger's
no-op behavior / Output). With telemetry on → events appear, never carrying content.
