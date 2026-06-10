# Task 101 — WaveDrom timing diagrams

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
