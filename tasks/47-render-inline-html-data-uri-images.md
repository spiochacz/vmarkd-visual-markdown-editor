# Task: Render inline-HTML / data-URI images in the webview

> **Status:** ⏳ Todo — **to consider** (logged 2026-06-01, not scheduled).
> **Source:** user request (2026-06-01). Surfaced when an MD report using inline
> `<img src="data:image/svg+xml;base64,…">` rendered **blank** in vMarkd while
> rendering fine in a browser / VS Code Markdown preview.
> **Value / Risk:** ⚪ niche (most docs use `![](path)` / `https:` images) /
> low–medium (touches the renderer's HTML handling; keep the CSP posture intact).
> **Engines:** none.

## Problem
A markdown document containing **raw inline HTML** image tags with **data-URI**
sources — e.g. inside a table cell:

```html
<img width="24" src="data:image/svg+xml;base64,PHN2Zy…">
```

renders as an **empty cell** in vMarkd. The same file renders correctly in a
browser and in VS Code's built-in Markdown preview.

## Diagnosis — it is NOT the CSP
The webview CSP **already allows** data-URI images. `src/extension.ts` (task 18
§2c) ships:

```
img-src ${csp} data: blob: https:;
```

So `data:` images are permitted at the policy layer. The blank cells come from
**Vditor's markdown→HTML pipeline**, not the CSP:

- Vditor sanitizes rendered HTML (its own `sanitize`/whitelist). Raw inline
  `<img>` — especially inside **GFM table cells** — is a likely casualty: either
  the tag is stripped, the `src` is dropped, or inline HTML inside the table cell
  is not treated as HTML at all.
- This is a **renderer behaviour**, independent of our security hardening.

## Goal
Decide whether vMarkd should render inline-HTML images (and inline HTML more
generally) the way VS Code's Markdown preview does — and if so, enable it without
weakening the CSP/nonce model (task 18).

## Approach (investigate)
1. **Confirm the stripper.** Render a minimal doc with (a) `<img src="data:…">`
   outside a table, (b) the same inside a table cell, (c) a normal
   `![](https://…)` and `![](relative.png)`. Determine exactly what Vditor drops
   and where (table cell vs paragraph; data: vs https:).
2. **Find the Vditor knob.** Check Vditor render options for HTML passthrough /
   sanitize configuration (e.g. `preview.transform`, `preview.markdown.sanitize`,
   or a custom `renderers` hook). Vditor historically uses Lute for rendering —
   the sanitize step may be in the IR/SV/WYSIWYG render path. Identify the option
   that allows `<img data:…>` through the whitelist.
3. **Keep CSP intact.** Whatever is enabled must stay within the existing CSP
   (`img-src … data: blob: https:` already covers it). Do **not** relax
   `script-src`; this is about HTML/img sanitize, not script execution.
4. **Scope the risk.** Allowing arbitrary inline HTML can reintroduce XSS-ish
   surface (e.g. `<img onerror=…>`). Prefer a **narrow** allow (img with safe
   `src` schemes) over a blanket "disable sanitize". The CSP (`script-src` by
   nonce, `default-src 'none'`) is the backstop, but don't lean on it alone.

## Decision notes
- Most real markdown uses `![alt](path-or-url)` images, which already work. This
  task only matters if users paste **inline-HTML** images or **data-URI** assets
  (self-contained docs, generated reports, some export formats).
- If the risk/benefit doesn't justify it, **document the limitation** (README /
  known-limitations) instead of changing the renderer, and close this as wontfix.

## Reported upstream (repro + verify these)
- Vditor **#1923** — "Render inline HTML-Code" — users expect inline HTML to render; confirms the demand. Verify our outcome (render vs documented limitation) against this case. https://github.com/Vanessa219/vditor/issues/1923

## Verify
Open a `.md` that embeds `<img src="data:image/svg+xml;base64,…">` (in a table and
in a paragraph) → the images render in vMarkd, matching VS Code's Markdown
preview. Normal `![](…)` images still render. The CSP/nonce posture from task 18
is unchanged (no `unsafe-inline` script, no broadened `script-src`).

## See also
- `18-security-hardening.md` — the CSP/nonce model (§2c). The CSP already permits
  data: images; this task is about Vditor's sanitize, not the policy.
