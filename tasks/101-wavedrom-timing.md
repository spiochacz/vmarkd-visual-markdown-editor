# Task 101 — WaveDrom timing diagrams

> **🔎 Audit 2026-06-24 (task 142):** IMPLEMENTED — `renderWavedrom` is wired in `custom-diagrams.ts`
> (wavedrom 3.6.1 vendored), themed via `themeWavedromSvg` (signal colours kept, black→currentColor);
> status below is stale. Verify-first: `reg`/`assign` skins + `config` honoured. Mark done once verified.
>
> **🐛 Fix 2026-06-27:** the wave LINES were black/invisible on dark (user report). `themeWavedromSvg`
> only recoloured INLINE styles, but WaveDrom's wave lines (`.s1/.s2`), dashes (`.s3/.s4`) and hatch
> (`.s6`) get their colour from CLASSES in an embedded `<style>` skin (`stroke/fill/color:#000`). Now
> also rewrite that skin CSS: black → currentColor (incl. `color:#000`, which would otherwise pin
> currentColor itself to black), white fill → transparent; the pastel data fills (`.s8–.s14`) and the
> `#0041c4` arrows are left untouched. Test: `test/vscode-e2e/wavedrom-theme.spec.ts` (on github-dark a
> wave path resolves to the themed foreground, and the skin no longer hard-codes black).

> **Status:** 📋 TODO (after [task 99](99-geojson-topojson-maps.md) — reuses its renderer pass).
> Render ` ```wavedrom ` fenced blocks as digital **timing diagrams** (WaveJSON). Popular in
> hardware/EE docs; supported by Kroki/GitLab-adjacent tooling. Pure-JS, SVG, fully offline.
> **Source:** ecosystem survey (Kroki diagram set); user request.
> **Value / Risk:** 🟢 niche-but-clean / low — lightweight pure-JS, offline, SVG output.

## Problem
Timing diagrams (clocks, signals, registers) have no renderer in vMarkd. WaveDrom is the de-facto
text format (WaveJSON: `{ signal: [...] }`).

## Approach
1. **Reuse the custom fenced-renderer pass** from task 99 — register `{ lang: 'wavedrom', fn }`.
2. **Lib** — **wavedrom** (MIT, lightweight, SVG). Add as a `media-src` dep; lazy-import. Renders
   WaveJSON → inline SVG.
3. **Render** — parse the fenced JSON (WaveJSON; allow JS5/`eval`-free parse — use JSON, or a safe
   relaxed parser, NOT `eval`, to respect CSP); `WaveDrom.renderWaveForm`/`processAll` into the block;
   `data-processed` guard.
4. **CSP / offline** — SVG, no remote, **but avoid WaveDrom's `eval`-based skin loading** if any;
   bundle the default skin. Verify no `unsafe-eval` reliance beyond what we already allow.
5. **Theme** — WaveDrom has **skins**; pick light/dark by the content-theme mode, or tint
   waveform/label colors from the palette (`fg`/`line`). Live re-theme on flip.

## Tests (per AGENTS)
- **e2e** — a ` ```wavedrom ` WaveJSON block renders an SVG with wave paths (not a code block); no
  remote request; theme flip re-renders/retints.

## See also
- Skill `vmarkd-renderer-theming`; task 99 (renderer pass). [Kroki diagram set](https://kroki.io/).
