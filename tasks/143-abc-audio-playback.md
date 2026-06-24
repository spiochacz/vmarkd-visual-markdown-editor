# Task 143 — abc.js audio / MIDI playback (play the score)

> **Status:** 💡 idea / decision-gated — created 2026-06-24. The one clearly-untasked, confirmed gap
> from the renderer audit (task 142). Builds on the abc renderer (abcjs 6.6.3, theming task 93).

## Problem
We render ABC notation to an SVG score (Vditor `abcRender` + theming, task 93) but **abc.js can also
PLAY it** (`ABCJS.synth.*` — synth/MIDI), which we don't wire. So a music block is visual-only; you
can't hear it. abc.js exposes a `CreateSynth` / `SynthController` API and a ready-made play widget.

## The offline catch (the reason it's gated)
abc.js synth needs **instrument samples (a soundfont)**. abc.js defaults to fetching them from a
**remote CDN** (`paulrosen.github.io/midi-js-soundfonts/…`). Under our CSP (`default-src 'none'`,
`connect-src` self only) a remote soundfont **won't load**, and offline-first forbids it. So audio
requires **vendoring a soundfont** (sha-pinned, lazy-loaded) and pointing abc.js at the local copy —
non-trivial size (a general-MIDI soundfont is several MB; could ship just piano).

## Approach
- Add a small **play affordance** under each abc score (play/stop + maybe a progress cursor — abc.js
  can highlight notes during playback).
- Wire `ABCJS.synth` against a **vendored soundfont** (sha-pinned in `media-src/vendor/`, lazy-loaded
  only on first play, like the plantuml engine). Probably ship **piano only** to bound size; document
  that other instruments fall back to piano offline.
- `WebAudio` is allowed (no CSP hole needed); only the soundfont fetch is the constraint → local file.
- Respect autoplay rules: play only on user gesture; no sound on render.

## Decision gates
- Is audio worth a multi-MB vendored soundfont? Options: (a) skip (visual-only, document); (b) piano-only
  vendored soundfont; (c) full GM soundfont (largest). Recommendation: (b) if wanted, else (a).
- Lazy-load the soundfont ONLY when the user hits play (not on render) so docs without playback pay nothing.

## Acceptance / tests
- A play button appears under an abc block; pressing it plays the score offline (vendored soundfont),
  no remote fetch (CSP clean); stop works; no audio on initial render.
- Unit/e2e for the wiring; keep the visual render + theming (task 93) unchanged.

## Related
Task 93 (abc theming), 142 (audit), 87 (the lazy-vendored-engine + sha-pin pattern to mirror).
abc renderer: Vditor `abcRender.ts` + `media-src/src/abc-fit.ts`.
