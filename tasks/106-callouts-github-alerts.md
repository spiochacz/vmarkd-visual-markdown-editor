# Task 106 — Callouts / GitHub Alerts (`> [!NOTE]`)

> **Status:** 🟢 done (2026-06-10, branch `feat/callouts`). `callouts.ts` (`matchCallout` pure +
> `applyCallouts` **attribute-only** + `observeCallouts` MutationObserver) restyles `[!TYPE]`
> blockquotes → callout box (CSS in main.css, 5 GitHub + Obsidian types, per-type accents).
> Obsidian's foldable `-`/`+` suffix is ACCEPTED but IGNORED (fold-state support was built,
> then DROPPED as overkill at this stage — the suffix renders as a normal callout). **Attribute-only**: sets `data-callout` / `data-callout-title` /
> classes and NOTHING else — no DOM/text mutation, so it's safe in the **editable IR** (caret +
> round-trip safe) and works in both edit and preview. CSS draws the title via
> `::before { content: attr(data-callout-title) }`; the raw `[!NOTE]` marker stays in the source.
> Wired into `runFinishInit` (`observeCallouts(activeModeElement(vditor))`, one disposer torn down
> + replaced on re-init). Unit (6, matchCallout) + e2e (7, `callouts.spec.ts`: type/title-attr/
> ::before-title/explicit-title/fold-suffix-ignored/plain-untouched/editable-styled-text-intact/styled). All
> green; lint + typecheck + build clean; installed locally. **Deferred (phase 2):** foldable open/closed states
> (built, then removed as overkill — re-add with click-to-toggle JS if requested), codicon icons in the title (CSS hook
> `--vmarkd-callout-icon` is in place).
>
> **Rework note (the v1→done fix):** v1 transformed the DOM (stripped marker, injected a
> `.vmarkd-callout__title` div) and skipped `contenteditable`. In the default IR editing view that
> meant callouts were effectively invisible (the editable blockquote was skipped) AND it was
> caret/round-trip-unsafe. Rewrote to run in the editable IR + an observer that re-applies as
> Vditor rebuilds the IR DOM on each edit — now visible while editing, zero source mutation.
>
> **Dual-node feel (edits like code/mermaid blocks):** the raw `[!NOTE]` marker run is wrapped in a
> `<span class="vmarkd-callout__marker">` and CSS-hidden behind the rendered `::before` title; it's
> revealed for editing while the caret is inside the callout (source-on-focus, preview-on-blur).
> Two findings made this work:
> - **`:focus-within` does NOT work here.** In the IR the `contenteditable` host is an *ancestor*
>   of the blockquote, so the caret is never a *descendant* of the callout. Instead callouts.ts
>   toggles `data-callout-editing` from the live selection (`observeCallouts` adds a debounced
>   `selectionchange` listener) and CSS keys off that attribute.
> - **The wrapper span is transparent to Lute** — verified by a Node round-trip test
>   (`Lute.VditorIRDOM2Md`): bare `<p>[!NOTE]<br>body</p>` and
>   `<p><span class=…>[!NOTE]</span><br>body</p>` both serialise to `> [!NOTE]\n> body`. So the
>   marker text staying in the DOM (just collapsed) means the markdown round-trips unchanged.
>
> The wrap mutation is skipped while the caret is inside (never restructure the node being typed
> in); it (re)wraps on blur via the observer. Known minor wart: if the whole webview loses focus
> without a selection change, the last-edited callout keeps its marker shown until the next caret
> move. e2e: 8 tests (incl. focus reveals marker / blur re-tucks it / round-trip text intact).
> Original plan:
> Render `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
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
