# Task 106 — Callouts / GitHub Alerts (`> [!NOTE]`)

> **Status:** 📋 TODO. Render `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
> blockquotes as styled callout boxes — **GitHub-native** (Alerts, 2023) **and** Obsidian-core
> (callouts / the popular Admonition plugin). The cheapest high-value gap: it's a small
> transform + CSS, no heavy library.
> **Source:** Obsidian/GitHub parity survey; user request.
> **Value / Risk:** 🟢 popular + double parity, very cheap / low.

## Verified: Lute does NOT parse alerts (so it's CSS **+** a transform, not CSS-only)
Tested the bundled Lute (master, task 66) on `> [!NOTE]\n> text`:
```
Md2HTML        → <blockquote><p>[!NOTE]<br/>text</p></blockquote>
Md2VditorIRDOM → <blockquote data-block="0"><p>[!NOTE]\ntext</p></blockquote>
```
→ plain blockquote, literal `[!NOTE]` text, **no marker/class**. So CSS alone can't target them; we
need a small **DOM transform** that detects the `[!TYPE]` first line and turns the blockquote into a
callout (class + icon + title), then CSS styles it.

## Approach
1. **Transform pass (webview)** — reuse the custom render pass (task 99) over `.vditor-reset
   blockquote`: if the first text node matches `^\[!(note|tip|important|warning|caution)\]` (case-
   insensitive; allow an optional title + foldable `+/-` like Obsidian — decide scope), add
   `class="vmarkd-callout vmarkd-callout--<type>"`, inject the title/icon, and hide the raw
   `[!TYPE]` marker (display-only — **do not mutate the markdown**; round-trips unchanged). Run it
   at the same points as other renderers (init/update/stream/preview); idempotent guard.
2. **CSS** — `media-src/src/main.css`: callout box per type (left border + tint + icon), colors from
   the palette / `--vscode-*` so it follows the content theme (mirror how blockquote theming works,
   tasks 85/86). Use codicon/inline-SVG icons (info/light-bulb/alert/warning/flame).
3. **Editing** — in IR/WYSIWYG the blockquote is live-edited; keep the marker visible/editable there
   (or style lightly) and apply the full callout look in the **preview/rendered** panes. Don't break
   typing the marker. Decide IR behavior during impl (simplest: style in preview, leave IR as a
   blockquote showing `[!NOTE]`).
4. **Scope** — GitHub's **5** types first (parity). Optionally add common Obsidian types
   (note/abstract/info/todo/success/question/warning/failure/danger/bug/example/quote) — phase 2.
5. **Foldable callouts → collapsible (also fixes raw `<details>`)** — support Obsidian's
   `> [!note]-` (collapsed) / `> [!note]+` (expanded) suffix: render the callout as a
   **collapsible** (a real `<details>`/`<summary>`, or a class + toggle). This is the
   **practical answer to `<details>`** — but note it's a **de-facto convention (GitHub Alerts +
   Obsidian foldable), NOT in the CommonMark or GFM spec**; the only spec-clean collapsible is raw
   `<details>` (CommonMark raw-HTML), which is exactly the one that fragments in IR. A raw
   `<details>` with a blank-line-separated
   markdown body fragments in the IR editor (verified — Lute splits it into separate html-block
   nodes per the CommonMark blank-line rule, and Lute is a compiled blob we don't patch). A
   foldable callout is a **blockquote** — Lute parses it cleanly, so our transform makes ONE
   cohesive collapsible that works in **both** IR edit and preview, no fragmentation. Recommend
   shipping foldable in the same task (it's the same blockquote transform + a `-`/`+` check).
   Raw `<details>` stays as-is (works in preview/export; documented IR limitation).

## Tests (per AGENTS)
- **Unit** — the matcher: `[!NOTE]`/case-insensitive/with-title → type+title; a normal blockquote is
  left untouched; markdown source is unchanged (round-trip).
- **e2e** — `> [!WARNING]` renders a `.vmarkd-callout--warning` box (icon + tint) in the preview, not
  a plain blockquote; theme flip keeps it themed; a plain `>` quote stays a blockquote.

## See also
- Skill `vmarkd-renderer-theming` (blockquote theming gotchas — tasks 85/86; the transform reuses
  the task-99 render pass). [GitHub Alerts docs](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts).
- Note: an alternative is a Lute-level patch to emit a callout marker, but Lute is a compiled blob
  (task 67 finding) → the DOM transform is the pragmatic path.
