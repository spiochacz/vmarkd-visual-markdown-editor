# Task: Line-anchored scroll sync in split (SV) view

> **Status:** ✅ Done (2026-06-01).
> **Source:** user request (2026-06-01) — in Vditor's split mode the source and
> rendered panes drift apart; sections don't line up.
> **Value / Risk:** 🟡 medium (much better split-mode UX) / medium (overrides a
> Vditor internal; must avoid scroll-loop jank).
> **Engines:** none.

## Problem
Vditor's split view (`sv` mode: raw source | rendered preview) syncs scroll
**proportionally** — its scroll handler does, verbatim:

```js
preview.scrollTop = textScrollTop * preview.scrollHeight / textScrollHeight
```

It maps by the **ratio of total scroll heights**, ignoring where individual
lines/blocks actually sit. Because a rendered `<h1>` (large, with top margin) is
far taller than its one-line `# Heading` source, sections progressively drift —
the first heading already sits visibly lower in the preview than in the source.

## Goal
**Center-anchored** sync: the block at the **vertical centre** of the scrolled
pane lines up with the same block in the other pane. Blocks above/below may drift
slightly — acceptable (confirmed with the user).

## Approach
A small webview module (`media-src/src/split-scroll-sync.ts`), wired from
`main.ts` once after init.

1. **Listener:** one `scroll` listener on the editor root in the **capture**
   phase (scroll doesn't bubble, but capture still sees inner-pane scrolls). This
   survives mode switches (no rebinding) — it only acts when the scroll target is
   the SV source (`.vditor-sv`) or the preview (`.vditor-preview`) and the preview
   is visible (`display: block`).
2. **Heading anchors (not all blocks).** Top-level blocks don't pair 1:1: a link
   reference definition is a whole source block that renders to *nothing* (probed
   the CHANGELOG live — 68 source blocks vs 60 rendered, the 8-block gap being the
   `[ref]: url` lines). But every markdown heading renders to exactly one
   `<h1>..<h6>` in the same order (probed: 31 ↔ 31). So pair the **headings**:
   source blocks matching `/^#{1,6}\s/` ↔ preview `<h1..h6>`, by DOM order.
3. **Centre map:** find the heading segment bracketing the source viewport centre
   (virtual anchors at top 0↔0 and bottom fullHeight↔fullHeight), interpolate the
   centre's fraction within it, set `preview.scrollTop` so the same point is
   centred. **Fallback** (leave Vditor's proportional value) if heading counts
   differ or there are none.
4. **Loop guard:** programmatic `scrollTop` writes re-fire `scroll`; a flag
   cleared on the next animation frame suppresses the reverse sync.

Bidirectional (source↔preview). Only runs in `sv` mode.

## Risks / notes
- Overrides Vditor's own proportional handler by running **after** it (our write
  wins each tick). If Vditor ever changes its handler, re-check.
- Block-index pairing assumes 1:1 order; the proportional fallback covers
  mismatches so it degrades gracefully, never worse than today.
- `sv` is not the default mode (`ir` is); this only affects users who toggle split.

## Verify
Open a doc in split (`sv`) mode, scroll the source: the block at screen centre
stays aligned with the same block in the preview (e.g. a heading centred left is
centred right). Toggling back to `ir`/`wysiwyg` is unaffected. No scroll
juddering/feedback loop.
