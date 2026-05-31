# Task: Outline navigation + heading flash (all modes)

> **Status:** ✅ Done (Option 1). `media-src/src/outline.ts` `setupOutlineFlash` (capture-phase, since Vditor stops bubble propagation); flashes the clicked heading by id, all modes. Setting `outlineHighlight` (default true). e2e: outline.spec.
> **Source:** `systemator-de/vscode-markdown-editor` (WYSIWYG-only; we rework for all modes)
> **Derived from (removed plan):** `outline-heading-highlight-plan.md`
> **Value / Risk:** 🟢 / low (Option 1) — medium (Option 2)

## Goal
Clicking a heading in the outline scrolls the editor to it and briefly flashes it,
in **whatever mode is active** (IR / WYSIWYG / SV). systemator-de's version is
WYSIWYG-only, matches by ordinal index, and miscounts `#` inside fenced code blocks.

## Option 1 — reuse Vditor's built-in outline ✅ recommended
Vditor's own outline already navigates correctly in every mode. Only add the flash:
- Listen on the outline container (`vditor.vditor.outline.element`) for item clicks.
- After Vditor scrolls, resolve the landed heading element and apply the flash (Part C).
- Zero source-line mapping needed. Cheapest path to all-mode support.

## Option 2 — VS Code-side outline (only for native Outline/breadcrumbs)
1. Extension parses headings (line numbers), exposes via `TreeView` /
   `DocumentSymbolProvider`.
2. On click, post `{ command: 'revealHeading', line: N }` (source line as anchor).
3. Webview does mode-aware reveal — code-fence-aware ordinal:
   ```ts
   function headingOrdinalForLine(md, line) {
     const lines = md.split('\n'); let inFence = false, ordinal = -1
     for (let i = 0; i <= line && i < lines.length; i++) {
       const t = lines[i]
       if (/^\s*(```|~~~)/.test(t)) { inFence = !inFence; continue }
       if (!inFence && /^#{1,6}\s+/.test(t)) ordinal++
     }
     return ordinal
   }
   ```
   - WYSIWYG/IR: `el.querySelectorAll('h1,h2,h3,h4,h5,h6')[ordinal]` →
     `scrollIntoView({behavior:'smooth',block:'center'})` → flash.
   - SV: no discrete heading nodes — place a `Range` at source line `N`, scroll;
     flash best-effort. Document as a known SV limitation.
   - `el = vditor.vditor[vditor.vditor.currentMode]?.element` — do **not** force
     `mode:'wysiwyg'` like systemator-de.

## Part C — theme-aware flash (shared)
```css
.heading-flash { animation: heading-flash 1.4s ease-out; }
@keyframes heading-flash {
  0%   { background-color: var(--vscode-editor-findMatchHighlightBackground, rgba(255,213,0,.4)); }
  100% { background-color: transparent; }
}
```
```ts
function flash(el) { if (!el) return; el.classList.add('heading-flash'); setTimeout(() => el.classList.remove('heading-flash'), 1400) }
```
Optional setting: `markdown-editor.outlineHighlight` (boolean, default true).

## See also
- `07-...` / `08-...` configure the same outline panel — this adds only the flash.

## Verify
Manual test in the Extension Development Host across IR/WYSIWYG/SV, including a
document with a fenced code block containing `#` (must not shift the target).
