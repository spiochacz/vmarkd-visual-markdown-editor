# 427 — Frontmatter (and likely other code) briefly flashes the wrong colour on open (material theme)

**Status: ✅ DONE (2026-07-29) — REPRODUCED, root cause measured, fixed, regression-pinned.**
Reported 2026-07-28.

## Result

**The report was exactly right, and both source-only analyses were wrong about it being impossible.**
`hljs-colour-timing.spec.ts` (real VS Code, material-dark, a frontmatter + code fixture) sampled the
computed colour of the frontmatter every ~10 ms through an open:

| t | `.hljs` tagged | frontmatter colour |
|---|---|---|
| ~747 ms | ✗ | `rgb(152,195,121)` = **#98c379 — the green** |
| ~1029 ms | ✓ | `rgb(171,178,191)` = #abb2bf grey (final) |

**Root cause — nothing to do with the stylesheet timing everyone theorised about.** It is a CSS leak:
the content theme styles INLINE code with `.markdown-body code:not(.hljs) { color: #98c379 }`
(`media/markdown-themes/material-dark.css:34`), and until `observeCodeSource` tags `.hljs`, that rule
also paints BLOCK code. `main.css` already neutralised exactly this leak — but only for
`pre:is(.vditor-ir__preview, .vditor-wysiwyg__preview) > code:not(.hljs)`, and **frontmatter lives in
`pre.vditor-ir__marker--pre`**, which that selector never covered.

**Fix:** add `.vditor-ir__marker--pre` to that `:is()` list (`media-src/src/main.css`). `:not(.hljs)`
still self-retires the rule the moment tagging lands, so the settled state is untouched. Re-measured
after the fix: one colour for the whole open, `rgb(171,178,191)` from the first sample.

**Pinned:** `hljs-colour-timing.spec.ts` now asserts the invariant — the frontmatter holds exactly ONE
colour across the entire open. The green timeline above is the RED evidence, measured on the real
product before the change.

**Settled colour — user decision (2026-07-29): leave it GREY, don't make the green permanent.** The
green is real material styling (`.markdown-body code:not(.hljs)`), so "frontmatter is green on
material" is a fair description of the *transient* — but the theme's own settled state has always been
atom-one-dark's `#abb2bf`, and the fix did not change it (measured grey at ~1029 ms both before and
after). Asked explicitly whether frontmatter should instead be green permanently; answer was no. Do not
"restore" the green.

**Method note worth keeping:** two independent agents read the source and both concluded no rule could
make frontmatter green (correctly observing that Vditor's token highlighter skips
`.vditor-ir__marker--pre`). They were both looking at the highlighter and missed the *content theme's*
inline-code rule. The symptom only fell out of measuring it. Reasoning about CSS colour ≠ measuring it.

> **⚠️ SUPERSEDED by the measurement above — kept as the record of how the analysis went wrong.**
> **Update 2026-07-29 — two independent read-only investigations (Codex, Fable) confirmed the mechanism below
> and BOTH failed to explain the reported green.** (They were right that the token highlighter can't
> produce it, and wrong to conclude nothing could: the green came from the content theme's inline-code
> rule leaking onto block code, which neither of them looked at.) They converged, independently, on the structural gap in
> §1 (no server-rendered hljs link) — that part is now double-sourced rather than hypothesised. What neither
> could establish: **why frontmatter would ever look green.** Frontmatter renders as
> `<div data-type="yaml-front-matter"><pre class="vditor-ir__marker--pre"><code class="language-yaml">`, and
> Vditor's per-token highlighter **explicitly skips `.vditor-ir__marker--pre`**
> (`vditor/src/ts/markdown/highlightRender.ts:30-33`) — so its colour can only come from the base
> `.hljs{color:…}` rule, which in material's paired `atom-one-dark` is `#abb2bf` (grey), not green. The
> "green string/attribute token" hypothesis in §3 below therefore does **not** survive: those token classes are
> never applied to frontmatter in the first place.
> Newly traced ordering detail (Fable): `finishInit()` (`vditor-init.ts:407`) registers `observeCodeSource`
> (`finish-init.ts:122`), which tags `.hljs` onto the element **immediately** (`code-source.ts:41`) — i.e. the
> class can land before the stylesheet inserted moments earlier at `vditor-init.ts:323` has loaded. That is a
> real, precisely located window; it just is not shown to produce a *green* intermediate state.
> **Consequence for this task: the live real-VS-Code probe is now the ONLY way forward.** Do not implement any
> fix and call this closed — a fix for the traced window may leave the reported symptom untouched.
> The fix options themselves are written up in [431](431-code-colour-earlier-on-open.md) (initial hljs
> stylesheet + pre-highlighted teaser); this task stays owner of the *symptom* until it is reproduced.

## Report

> "jak otwieram plik to temat aplikuje się czasami z małym lagiem przez co np frontmatter na
> temacie material zmienia kolor z zielonego na docelowy kolor"
> — opening a file sometimes applies the theme with a small lag, so e.g. frontmatter on the
> material theme changes colour from green to the target colour.

## What is CONFIRMED from source (read, not assumed)

This is a **different mechanism** from the content-theme flash `theme-flash.spec.ts` already
guards (that fix targeted the `<link id="vditorContentTheme">` swap caused by a stale saved
`preview.theme.current`). The code-highlight (hljs) style is a **separate link, on a separate
code path**, and it has a structural gap the content-theme link does not:

1. **The content-theme link ships in the initial server-rendered HTML** (`html-builder.ts`:
   `prerender.themeLink + contentThemeLinks`, emitted directly in the `<head>`). The **hljs style
   link does not** — `html-builder.ts` emits no `vditorHljsStyle` link anywhere; it is created
   entirely at runtime by Vditor's own `setCodeTheme` (`media-src/node_modules/vditor/src/ts/ui/
   setCodeTheme.ts:8-15`), which calls `addStyle(href, "vditorHljsStyle")` — a `<link>` insertion,
   i.e. an async network/disk fetch. **There is therefore always a window on every open, before
   that fetch resolves, where code/frontmatter text carries no hljs styling at all** — something
   the content-theme fix's technique (compare resolved URLs so an equal-file call never tears the
   link down) does not apply to, because there is no link to compare against yet on first paint.
2. **`setCodeTheme` silently substitutes a DIFFERENT style on an invalid value**
   (`setCodeTheme.ts:5-7`): `if (!Constants.CODE_THEME.includes(codeTheme)) codeTheme = "github"`.
   If our config value reaches Vditor's constructor before it's fully resolved (the same class of
   race the content-theme fix was written for — see `saveVditorOptions`/stale-blob comments in
   `media-src/src/vditor-options.ts:39-65`, which already had to make config-derived `hljs.style`
   the LAST merge specifically because a stale saved value would otherwise pin the wrong one), a
   silent fallback to `github`'s palette would show BEFORE the real value takes effect — a second,
   independent path to a two-stage colour change on open.
3. **material's paired hljs style, `atom-one-dark`, does have a green token colour**:
   `.hljs-attribute, .hljs-string { color: #98c379 }` — a plausible source of "green" if a
   frontmatter value is tokenized as one of those classes. But note `github.min.css`'s own
   `.hljs-string` is `#032f62` (navy, not green) — so a fallback-to-github explanation does NOT by
   itself produce the green the user saw either. **I could not determine from source alone which
   of these mechanisms (if either) is what the user is actually seeing, nor whether the reported
   "green" is the TRANSIENT colour or the FINAL/target one** — the report reads as green-first, but
   I have not verified that direction live. Do not start fixing a specific link/style swap without
   confirming which one it is.

## The live measurement (DONE 2026-07-29 — see Result at the top)

Per this project's standing rule against asserting unverified symptoms, none of the hypotheses above
was treated as the cause. What the measurement then showed is that hypotheses 2 and 3 were both wrong
and the real cause was a CSS leak nobody had considered:

- [x] Open a document with YAML frontmatter under `theme.content: material-dark` in the real
      VS Code webview (not the chromium harness — this is a first-paint/hydration-timing bug, and
      the harness's `prerender.html` copy may not reproduce the exact same race as the production
      `html-builder.ts` HTML). Record the frontmatter element's `getComputedStyle(...).color` at
      high frequency (e.g. `requestAnimationFrame` sampling, or the `theme-flash.spec.ts` technique
      of an `addInitScript` MutationObserver on link add/remove) across the first ~1s after open.
- [ ] Confirm: (a) is the flash on the `vditorHljsStyle` link specifically (add/remove timeline),
      the content-theme link, or something else entirely (e.g. a raw pre-hljs fallback colour with
      NO link involved yet)? (b) which colour is green and which is "docelowy" — first or last?
      (c) does frontmatter's value literally carry an `hljs-string`/`hljs-attribute` class, or is it
      rendered through some other path (check Lute's actual frontmatter markup, not just an
      assumption that it's hljs-tokenized YAML)?
- [ ] Check whether OTHER code blocks (not just frontmatter) show the same flash — the report
      names frontmatter specifically, but if the mechanism is the hljs-style link, it should affect
      every fenced code block too, and confirming that (or ruling it out) narrows the cause a lot.
- [ ] Check reproducibility against **other** content themes, not just material — if the same flash
      happens on github/vscode-2026 themes (different paired hljs styles, different final colours),
      that confirms the mechanism is generic (the async link, or the silent-fallback substitution)
      rather than something material-specific.

## Scope (once the mechanism is confirmed — do not implement blind)

- [ ] If it's the async `vditorHljsStyle` link: the fix template already exists —
      `theme-flash.spec.ts`'s documented two-part pattern (mode-authoritative config merge order +
      comparing resolved URLs before tearing a link down) — adapt it to the `vditorHljsStyle` link,
      or ship the style server-side in the initial HTML the way the content-theme link already is,
      which would close the window structurally rather than racing to beat it.
- [ ] If it's `setCodeTheme`'s silent `github` substitution: trace why an invalid/unresolved
      `codeTheme` value would ever reach it, and fix the race rather than only the fallback name.
- [ ] Bump the extension version if the fix touches server-rendered HTML (cache-key contract, same
      as every other visual fix landed this session).

## Verification

- [ ] A regression spec in the `theme-flash.spec.ts` family: replay the same init-script link-timeline
      technique for the hljs style link, assert no remove+re-add (or, if removal is unavoidable, that
      the correct href is present from the very first `<link>` this test observes — i.e. no window
      where NO hljs link/colour is applied).
- [ ] Real-VS-Code e2e sampling computed colour across the open sequence, on at least material +
      one other content theme, confirming a single stable colour from first paint.

## See also

- `media-src/e2e/theme-flash.spec.ts` — the closest existing infrastructure and the precedent fix
  pattern for this exact class of bug (content-theme link), reusable technique for whichever link
  turns out to be the actual cause here.
- `media-src/node_modules/vditor/src/ts/ui/setCodeTheme.ts` — the silent-fallback + async link
  mechanism this task is built around.
- `media-src/src/vditor-options.ts:39-65` — the existing "config-derived hljs options must merge
  LAST" fix, which addresses the FINAL state but not necessarily a transient flash en route to it.
- `src/theme-registry.ts` — `code: 'atom-one-dark'` for material-dark (:61), the paired style whose
  green token colour is the leading (unconfirmed) suspect.
