---
name: vmarkd-lute-features
description: ALWAYS use whenever the task touches Lute in vMarkd — markdown ↔ DOM serialization (getValue / serializeForHost / Md2VditorIRDOM / VditorIRDOM2Md / VditorDOM2Md / SpinVditorIRDOM), the IR/WYSIWYG dual-node DOM (markers vs preview, data-type, data-render), injecting ANY custom/foreign DOM into the editable surface (ghost text, inline widgets, decorations, callout-style nodes), making injected DOM survive or be invisible to a round-trip, Lute parse/render options (Set*), the host-side Node Lute prerender (lute-host.ts), patching/vendoring lute.min.js, or probing the minified Lute. Read it BEFORE injecting DOM into the editor or changing anything that serializes, so you don't ship content that leaks into (or vanishes from) the saved markdown.
---

# vMarkd Lute features

Lute (`github.com/88250/lute`, Go → GopherJS) is the markdown engine **inside** Vditor. It does
**both** directions: markdown → editor DOM (render) and editor DOM → markdown (serialize). vMarkd's
whole save path, round-trip fidelity, and every "inject something into the editor" feature live or die
on how Lute walks the DOM. It is **not** a CSS/theming concern (that's the `vmarkd-renderer-theming`
skill) — this skill is about the **DOM ↔ markdown contract**.

## Where Lute lives (so you patch the right copy)

- **Runtime blob:** `media/vditor/dist/js/lute/lute.min.js` (~3.5 MB GopherJS). This is the ONE copy
  the webview, the e2e harnesses, and the host prerender all load. Vendored + sha-pinned at
  `media-src/vendor/lute/` (`source.json`), copied into `media/` by `build.mjs` (`syncVendored`,
  task 149). Patch/re-pin there, never edit the `media/` copy by hand.
- **It's GopherJS**, so the JS is machine-generated but the **string literals and control flow are
  intact** — you can read the serializer logic out of the minified file (see *Probing Lute* below).
- **Vditor calls it** via `vditor.lute.<Method>(…)`; the TS surface is `media-src/node_modules/vditor/`.

## Serialization — the exact paths (memorize these)

`getValue()` → `getMarkdown(vditor)` (`vditor/src/ts/markdown/getMarkdown.ts`):

| mode | serializer call |
|---|---|
| `ir` | `vditor.lute.VditorIRDOM2Md(vditor.ir.element.innerHTML)` |
| `wysiwyg` | `vditor.lute.VditorDOM2Md(vditor.wysiwyg.element.innerHTML)` |
| `sv` | `element.textContent` (no Lute — raw text) |

Both DOM serializers take an **innerHTML string**, parse it to a DOM-ish tree, build an AST
(`genASTByVditorIRDOM` / `genASTByVditorDOM`), and render the AST to markdown. vMarkd wraps this:
`serializeForHost()` (`media-src/src/main.ts`) is what actually feeds the host `edit` message — it has
an incremental IR fast-path (task 69) that must stay byte-identical to a full `getValue()`. **Any DOM
you add to the editable surface is seen by these serializers unless you opt out (next section).**

On the other side: `Md2VditorIRDOM` / `Md2VditorDOM` (markdown → editor DOM, render) and
`SpinVditorIRDOM` / `SpinVditorDOM` (re-normalize the editor DOM on every input — the per-keystroke
rebuild). `SpinVditorIRDOM` is why injected nodes are **transient** (see Gotchas).

## ⭐ THE KEY FINDING — make injected DOM invisible to Lute with `data-render="1"`

**Problem:** you want to put a node into the editor that the user *sees* but that must **never appear
in the saved markdown** — ghost text / autocomplete (task 153), inline widgets, decorations, transient
hints.

**Wrong instinct:** "a bare `<span contenteditable="false">` is transparent to Lute." **It is NOT.**
`contenteditable` is a render hint Lute ignores — it walks every text node, so the span's text
serializes straight into the document. (Proven: spike 153, "…lazy" → "…lazy dog and runs away" landed
in the markdown.) The "bare wrapper span round-trips clean" rule from callouts / code-source does NOT
generalize to *extra inline content inside a prose block*.

**Right answer:** put **`data-render="1"`** (or `"2"`) on the injected node. Both AST walkers open with
the exact same guard (read straight out of `lute.min.js`):

```js
// genASTByVditorIRDOM AND genASTByVditorDOM, first thing in the walk:
d = DomAttrValue(node, "data-render");
if (d === "1" || d === "2") { return; }   // skip this node AND its whole subtree
```

This is the **same marker Vditor's own `vditor-ir__preview` nodes carry** — i.e. you're using Lute's
native "this is rendered output, not source" mechanism, not a hack. Empirically verified against our
vendored Lute (spike 153 matrix), IR mode, ghost still visibly rendered:

| injected node | renders? | leaks into `getValue()`? |
|---|:--:|:--:|
| `<span contenteditable="false">` (bare) | yes | **LEAKS** |
| `<span data-render="1">` | yes | **CLEAN** |
| `<span data-render="2">` | yes | CLEAN |
| `<span data-render="1" contenteditable="false">` | yes | CLEAN |
| `<span class="vditor-ir__preview" data-render="2" contenteditable="false">` | yes | CLEAN |

The guard is identical in `genASTByVditorDOM`, so **`data-render="1"` works in both IR and WYSIWYG**.

**INLINE vs BLOCK — the leak is inline-specific (spike 153 Q6).** The leak above happens because the
ghost is an **inline** `<span>` *inside an existing block* (`<p>`) — Lute walks it as that paragraph's
inline content and collects its text. A **block-level** element appended to `ir.element` behaves
differently: an *unrecognized* top-level node (a plain `<div>` with no known `data-type`) produces **no
AST node at all** and is dropped — verified CLEAN even for `<div contenteditable=false>text</div>` with
no `data-render`. So: **inline injection → you MUST use `data-render="1"`; unrecognized block overlays
→ Lute already drops them** (adding `data-render="1"` is then optional, explicit insurance). When in
doubt, add `data-render="1"` — it's harmless and unconditional.

**Audit of our existing serialize-touching sites (2026-06-24):** the ONLY strip-before-serialize is
`wrapLuteFlatten`/`flattenSourceHtml` (code-highlight) — and it MUST stay a strip: its spans wrap the
editable *source text that must serialize*, so `data-render` would delete the code, not hide a widget.
`wiki-serialize.ts` is a bidirectional *transform* (chip DOM ↔ `[[…]]`), not a hide-strip — the chip is
meant to serialize. `diff-markers.ts` (empty block `<div>` overlay) and `callouts.ts` (dual-node
preview) inject without strip and don't leak (block-drop / dual-node). **Nothing here should switch
from strip to `data-render`** — they're already each using the right tool.

**Recommended injected-node shape:**

```html
<span class="vmarkd-…" data-render="1" contenteditable="false" data-…>…</span>
```

- `data-render="1"` → structurally invisible to every Lute serializer (no strip step, no audit of
  call sites, can't leak even if a serialize races a live node).
- `contenteditable="false"` → keeps the caret from landing inside it (containment, NOT transparency).
- a `data-*` hook of your own → query selector for show / accept / remove.

**Alternative (when you can't mark the node):** strip it from the HTML string *before* Lute reads it —
`wrapLuteFlatten()` (`media-src/src/wysiwyg-code-highlight.ts`) wraps `VditorIRDOM2Md`/`SpinVditorIRDOM`
and removes our `hljs` token spans first (there the spans must stay class-bare for highlighting, so
`data-render` isn't an option). Prefer `data-render` when you control the node; strip only when you
don't. (See `[[wysiwyg-code-highlight-custom-highlight-api]]`, `[[ghost-span-not-lute-transparent]]`.)

## The IR/WYSIWYG dual-node DOM (what Lute emits and reads back)

A "special" block (code, mermaid, math, callout) is a **dual-node**: an editable **source** half
(markers) + a non-editable **preview** half (the render). Schematically in IR:

```html
<div class="vditor-ir__node" data-type="code-block">
  <pre class="vditor-ir__marker--pre"><code class="language-js">…editable source…</code></pre>
  <pre class="vditor-ir__preview" data-render="2"><code class="hljs">…rendered…</code></pre>
</div>
```

- Lute **serializes from the markers** and **skips the `data-render` preview** — that's the whole
  reason round-trip works. `data-type` (168 string hits in Lute) drives block identity.
- Vditor toggles `vditor-ir__node--expand` as the caret enters/leaves (source vs render visibility).
- Callouts (`media-src/src/callouts.ts`) reuse this by hand: tag a blockquote `vditor-ir__node` +
  inject a `contenteditable="false"` `.vditor-ir__preview` Lute ignores (it carries the data-render
  skip). This is the precedent — and the reason "callouts work" does NOT mean "any span works".
- **CSS/styling of these halves is the `vmarkd-renderer-theming` skill** (the IR edit-surface section).

## Lute in Node (host prerender + fast spikes)

Lute runs headless in Node — no browser needed — because it's just the GopherJS blob:

- **Production:** `src/lute-host.ts` (→ `out/lute-host.js`) loads `lute.min.js` into an isolated
  `vm` context (`vm.createContext` + `runInContext`), then `Lute.New()` → `instance.Md2VditorIRDOM(md)`.
  Used for the warm-open prerender overlay (pay GopherJS `$init` ≈150 ms once in the long-lived host,
  not per webview realm) and the minimal-diff write-back `VditorIRDOM2Md(Md2VditorIRDOM(md))` (task 61).
- **Spikes:** shim `window`/`self` = `globalThis`, `require` the blob, call methods directly — fast
  serialization-fidelity checks with no e2e harness (`[[lute-runs-in-node]]`).
- **Realistic DOM spikes** (when you need real selection/caret/contenteditable behavior, e.g. testing
  what serializes): bundle `vditor/src/index` with the e2e `vditorSourceConfig` and drive headless
  chromium. Pattern: `tmp/spike-153/` (esbuild with `nodePaths:[…/media-src/node_modules]` +
  `createRequire` for esbuild/playwright; serve real `/vditor` assets + `/main.css`). Scratch under
  `tmp/` (`[[scratch-under-repo-tmp]]`).

## Probing the minified Lute (how the finding was found)

The string literals survive minification, so grep the blob, then read the surrounding logic:

```js
// node -e
const s = require('fs').readFileSync('media/vditor/dist/js/lute/lute.min.js','utf8')
let i = s.indexOf('prototype.genASTByVditorIRDOM=function')   // the IR DOM→AST walker
let j = s.indexOf('data-render', i)
console.log(s.slice(j-120, j+120))                            // → the skip guard, verbatim
```

Useful anchors: `VditorIRDOM2Md` / `VditorDOM2Md` (serialize entry), `genASTByVditorIRDOM` /
`genASTByVditorDOM` (the walkers), `DomAttrValue` (attr read), `data-type` / `data-render` /
`vditor-ir__preview` (node identity + skip), `Md2VditorIRDOM` (render entry). Always **verify
empirically** against our vendored version too — static reading of GopherJS can mislead.

## Lute parse/render options (`Set*`)

Vditor configures Lute per mode: `SetVditorIR/WYSIWYG/SV(bool)` (`toolbar/EditMode.ts`),
`SetJSRenderers({renderers})` (custom node rendering, `fixBrowserBehavior.ts`). Behavior knobs are
`Set…` flags on the instance — e.g. `SetSoftBreak2HardBreak` (defaults true → soft wraps become
`<br>`; task 83 flips it in the **preview lute only**). We apply such changes via an **esbuild source
patch** (`VDITOR_TS_PATCHES` in `media-src/esbuild-shared.mjs`) when the call is hardcoded in Vditor,
not by forking. Match an existing patch's anchor-assert style so it fails loud on a Vditor bump.

## Gotchas (expensive to rediscover)

- **Injected nodes are TRANSIENT.** Any keystroke triggers `SpinVditorIRDOM` (input rebuild) which
  reconstructs the DOM from Lute's model — your injected node is **dropped** (not absorbed → no
  corruption, even the leaky bare-span case). So model injected UI as "show after a debounce, gone on
  next input, re-insert from latest state" — don't fight to keep a persistent node alive across rebuilds.
- **`contenteditable="false"` ≠ Lute-invisible.** Containment only. Use `data-render="1"` for
  invisibility. (The single most common wrong assumption — see the key finding.)
- **Round-trip is the acceptance test.** For ANY DOM-injection or serialization change, assert
  `getValue()` is **byte-identical** with the injected node present vs absent (and that
  `serializeForHost()`'s incremental path matches a full `getValue()`). A diff = a leak or a fidelity bug.
- **`sv` mode skips Lute entirely** (raw `textContent`) — features that hook the serializers don't
  apply there; handle or exclude `sv` explicitly.
- **One blob, three consumers.** The webview, e2e harnesses, and host prerender share the SAME
  `lute.min.js`. A patch/bump affects all three; the host `vm` realm keeps `global.Lute` undefined
  elsewhere (don't rely on a global).
- **Don't confuse this with theming.** Colors/CSS/IR edit-surface *styling* = `vmarkd-renderer-theming`.
  DOM *structure* / what-serializes = here.

## File map

- Serialize entry: `vditor/src/ts/markdown/getMarkdown.ts`; vMarkd wrapper + incremental path:
  `media-src/src/main.ts` (`serializeForHost`, ~`:608`).
- Input rebuild: `vditor/src/ts/ir/input.ts` (`SpinVditorIRDOM`), `…/ir/process.ts`.
- Strip-before-serialize: `media-src/src/wysiwyg-code-highlight.ts` (`wrapLuteFlatten`,
  `flattenSourceHtml`).
- Dual-node by hand: `media-src/src/callouts.ts`. Code edit surface tagging: `media-src/src/code-source.ts`.
- Host Node Lute: `src/lute-host.ts` → `out/lute-host.js`. Used by `src/extension.ts`.
- Runtime blob + pin: `media/vditor/dist/js/lute/lute.min.js`, `media-src/vendor/lute/source.json`,
  `build.mjs` (`syncVendored`). Vditor option patches: `media-src/esbuild-shared.mjs`
  (`VDITOR_TS_PATCHES`); patch tests `test/backend/vditor-source-patches.test.ts`.
- Spike harness reference: `tmp/spike-153/` (throwaway). Related task: `tasks/153-copilot-inline-autocomplete.md`.

## Related

- Memories: `[[ghost-span-not-lute-transparent]]` (the finding), `[[lute-runs-in-node]]`,
  `[[wysiwyg-code-highlight-custom-highlight-api]]`, `[[scratch-under-repo-tmp]]`,
  `[[vditor-indexcss-served-stale-from-webview-cache]]` (the single-copy / patch-in-build discipline).
- Skill: `vmarkd-renderer-theming` (CSS/theming side of the same dual-node).
- Tasks: 153 (ghost text — the spike that produced the finding), 69 (incremental IR serialization),
  61 (minimal-diff write-back), 83 (soft-break option), 106 (callouts dual-node).
