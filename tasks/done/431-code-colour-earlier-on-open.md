# Task 431 — Make code-block colouring appear sooner on open (initial hljs stylesheet + pre-highlighted teaser)

**Status:** ✅ **DONE (2026-08-11) — option 2 shipped + pinned; option 1 (teaser tokenizer) deliberately not built.** ·
**Impact:** 🟢 low, and now honestly bounded — see "What shipped" ·
**Origin:** two independent read-only investigations, 2026-07-29 — Codex (this task's subject) and Fable (the
theme-application slice, see [427](427-frontmatter-hljs-style-flash-on-open.md)). Both found gap #1 below
independently, which is why it is stated with confidence.

## What shipped, and what the measurement actually showed

**Shipped — option 2: the hljs stylesheet now goes out in the initial HTML** (`src/html-builder.ts`,
ungated). The DRY requirement it hinged on is met: the rule lives once, in `src/theme-registry.ts`
(`resolveCodeStyle` + `codeStyleHref`), and BOTH the host and the webview's `codeHljsStyle` call it —
because `setCodeTheme` compares the raw `href` and removes + re-adds the link on any mismatch, which
would recreate the flash instead of closing it.
- Real-VS-Code pin (`hljs-initial-stylesheet.spec.ts`): the link is present, LOADED, unique, resolves
  material-dark → `atom-one-dark` through the shared resolver, and — the load-bearing part — is still
  in its **host-emitted position** in `<head>` (before the user-CSS blocks), proving Vditor accepted it
  rather than tearing it down and re-appending. **RED-checked** by emitting a deliberately mismatched
  href: the assertion flips to false, exactly as designed. (A first attempt stamped the DOM node
  instead; that was worthless — by the time a spec can reach the frame, any teardown has already
  happened and the stamp lands on the replacement. Recorded so nobody rebuilds it that way.)
- 4 unit tests pin the emitted URL byte-for-byte (no cache-bust suffix, follows the resolved style,
  emitted even with no code fence, ordered before the user CSS).
- **Ungated deliberately**: `hasCodeFence` does not match YAML frontmatter, and a frontmatter-only file
  is precisely task 427's case. One small local stylesheet is the cheaper mistake.

**NOT shipped — option 1 (pre-highlight the teaser).** The measurement removed its justification for
now: with option 2 in place, `hljs-colour-timing.spec.ts` shows the stylesheet already loaded at the
first observable sample, and the remaining wait is for `.hljs` tagging + token spans, which the fixture
reaches at ~1.0 s. Codex's own numbers put the win at 0 on two of three recorded fixtures. It stays
written up below for whoever measures a document where it actually pays.

**The measurement's real payoff went to [427](427-frontmatter-hljs-style-flash-on-open.md)**: the same
probe reproduced the reported green frontmatter and found it was a CSS leak
(`.markdown-body code:not(.hljs)`), not stylesheet timing at all. Fixed there.

## The two gaps (independent of each other)

1. **The selected hljs stylesheet is absent from the initial HTML.** Vditor creates `#vditorHljsStyle` at
   runtime and does not await its load — `setCodeTheme` (`vditor/src/ts/ui/setCodeTheme.ts:4`, via
   `addStyle.ts:1`), reached only from `applyVditorTheme` → `setVditorTheme`
   (`media-src/src/vditor-theme.ts:33-46`) in `after()` (`media-src/src/vditor-init.ts:323`). Nothing is
   emitted for it in `src/html-builder.ts:267`. **Found independently by both agents.**
   Consequence, per Fable's trace: `finishInit()` (`vditor-init.ts:407`) registers `observeCodeSource`
   (`finish-init.ts:122`), which **immediately** tags `.hljs` onto the code element (`code-source.ts:41`) —
   so the class can land before the stylesheet that colours it has loaded.
2. **The host prerender teaser is raw Lute DOM with no syntax processing.** `renderForMode`
   (`src/lute-host.ts:196`) returns `Md2VditorIRDOM`/`Md2VditorDOM` output unchanged and `html-builder.ts:134`
   embeds it as-is; `media-src/src/main.css:1275` already documents that teaser code has neither `.hljs` nor
   token spans. So the instant-paint teaser shows *uncoloured* code by construction.

**Already correct — do not "fix":** the two highlight.js scripts are emitted as blocking scripts *before*
`main.js` (`src/html-builder.ts:218`, `:235`, `:299`; gate at `src/markdown-editor-provider.ts:221`), so
`window.hljs` exists before Vditor or any diagram burst starts.

## Options, ranked (Codex's ranking; Fable's overlapping A/B/C/D noted)

### 1. Pre-highlight the teaser before `main.js`, with its stylesheet already present — the only option that moves TOKEN COLOUR earlier
Seams: emit the resolved code-theme stylesheet around `src/html-builder.ts:245`, placed before the named
content themes/user CSS at `:282`; resolve it host-side at `src/markdown-editor-provider.ts:189` using the
existing rules (`media-src/src/vditor-options.ts:20`, `src/theme-registry.ts:145`); run a **teaser-only**
decorator over `#vmarkd-prerender` after `${hljsPreload}` but before `${main.js}` (`html-builder.ts:299`).
Mechanism: call `window.hljs.highlight(...)` and insert token spans + `.hljs` — the same transformation
Vditor eventually does (`vditor/src/ts/markdown/highlightRender.ts:22`). Bounded by the existing 10 000-char
teaser cap (`src/lute-host.ts:30`).
Risks: must skip diagram languages consistently with `CUSTOM_LANGS` (`code-source.ts:19`) or diagram source
gets styled as code; editable source/frontmatter nodes should get `.hljs` **only** (settled IR source is
deliberately class-styled but monochrome — `code-source.ts:3,28`) unless parity testing says otherwise;
adds bounded tokenizer CPU *before* first paint; **no benefit at all when there is no teaser** — saved `sv`
mode, or a host Lute that is not warm (`src/lute-host.ts:202` — see [432](432-cold-first-open-teaser-race.md),
which may make that case the FIRST open of every session).
Expected win, from existing spike numbers: **0 to ~1.3 s, document-dependent.** The all-renderers fixture had
content at 48 ms but token colour at 1 349 ms; the native-burst fixture had both together at 257 ms and the
mermaid-heavy one had colour at 48 ms — i.e. no recorded win in those two
([169](169-yield-open-native-diagram-burst.md):12, [170](170-host-preload-diagram-engine-scripts.md):15).

### 2. Ship `#vditorHljsStyle` in the initial HTML only (prerequisite, not a solution)
Same host seams as option 1 minus the tokenizer (`markdown-editor-provider.ts:189`, `html-builder.ts:278`,
`theme-registry.ts:150`). Must use the exact URL Vditor expects —
`${cdn}/dist/js/highlight.js/styles/${style}.min.css` (`setCodeTheme.ts:8`) — because Vditor compares raw
`href` strings and **removes/re-adds the link on a mismatch** (`setCodeTheme.ts:12`), which would recreate the
very flash this is meant to close. Host and webview must share ONE authoritative resolver; duplicating
`codeHljsStyle()` risks an initial/final theme mismatch, and this is where the documented stale-saved-options
trap lives (see the comment block in `media-src/src/vditor-options.ts` before touching merge order).
Also: `hasCodeFence()` (`src/html-builder.ts:44`) matches fences and raw `<code>/<pre>` but **not** YAML
frontmatter, so including frontmatter needs a broader "needs hljs styling" predicate. A head stylesheet can
hold first paint — gate it unless measurement supports emitting it universally.
Expected win: **zero to one local stylesheet-load window; unmeasured.** Cannot deliver earlier token spans.
*(This is Fable's option A/B; Fable rated it a genuine latency reduction, Codex rated it a low-risk
prerequisite. Codex's framing is better supported — it is backed by the spike numbers above.)*

### 3. Highlight inside `renderForMode()` on the extension host — not recommended
Seams `src/lute-host.ts:73` (a host-side hljs runtime) and `:218`. Highest theoretical ceiling (token spans
already in the initial HTML), but Node lacks the browser DOM the highlighter uses, it adds synchronous host
work directly to first paint (already capped — up to ~55 ms at 10 KB, `src/lute-host.ts:39`), duplicates a
runtime the webview already loads, and mode/source/frontmatter parity is harder. **Net win could be zero or
negative.** Option 1 reuses the existing webview runtime and is safer.

### Rejected: prioritise hljs ahead of diagrams — expected win ≈ 0
The hljs scripts already run before `main.js`; the fallback eager loader runs before the custom-diagram
observer (`finish-init.ts:133,168`); custom diagrams already yield a frame between engines
(`custom-diagrams.ts:159`); and task 169's real-VS-Code spike measured that code colouring is **not** starved —
the residual freezes are individual 466–726 ms renderer tasks that reordering cannot split
([169](169-yield-open-native-diagram-burst.md):19). Would require patching Vditor's native render loop and its
synchronous caret/scroll contracts for nothing.

### Rejected: hold the prerender overlay longer — masking, and self-defeating
Fable's option D. The host prerender (`lute-host.ts`) does no hljs highlighting either, so the teaser carries
the identical uncoloured→coloured transient underneath; holding the overlay only changes which DOM node shows
it, working against the point of instant-paint.

## Steps

- [x] **Probe first.** Measure, in a real-VS-Code spec, when `.hljs`/token spans actually appear vs. when the
      stylesheet finishes loading, on (a) a plain code-fence doc, (b) the all-renderers fixture, (c) a
      frontmatter-only doc. Do not implement before this — the win is document-dependent and two of three
      recorded fixtures showed none.
- [x] Option 2 (initial stylesheet link), sharing one resolver host↔webview; assert the emitted `href` is
      byte-identical to what `setCodeTheme` would build, so Vditor does not tear it down.
- [ ] Option 1 (teaser-only tokenizer) if the probe shows a real gap; unit-test the decorator (language
      skipping, `CUSTOM_LANGS`, frontmatter) and pin the timing in a real-VS-Code spec.
- [x] Measure standard code-block colour separately from the [427](427-frontmatter-hljs-style-flash-on-open.md)
      frontmatter flash — they are different symptoms and 427 is still unconfirmed.

## Explicitly NOT established

Neither investigation could explain the **green** frontmatter colour the user reported: frontmatter renders as
`.vditor-ir__marker--pre`, which Vditor's per-token highlighter explicitly skips, so its colour comes from the
base `.hljs{color:…}` rule — `#abb2bf` (grey) in atom-one-dark, not green. See 427; that means **none of the
options above is proven to fix the reported symptom**, only the mechanism they do explain.
