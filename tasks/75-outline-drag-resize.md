# Task: Outline panel drag-resize + persist width

> **Status:** ✅ DONE (2026-06-05). Drag handle on the inner edge of the outline
> panel (col-resize cursor, VS Code sash color on hover). Width persisted in
> `globalState` (survives restart + Settings Sync). Setting `vmarkd.outline.width`
> removed — width is now user-controlled via drag.
> **Value / Risk:** 🟢 natural resize UX like VS Code panels / low.

## What
The outline panel had a fixed width controlled only by a numeric setting
(`vmarkd.outline.width`). Users expect to drag-resize panels. Now a thin
handle sits between the editor and the outline; dragging it resizes the
panel live (requestAnimationFrame-throttled for smooth 60fps).

## Implementation
- `media-src/src/outline-resize.ts`: `setupOutlineResize(outlineEl, position, onResize)`
  — creates a flex-sibling handle (NOT a child of `.vditor-outline`, because Vditor
  uses `lastElementChild` as its render target). Mousedown → mousemove (RAF-batched)
  sets `--me-outline-width`. Mouseup fires `onResize(width)`.
- Handle is 6px with negative margins (`margin: -3px`) to straddle the border.
  `pointer-events: none` on editor panes during drag prevents selection thrash.
- CSS: `body.outline-resizing` sets `cursor: col-resize` + `user-select: none`.
  Handle highlights with `--vscode-sash-hoverBorder` on hover.
- Host: `save-outline-width` message handler persists width in `globalState`
  (key `vmarkd.outlineWidth`, synced via Settings Sync). Init payload injects
  the persisted width so it overrides the CSS default (200px) on next open.
- Setting `vmarkd.outline.width` removed from `package.json` + `collectConfigOptions`.
- Native list markers on outline `<li>` hidden (`list-style: none`, `::marker { content: none }`).

## Tests
- Existing outline tests cover init options (outlinePosition, openByDefault, highlight).
- `globalState` sync key test updated to include `vmarkd.outlineWidth`.
