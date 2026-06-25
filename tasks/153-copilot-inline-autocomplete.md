# Task 153 — Copilot-style AI inline autocomplete (ghost text) in the visual editor

> **Status:** 📋 TODO — **spike DONE 2026-06-24, GO** (the ghost-text-in-contenteditable risk is
> retired; see *Spike findings* below). Give vMarkd a GitHub-Copilot-like experience: as you type
> prose in the IR/WYSIWYG editor, show a greyed **inline suggestion** (ghost text) for the next
> words/sentence; **Tab** accepts, **Esc**/keep-typing dismisses.
> **Source:** user request ("dodaj taska by w vmarkd copilot dodawał autocomplete").
> **Value / Risk:** 🟡 high-value authoring feature / medium-high risk — completions need a model
> source, and ghost text inside Vditor's contenteditable + Lute serialization is delicate.

## Spike findings (2026-06-24) — real Vditor + real Lute in headless chromium

Throwaway harness `tmp/spike-153/` (esbuild-bundles `vditor/src/index` with the e2e `vditorSourceConfig`,
serves real `/vditor` assets, drives chromium). Four questions, all answered decisively:

| Q | Result |
|---|---|
| **Q1 — does a `<span contenteditable=false>` ghost leak into `vditor.getValue()` (Lute)?** | **YES, it LEAKS.** The ghost text ("…lazy" → "…lazy dog and runs away") serialized straight into the markdown. A *bare* ghost span is NOT Lute-transparent — `contenteditable=false` is a render hint Lute ignores; it walks all text nodes. **But Q5 found the real fix.** |
| **Q5 — which attribute makes Lute NATIVELY skip the ghost (no strip)?** | **`data-render="1"` (or `"2"`).** `getValue()` in IR mode is `VditorIRDOM2Md(ir.element.innerHTML)` (`getMarkdown.ts`); its walker `genASTByVditorIRDOM` (and the WYSIWYG `genASTByVditorDOM`) **both open with** `d = DomAttrValue(node,"data-render"); if (d==="1"\|\|d==="2") return;` → the whole subtree is skipped. This is the exact marker Vditor's own `vditor-ir__preview` nodes carry. Empirically: bare span → LEAKS; `data-render="1"` / `"2"` / `…+contenteditable=false` / `vditor-ir__preview+data-render="2"` → all **CLEAN and still rendered**. |
| **Q2 — does strip-before-serialize also work?** | **YES** (byte-identical after dismiss) — but it's now the *fallback*, not the primary mechanism (Q5 is cleaner). |
| **Q3 — accept turns the ghost into real markdown?** | **YES.** Replace the ghost node with a real text node → "lazy dog" lands in the markdown, **zero ghost residue**. |
| **Q4 — what does a real keystroke do to a showing ghost?** | **Vditor's input rebuild DROPS the ghost (not absorbed → no corruption).** Typing `!` gave "…lazy!", ghost gone. So typing is safe, **but** the ghost is destroyed every keystroke → the impl must re-request/re-insert after the typing-pause debounce (an observer/recreate, not a persistent node). |

**Design consequences (locked in by the spike):**
1. **The ghost node is `<span class="vmarkd-ghost" data-render="1" contenteditable="false" data-ghost>…</span>`.**
   `data-render="1"` makes it **structurally invisible to Lute in both modes** (Q5) — so `getValue()` /
   `serializeForHost()` / the incremental path / save-flush are all clean **without any strip**, and a
   serialize racing a live ghost can't leak. `contenteditable="false"` keeps the caret out of it;
   `data-ghost` is our show/accept/dismiss query hook. **Strip-before-serialize (Q2) is no longer
   required** — keep it only as optional defense-in-depth.
2. Ghost is **inherently transient** (Q4) — model it as "show after debounce, auto-gone on next input",
   re-inserting from the latest suggestion; don't fight to keep a persistent node alive across rebuilds.
3. Accept (Q3) is a clean DOM swap — no special Lute handling needed for the accepted text.
4. `vscode.lm` confirmed present: `@types/vscode` 1.120.0, our engine `^1.110.0` (LM API stable since 1.90).

> **Carried risks the spike did NOT cover** (still verify in the real webview): WYSIWYG mode (spike was
> IR only), caret restoration after accept, interaction with the existing keydown captures
> (undo/save-flush/edit-in-vscode), and ghost placement mid-word vs end-of-line in nested blocks.

## Why this is non-trivial (the core constraint)

vMarkd is a **custom editor rendered in a webview** (Vditor, contenteditable) — **not** a VS Code
`TextEditor` over a `TextDocument`. So:

1. **GitHub Copilot does NOT fire here.** Copilot (and any `InlineCompletionItemProvider`) only runs
   in real text editors / notebook cells. Our document is open in a custom editor, so the user gets
   **zero** inline completion in vMarkd today even with Copilot installed. We must build our own
   ghost-text UI **and** source the suggestions ourselves.
2. **The webview can't call a model directly.** CSP (`src/html-builder.ts`: `default-src 'none'`,
   `connect-src` has no `https:`) blocks any network from the webview — by design, and we keep it.
   The model call must happen **host-side** (Node), routed over the existing message bridge.

## Suggestion source — VS Code Language Model API (host-side)

Use **`vscode.lm`** (`vscode.lm.selectChatModels({ vendor: 'copilot' })`) from the extension host:
- If the user has GitHub Copilot (or any LM provider) installed, this exposes their models with **no
  API key of ours** and **no extra dependency** — VS Code brokers auth + consent (`model.sendRequest`
  triggers the one-time per-extension consent prompt).
- Runs in the host process, so **no webview CSP hole** — the webview only ever receives plain text.
- **Graceful absence:** if `selectChatModels` returns `[]` (no LM provider), the feature is simply
  inert — never error, never block typing. Surface a one-time hint via the Output channel
  (`debug()`/`logger`, per the debug-to-Output-channel rule), not a modal.
- **Offline posture / opt-in:** this is the one feature that reaches a (local-or-cloud) model, so it
  is **off by default** and clearly documented as "sends nearby text to your configured LM provider".
  Everything else in vMarkd stays fully offline; this doesn't change the CSP or the vendored model.

> Open decision (spike): `vscode.lm` only. A pluggable `vmarkd.autocomplete.provider`
> (`copilot` | `none` | future local-Ollama via host `fetch`) can come later — start with `vscode.lm`.

## Message protocol (extend the existing bridge)

Host bridge: `messageHandlers[message.command]` in `src/extension.ts:1300`; webview→host via
`vscode.postMessage`, host→webview via `panel.webview.postMessage`, webview listener at
`media-src/src/main.ts:1312`.

- **webview → host** `{ command: 'autocomplete-request', id, prefix, suffix, lang }` — debounced on
  idle typing. `prefix` = markdown text before the caret (cap to ~2 KB / N lines), `suffix` = a little
  after, `lang` = current block language if inside a code fence (skip or specialize).
- **host → webview** `{ command: 'autocomplete-response', id, text }` (or streamed
  `autocomplete-chunk`/`autocomplete-done` for progressive ghost text). The host **cancels** an
  in-flight `model.sendRequest` (CancellationToken) when a newer `id` arrives or the doc changes —
  one request per panel at a time.
- `id` correlates response→request so a stale completion never paints after the caret moved.

## Ghost text in the contenteditable — the hard part (spike this first)

Render the suggestion as a **non-editable** inline node at the caret carrying **`data-render="1"`** —
the spike (Q5) proved Lute's serializer skips any `data-render="1"|"2"` subtree natively in both IR and
WYSIWYG modes (it's the marker Vditor's own preview nodes use), so the ghost is **structurally
invisible to `getValue()` with no strip step**. (A *bare* `contenteditable=false` span does NOT work —
Q1 showed it leaks; `contenteditable=false` is only for caret containment.)

- New module `media-src/src/inline-suggest.ts` (`observeInlineSuggest` / `showGhost(text)` /
  `acceptGhost()` / `dismissGhost()`), wired in `main.ts` `runFinishInit` next to `observeCodeSource`.
- Insert a `<span class="vmarkd-ghost" data-render="1" contenteditable="false" data-ghost>…</span>`
  **after** the caret. Style: `opacity`/muted foreground from the theme (`--vmarkd-*`),
  `user-select:none`.
  - **Lute round-trip (SOLVED — Q5):** `data-render="1"` makes Lute skip the subtree natively in both
    IR and WYSIWYG → `getValue()` never sees the ghost, **no strip step required**. Optional
    defense-in-depth: also dismiss synchronously on the save-flush/edit keydown. **Still test the
    round-trip explicitly** (assert `getValue()` is byte-identical with a ghost showing).
- **Keys (capture phase, before Vditor — see the webview-key-capture rule):**
  - **Tab** with a ghost present → `event.preventDefault(); stopImmediatePropagation()`, replace the
    ghost with real text at the caret via Vditor's insert path, fire the normal `edit` debounce. No
    ghost → Tab behaves as today.
  - **Esc** → dismiss. **Any other keystroke / caret move / blur** → dismiss (selectionchange, like
    the gap-paragraph + callout observers).
- **Trigger:** debounce (~`vmarkd.autocomplete.debounceMs`, default ~300 ms) after typing pauses; only
  when the caret is collapsed at the end of a text run; **suppress inside non-prose contexts** unless
  enabled (code fences → optional, tables → off initially). Optionally a manual keybinding
  (e.g. Ctrl/Cmd+\) to request on demand even with auto-trigger off.

> **META-GOTCHA (expect it):** like the other edit-surface work, ghost-text behaviour reproduces
> faithfully only in the **real VS Code webview** (blur-on-click, Vditor key handling, Lute rebuilds).
> Spike + final verification go through `npm run test:vscode` and a with-the-user check, not just the
> Playwright harness.

## Settings (`package.json` contributes, read in `collectConfigOptions()`)

- `vmarkd.autocomplete.enabled` (boolean, **default false**) — opt-in.
- `vmarkd.autocomplete.trigger` (`auto` | `manual`, default `auto`).
- `vmarkd.autocomplete.debounceMs` (number, default 300).
- `vmarkd.autocomplete.inCodeBlocks` (boolean, default false) — also suggest inside code fences.
- (later) `vmarkd.autocomplete.provider` / model selector once more than `vscode.lm` exists.

Thread through `collectConfigOptions()` (`src/extension.ts`) → webview options like the other config
(follow the `d2Layout`/`d2Theme` precedent); honor live config reload (task 26) so toggling
enable/trigger takes effect without reopen.

## Tests (per AGENTS — unit + e2e + coverage)

- **Unit** (`test/backend` + `media-src`):
  - context extraction — `prefix`/`suffix`/`lang` computed correctly at the caret, capped to the
    window size, code-fence detection.
  - accept/dismiss **state machine** — Tab accepts, Esc/typing/blur/caret-move dismiss; stale `id`
    response is ignored.
  - **Lute transparency** — a document with a ghost span present serializes **byte-identical** to the
    same document without it (round-trip guard).
  - host handler — `selectChatModels() === []` → inert (no throw); newer request cancels the prior
    `sendRequest` token.
- **e2e** (real-VS-Code `test:vscode`, headless via `xvfb-run -a`): with a **mock/fake LM** (inject a
  stub `selectChatModels` or stub the host handler to return a canned string), typing shows ghost
  text; **Tab** inserts it as real editable text + the markdown updates; **Esc** removes it with no
  document change. Assert no ghost text survives a save.
- **Coverage** — confirm `inline-suggest.ts` + the new host handler are exercised.

## See also
- Bridge: `src/extension.ts:1300` (host handlers), `media-src/src/main.ts:1312` (webview listener),
  `serializeForHost` (`main.ts:665`). CSP: `src/html-builder.ts`.
- Patterns to copy: callouts dual-node + `observeCallouts`, `code-source.ts observeCodeSource`,
  `gap-paragraph.ts` (selectionchange-driven cleanup), WYSIWYG code-highlight `wrapLuteFlatten`
  (Lute-invisible spans), the webview-key-capture (capture phase + `stopImmediatePropagation`) and
  debug-to-Output-channel rules.
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model)
  (`vscode.lm.selectChatModels`, `model.sendRequest`, consent + cancellation).
- Tasks 151 (typed host↔webview boundary — add these new messages to that typed protocol),
  152 (orchestrator decomposition — `inline-suggest.ts` is a new module under that boundary),
  148 (security — message validation: the new commands must be whitelisted/validated too).
