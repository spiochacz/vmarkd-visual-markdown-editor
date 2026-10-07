# 505 — Toolbar hotkeys: one owner per key, one source of truth

Status: **DONE 2026-08-11 — verified (unit, chromium harness, real-VS-Code); see
"Implementation status" at the end of this file.**

Origin: user testing task 492 Phase 4's keybinding promotion found tooltips/menu still showing
Vditor's OLD hotkeys after the remap, and Alt+S (chosen for strikethrough) turned out to open a VS
Code menu mnemonic on Linux. Root-caused during triage; this task is the real fix, not a patch.

## Root cause

Task 492 Phase 4 added `contributes.keybindings` entries pointing at `vmarkd.format.*` commands,
but **never touched Vditor's own hotkey table** (`Options.ts`, merged into
`media-src/src/chrome/toolbar.ts` via `mergeToolbar`/`Object.assign`). That table drives THREE
things at once: the tooltip text (`MenuItem.ts` appends `menuItem.hotkey` to the tip), the
aria-label, and Vditor's own bubble-phase `keydown` handler
(`editorCommonEvent.ts:116`/`hotKey.ts`'s `matchHotKey`, which calls `event.preventDefault()` on a
match). Registering a *second*, VS Code-level handler for the same key on top of that first one is
what produced the double-fire bug Phase 4 found and patched around with `toolbar-hotkey-dedupe.ts`
— and left the tooltip/menu text still describing the untouched first system.

**The fix is not "keep both tables in sync" — it's "there is only one handler per key."** Two
independent systems reacting to the same keydown is the actual defect; synced labels on top of that
would still double-fire.

## Design

### 1. One canonical table, two consumers

New shared module (cross-tree, mirrors `src/shared/protocol.ts`'s existing host/webview split — the
webview already imports that one via `../../src/protocol`): **`src/shared/format-hotkeys.ts`**.

```ts
export interface FormatHotkey {
  toolbarName: string   // Vditor's item name, e.g. 'bold'
  command: string        // 'vmarkd.format.bold'
  key: string             // VS Code win/linux notation, e.g. 'ctrl+shift+7'
  mac: string             // VS Code mac notation, e.g. 'cmd+shift+7'
  label: string           // human label for the tooltip, e.g. 'Bold'
}
export const FORMAT_HOTKEYS: readonly FormatHotkey[] = [ /* the 12-row table below */ ]
// Separately: UNBOUND_FORMAT_COMMANDS — commands.ts registers these with NO keybinding
// (see "No keybinding at all" below); NOT in FORMAT_HOTKEYS since they have no key.
```

- **Host** (`src/app/commands.ts`): `FORMAT_COMMANDS`/the registration loop reads
  `FORMAT_HOTKEYS` directly instead of its own hand-written array.
- **Webview** (`media-src/src/chrome/toolbar.ts`): for every `FORMAT_HOTKEYS` row, the toolbar item
  becomes `{ name: toolbarName, hotkey: '', tip: formatTip(label, isMac()) }` — `hotkey: ''` makes
  Vditor's own `matchHotKey` return `false` immediately (see `hotKey.ts`: `if (hotKey === "")
  return false`), so Vditor's bubble handler no longer intercepts or `preventDefault()`s that key —
  **VS Code's registered command becomes the sole owner**. `formatTip` builds the tooltip text from
  the table's `key`/`mac` fields (already in the right notation for both platforms), NOT from
  Vditor's own `updateHotkeyTip` — reuse `isMac()` from `media-src/src/util/platform.ts` (already
  used by `undo-keybind.ts`, `save-flush.ts`, etc.), don't reinvent platform detection.

### 2. `package.json` stays hand-authored, drift-checked by a test

`package.json` is a static JSON manifest — it cannot import a TS module. Do **not** add a codegen
step (AGENTS.md: keep the toolchain plain, no niche build tooling). Instead, a unit test reads
`FORMAT_HOTKEYS` and asserts `package.json`'s `contributes.commands`/`contributes.keybindings`
contain exactly a matching entry per row (command id, key, mac) and no extras — same shape as
task 492 Phase 1's `KNOWN_TOOLBAR_ITEMS` drift guard (`toolbar-overflow.test.ts`). A renamed/added/
removed row in the shared table then fails a fast unit test instead of silently drifting.

### 3. Why the dedupe module goes away — but undo/redo need one more decision, not a copy-paste

`toolbar-hotkey-dedupe.ts` exists because task 492 Phase 4 had **two of vMarkd's own mechanisms**
independently reacting to the same key for undo/redo: `undo-keybind.ts` (task 463's window-level,
capture-phase handler — proven necessary to reach Ctrl/Cmd+Shift+Z from anywhere in the webview,
not just the editor element) AND the new `vmarkd.format.undo`/`redo` VS Code commands bound to
Ctrl+Z/Ctrl+Y. For every OTHER promoted item, disabling Vditor's own hotkey (`hotkey: ''`) leaves
the VS Code command as the sole actor — clean, no dedupe needed. Undo/redo are different: even with
Vditor's own table neutralised, `undo-keybind.ts` is OUR code, unrelated to Vditor's table, and
would still fire alongside a keybound `vmarkd.format.undo`/`redo`.

**Resolution: keep `vmarkd.format.undo`/`redo` as registered commands (Command Palette
discoverability — consistent with the existing locked decision that the buttons themselves are
"redundant but kept"), but give them NO `contributes.keybindings` entry at all.** `undo-keybind.ts`
already fully owns Ctrl/Cmd+Z, +Y, and +Shift+Z from anywhere in the webview — it is the *better*
mechanism (whole-webview reach, covers a chord VS Code core doesn't bind by default), not a
fallback needing a formal keybinding on top of it. This removes the last reason for
`toolbar-hotkey-dedupe.ts` to exist.

**Steps:** delete `media-src/src/chrome/toolbar-hotkey-dedupe.ts` and its test. Remove
`markToolbarItemActive` calls from `undo-keybind.ts` (drop the now-pointless import + call) and
from `message-router.ts`'s `trigger-toolbar-hotkey` handler (drop the `wasRecentlyActivated`
short-circuit — it's dead once nothing calls the `mark` side for the remaining promoted items,
which never had a competing in-webview mechanism to begin with).

### 4. The key table — kept vs. remapped vs. dropped

Classify each of Vditor's *originally-hotkeyed* toolbar items by what a collision would cost:
**editor-command collisions are harmless** (VS Code's Find&Replace/Add-Selection/Goto-Line don't
apply usefully to vMarkd's custom-editor content anyway, so losing them while typing markdown costs
nothing real); **workbench-command collisions are real** (Open File, Show Explorer, Toggle Panel,
Run Build Task, a chord-prefix — all things a user reasonably wants while their cursor happens to
be inside vMarkd). Bold/italic are kept regardless of either bucket — cross-tool convention too
strong to break (every tool checked in 492's research uses Ctrl+B/I, including VS Code's own
"Markdown All in One" despite Ctrl+I colliding with its Inline Chat).

**Keep at Vditor's original key** (`FORMAT_HOTKEYS`, key unchanged from `Options.ts`):

| toolbarName | key | mac | collides with (editor-level, accepted) |
|---|---|---|---|
| bold | ctrl+b | cmd+b | Toggle Sidebar Visibility — kept anyway, universal convention |
| italic | ctrl+i | cmd+i | Inline Chat — kept anyway, universal convention |
| strike | ctrl+d | cmd+d | Add Selection to Next Find Match |
| headings | ctrl+h | cmd+h | Find & Replace |
| inline-code | ctrl+g | cmd+g | Go to Line |
| list | ctrl+l | cmd+l | none known |
| quote | ctrl+; | cmd+; | none known |
| code | ctrl+u | cmd+u | none known |

**Remap** (`FORMAT_HOTKEYS`, workbench-level collision, cross-tool precedent exists):

| toolbarName | old key | new key | new mac | was colliding with |
|---|---|---|---|---|
| indent | ctrl+shift+o | **ctrl+]** | **cmd+]** | Go to Symbol in Editor |
| outdent | ctrl+shift+i | **ctrl+[** | **cmd+[** | (paired with indent) |
| ordered-list | ctrl+o | **ctrl+shift+7** | **cmd+shift+7** | Open File |
| check | ctrl+j | **ctrl+shift+9** | **cmd+shift+9** | Toggle Panel Visibility |

(`ctrl+[`/`ctrl+]` — Markdown All in One AND Google Docs independently converged on this for
indent/outdent, found during 492's research. `ctrl+shift+7`/`9` follow Google Docs' numbered-list
convention; `8` is skipped since `list` (bullet) keeps its original `ctrl+l`, so there's no need for
a contiguous 7/8/9 run.)

**No keybinding at all** (command registered, Command Palette only — OR, for the six with no
existing `vmarkd.format.*` command, nothing registered; toolbar/mouse is the only route, exactly
matching pre-492 behaviour except Vditor's own hotkey is now neutralised so it can't shadow VS
Code):

| toolbarName | was | why |
|---|---|---|
| undo | ctrl+z | `undo-keybind.ts` (task 463) already owns this — see §3 |
| redo | ctrl+y | ditto |
| link | ctrl+k | VS Code chord PREFIX — the worst collision (breaks every `Ctrl+K,*` chord); no command needed either, toolbar-only from here on |
| table | ctrl+m | a11y Toggle-Tab-Focus-Mode; no cross-tool precedent |
| line (HR) | ctrl+shift+h | Replace in Files; no cross-tool precedent |
| insert-before | ctrl+shift+b | Run Build Task; Vditor-specific concept, no precedent |
| insert-after | ctrl+shift+e | Show Explorer; Vditor-specific concept, no precedent |
| emoji | ctrl+e | Quick Open (old alias); already flagged low-value, OS has its own emoji picker |

For **all eight** of these, still set `hotkey: ''` in `toolbar.ts` (uniform — Vditor must not own
any key VS Code doesn't also formally own, or the "one owner per key" invariant breaks) — they just
lose keyboard access entirely, same trade-off task 492 already made for these exact seven
(`link`/`table`/`line`/`insert-before`/`insert-after`/`emoji` were already "no VS Code key" in the
prior revision; `undo`/`redo` are the only two moving from "had a key" to "no key", and only because
`undo-keybind.ts` supersedes it).

Net promoted-with-a-key set: **12** (down from Phase 4's 13 — `undo`/`redo` move to command-only).

### 5. Tooltip text

`formatTip(label: string, mac: boolean, row: FormatHotkey): string` — build `"${label} (${mac ?
displayMac : displayKey})"` from the table's own `key`/`mac` fields (e.g. `ctrl+shift+7` →
`Ctrl+Shift+7`, `cmd+]` → `Cmd+]` — simple capitalize/format, not Vditor's `updateHotkeyTip`, which
only understands its own `⌘`/`⇧` notation). For the eight no-keybinding items, don't pass a `tip`
override at all beyond dropping the hotkey suffix — i.e. `{ name, hotkey: '' }` alone, so the
tooltip falls back to Vditor's plain `VditorI18n[name]` label with no (now-false) key hint.

## What to verify empirically, not assume

- **Round-trip latency**: today Vditor handles its own hotkeys locally (zero round-trip); after
  this change, all 12 promoted keys go host → webview via `postMessage`. Type-test a rapid sequence
  of formatting keypresses in real VS Code and confirm no perceptible lag or dropped keystrokes.
- **Ctrl+K,\* chords still resolve** — task 492 Phase 4 already proved this once (real VS Code
  test, `format-hotkeys.spec.ts`); re-confirm it still holds once `link` is also `hotkey: ''`'d (it
  already was, but re-run the test after this refactor touches the same files).
- **Undo/redo don't double-fire** without `toolbar-hotkey-dedupe.ts` — press Ctrl+Z, Ctrl+Y, and
  Ctrl+Shift+Z for real in a real VS Code window and confirm exactly one undo/redo each, now that
  the VS Code command has no keybinding to race against `undo-keybind.ts`.
- **Every one of the 12 keys actually reaches the toolbar button** via the new tooltip labels
  matching what fires — a stale/mismatched tooltip was the bug that started this task, so the fix
  needs a test that would have caught it (e.g. assert the rendered `aria-label`/tooltip text for a
  sample of items against `FORMAT_HOTKEYS`).

## Tests (per AGENTS.md — this touches webview chrome)

- Unit: `FORMAT_HOTKEYS` table itself (shape, no duplicate keys, mac notation matches key
  notation family), the `package.json` drift guard (§2), `formatTip`'s output for a few rows on
  both platforms, `toolbar.ts`'s items carry `hotkey: ''` + the right `tip` for every row.
- Chromium harness: confirm the toolbar renders the new tooltip text (not Vditor's old one) for a
  sample of remapped items.
- Real-VS-Code e2e (mandatory, write and run): extend/rework `test/vscode-e2e/format-hotkeys.spec.ts`
  — the three empirical checks above, plus the double-fire regression tests it already has (rerun
  against the new keys, e.g. Ctrl+Shift+7 for ordered-list instead of the old Ctrl+B-only case).
- `npm run quality`, `npm run lint:ci`, `xvfb-run -a npm run test:vscode:fast` before done.

## Files likely touched

`src/shared/format-hotkeys.ts` (new), `src/app/commands.ts`, `media-src/src/chrome/toolbar.ts`,
`media-src/src/bridge/message-router.ts` (drop dedupe short-circuit), `media-src/src/editing/
undo-keybind.ts` (drop `markToolbarItemActive` call/import), `package.json`, `test/backend/
commands-and-handlers.test.ts`, `test/vscode-e2e/format-hotkeys.spec.ts`. Delete: `media-src/src/
chrome/toolbar-hotkey-dedupe.ts` + its test.

Do NOT touch Phase 5 files (`toolbar-submenu-aria.ts`, `escape-toolbar.ts`'s submenu-nav, the
Upload.ts/MenuItem.ts build-time patches) — unrelated, already closed under task 492.

## Provenance

Split out of [task 492](492-toolbar-layout-usability.md) Phase 4 after the user caught, during
real-editor testing, that tooltips/menus still showed Vditor's untouched original hotkeys post-remap
— the actual defect was two independent keyboard-handling systems, not a labeling mismatch.

---

## Implementation status — IMPLEMENTED 2026-08-07

Implemented exactly per the design above, with **one addition the spec didn't anticipate** (found
during implementation, not skipped — see "New defect found" below).

### Files touched

- **New:** `src/shared/format-hotkeys.ts` — `FORMAT_HOTKEYS` (12 rows), `UNBOUND_FORMAT_COMMANDS`
  (undo/redo), `formatTip`.
- **New:** `media-src/src/editing/format-hotkey-guard.ts` — the native-execCommand guard (see
  below); `normalizeEventKey` / `isPromotedFormatHotkey` / `setupFormatHotkeyGuard`.
- **New tests:** `test/backend/format-hotkeys.test.ts` (table shape, `formatTip`, the
  `package.json` drift guard), `media-src/src/editing/format-hotkey-guard.test.ts`.
- **Deleted:** `media-src/src/chrome/toolbar-hotkey-dedupe.ts` + its test.
- **Edited:** `src/app/commands.ts` (`FORMAT_COMMANDS` now derived from the shared table),
  `media-src/src/chrome/toolbar.ts` (every promoted/unpromoted item gets `hotkey: ''`; promoted
  items' tips come from `formatTip`), `media-src/src/boot/main.ts` (swaps
  `installToolbarRecentClickTracking` for `setupFormatHotkeyGuard`), `media-src/src/bridge/
  message-router.ts` (drops the `wasToolbarItemRecentlyActive` short-circuit),
  `media-src/src/editing/undo-keybind.ts` (drops the `markToolbarItemActive` call/import),
  `package.json` (12 `contributes.keybindings` entries matching `FORMAT_HOTKEYS` exactly; `headings`
  added as a new command; `undo`/`redo` keybindings removed, commands kept), `scripts/
  module-manifest.mjs` (added `format-hotkeys`/`format-hotkey-guard`, removed
  `toolbar-hotkey-dedupe`), `test/backend/commands-and-handlers.test.ts` (13→14 count, `headings`
  sample), `media-src/src/bridge/message-router.test.ts` (dropped the two dedupe-specific tests),
  `media-src/src/chrome/toolbar.test.ts` / `toolbar-labels.test.ts` (new/updated assertions),
  `media-src/e2e/webview-behaviors.spec.ts` (+2 chromium-harness tests: remapped tips, `hotkey: ''`
  on every promoted item), `test/vscode-e2e/format-hotkeys.spec.ts` (rewritten — see below).

### The key table that shipped (12 rows, matches `FORMAT_HOTKEYS` exactly)

Same as the task's own §4 table. One correction versus the CURRENT (pre-505) `package.json`, which
had drifted from what Phase 4 intended: `strike` was live on `alt+s` (the Linux-menu-mnemonic bug
that triggered this task) — fixed to `ctrl+d`/`cmd+d`, its Vditor-original key. `list` was live on
`ctrl+shift+8` — reverted to `ctrl+l`/`cmd+l` (its Vditor-original key; the 7/8/9 run was never
needed since `list` never moved). `inline-code` was live on `ctrl+e` (Phase 4 borrowed emoji's
freed key) — moved to its own Vditor-original `ctrl+g`/`cmd+g`, now that `headings` is promoted
instead of freeing a key for `inline-code`. `headings` is newly promoted (`ctrl+h`/`cmd+h`) — task
505 reclassified its collision (VS Code's Find & Replace) as an accepted editor-level collision,
reversing Phase 4's original drop. `indent`/`outdent`/`ordered-list`/`check` were already correct
in `package.json` (Phase 4 had gotten the remap right; only `toolbar.ts` was never updated to
match, which was the actual bug this task fixes).

### New defect found during implementation (not in the original spec)

**Setting `hotkey: ''` also removes a side effect: Vditor's own `preventDefault()`, which used to
incidentally suppress the BROWSER's native contenteditable execCommand for Ctrl+B/I/U.** Chromium
runs a built-in bold/italic/underline execCommand on those chords inside any `contenteditable`
(`.vditor-ir` is one) unless the keydown is prevented. Measured before a fix: a real Ctrl+B
produced `Hello ****world.` (corrupted) instead of `Hello **world**.` — the native execCommand ran
inside the same keydown as the VS Code command's async round trip. Fixed with a new module,
`media-src/src/editing/format-hotkey-guard.ts`: a capture-phase `keydown` listener that matches the
same `FORMAT_HOTKEYS` table and calls **only** `event.preventDefault()` — no toolbar dispatch, no
engine call. This does not reintroduce a second actor: task 492 already proved VS Code's
registered-keybinding dispatch is a separate, IPC-driven mechanism unaffected by a page-script
`preventDefault()` (Vditor's own handler called it on every promoted key before, and the VS Code
command still double-fired anyway) — so `preventDefault()` here blocks only the browser default;
the VS Code command remains the sole actor. Applied uniformly to all 12 keys, not just B/I/U.
Flagged to the team lead mid-implementation per "no unilateral scope cuts" before proceeding.

### Deliberate deviations from §5's "no tip override for no-keybinding items" rule

Two of the eight no-keybinding items (`line`, `redo`) already carried a **pre-existing, hotkey-
unrelated** custom tip (`"Horizontal Rule"` instead of Vditor's terse `"Line"`; `redo`'s
`"(Shift+Ctrl/Cmd+Z)"` documenting the extra chord `undo-keybind.ts` owns). Both are kept — deleting
accurate, unrelated user-facing text to satisfy a rule aimed at *stale hotkey hints* would be a
regression, not a fix. `hotkey: ''` was still added to both. `media-src/src/chrome/toolbar.test.ts`
pins this explicitly as a deliberate exception, not an oversight.

### What to verify empirically — actual results

- **Round-trip latency:** not perceptible in manual + automated real-keypress testing (see the
  real-VS-Code spec below — every promoted key round-trips host→webview via `postMessage` and
  lands well within a single `settle()` window).
- **Ctrl+K,\* chords still resolve:** re-confirmed. `format-hotkeys.spec.ts`'s chord test presses a
  real `Ctrl+K` then `Ctrl+S` with the vMarkd editor focused; a new "Keyboard Shortcuts" tab opens
  — the chord reaches the workbench, unaffected by `link`'s toolbar item also now carrying
  `hotkey: ''`.
- **Undo/redo don't double-fire:** confirmed with REAL keypresses, not `executeCommand`. Two
  separate toolbar-driven edits (bold, then italic) create two undo-stack steps; a single real
  `Ctrl+Z` lands exactly on the intermediate (bold-only) state — a double-fire would have skipped
  straight to the original. A second `Ctrl+Z` reaches the original; `Ctrl+Y` redoes exactly the
  bold step; `Ctrl+Shift+Z` redoes exactly the italic step on top. All four chords resolved
  entirely by `undo-keybind.ts`, with no `contributes.keybindings` entry left to race it.

### Tests

- **Unit** (`npm test`: 199 files / 2824 tests, all green): `test/backend/format-hotkeys.test.ts`
  (table shape incl. no duplicate/mismatched keys, `formatTip` output both platforms, the
  `package.json` drift guard — 12 rows match exactly, `when` clause, undo/redo have a command but
  NO keybinding, no `vmarkd.format.*` keybinding beyond the 12), `media-src/src/editing/
  format-hotkey-guard.test.ts` (key normalization, match/no-match incl. undo/redo excluded, capture
  phase registration, preventDefault-only behavior), `media-src/src/chrome/toolbar.test.ts` (every
  promoted item is `hotkey: ''` + tip-from-table; every unpromoted item is `hotkey: ''` + no NEW
  tip; the two pre-existing tip exceptions; `headings` promoted), `toolbar-labels.test.ts` updated
  for `ordered-list`'s new tip, `toolbar-overflow.test.ts`/`toolbar.test.ts` (pre-existing, still
  green — `createToolbar()`'s shape is compatible), `message-router.test.ts` (dedupe tests removed,
  plain-dispatch + undo/redo-engine-routing tests kept), `commands-and-handlers.test.ts` (14-entry
  count, `headings` sample), `module-boundaries.test.ts` (manifest updated, still green).
- **Chromium harness** (`xvfb-run -a npm --prefix media-src run test:e2e`: 460 passed / 5
  pre-existing skips, unrelated): `webview-behaviors.spec.ts` — remapped items render the NEW tip
  text (not Vditor's `⌘`/`⇧` notation), every promoted item has `hotkey: ''`.
- **Real-VS-Code** (`test/vscode-e2e/format-hotkeys.spec.ts`, rewritten from Phase 4's 3 tests to 4,
  written and run — `xvfb-run -a npm --prefix test/vscode-e2e test -- format-hotkeys.spec.ts`, 4
  passed, ~50s. One flake surfaced under machine load (shared session, several concurrent agents;
  `uptime` showed load average ~6 at the time) in the indent/outdent case — `settle()` windows in
  the two multi-action tests were bumped from 500ms to 900ms (matching the margin already proven
  stable in the first test) and re-verified `--repeat-each=3 --retries=0`: 12/12 passed, ~3.4 min):
  1. **Kept-original-key rows** — bold/italic/strike/inline-code/list/quote/headings act exactly
     once (incl. the native-execCommand regression net for Ctrl+B/I/U), plus `code` (Ctrl+U) last
     since its block-level fence restructure would otherwise disturb later `selectWord` lookups.
     Headings verified end-to-end: Ctrl+H opens the level panel, clicking H2 sets the heading.
  2. **Remapped rows** — `ctrl+shift+7`/`9` (ordered-list/check) and `ctrl+]`/`[` (indent/outdent,
     inside a list item) each act exactly once at their NEW key.
  3. **Undo/redo real-keypress double-fire check** — the four-chord sequence described above.
  4. **Ctrl+K,Ctrl+S chord** — unchanged from Phase 4, re-run to confirm it still holds.
- `npm run quality` (Biome lint incl. cognitive complexity, knip, jscpd, dependency-cruiser, unit
  coverage, the 0%-module ratchet — still 17, unchanged): all PASS. `npm run lint:ci`: PASS, clean
  tree. `xvfb-run -a npm run test:vscode:fast`: 41/41 passed (~8.4 min). New files at 100% unit
  coverage (`format-hotkeys.ts`, `format-hotkey-guard.ts`); `toolbar.ts`'s overall file percentage
  is unchanged from its pre-existing baseline (its uncovered lines are the pre-existing DOM-only
  helpers like `insertMarkdownLink`, exercised by the chromium harness, not unit tests).

Closed and moved to `tasks/done/` by user request (2026-08-11).
