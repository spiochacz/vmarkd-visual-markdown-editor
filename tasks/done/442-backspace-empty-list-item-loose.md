# Task 442 — Backspace on an empty list item reportedly breaks the list / opens big gaps

**Status:** ✅ DONE (2026-10-07) — fixed by [525](525-list-editing-scenario-matrix.md) #2/#3, confirmed by the user in their editor. The mechanism was fixList's empty-item Backspace branch appending the TEXT `"\n\n"` to the previous `<li>` (after its sublist), which made the next edit re-parse the list loose — exactly the reported "big gaps". 525 replaced that branch (`removeEmptyItem`, list-backspace.ts) and pins it with `media-src/e2e/list-scenarios.spec.ts` + `test/vscode-e2e/list-editing-scenarios.spec.ts`. · **Impact:** 🟡 med if real ·
**Origin:** user report — a list whose LAST item is empty (marker only, e.g. `*` / `4.`): pressing
Backspace there 'rozwala listę … robią się duże odstępy między elementami listy' (breaks the list,
big gaps open between items). Split from [428](428-list-editing-usability-vs-real-editors.md).

Reported example (the empty last item is top-level, after a nested sublist):

```
* sad
* asdfa
* das
  * dsfs
  * sdfs
*            ← empty, marker only
```

## Reproduction status — could NOT reproduce in headless (needs the user's exact steps)

Probe (`test/vscode-e2e/list-typing-probe.spec.ts`, IR) tried, and every variant came out TIGHT — no
loose serialisation, no `<li><p>` (the loose-render marker), no blank lines between items:

- flat list, empty last item created via Enter → Backspace → clean removal, tight.
- nested list, empty TOP-LEVEL item after the sublist (Enter + Shift+Tab) → Backspace → tight.
- typed `* ` as the empty item (per task 441 it becomes `- *`) → Backspace → tight.

Measured after each: `looseDOM {liWithDirectP: 0}`, getValue with no blank lines between items.

So the "big gaps" did not surface with synthetic keystrokes. Hypotheses still open:
- **WYSIWYG mode** (only IR was probed) — the loose class of bug (task 391) has shown up mode-specific
  before.
- A **specific sequence / timing** real typing produces that synthetic `keyboard.press` does not.
- **Downstream of [441](441-list-autoformat-on-space.md)**: because a typed `* ` does not become a list
  item until content, the user's trailing "empty marker" may actually be a stray paragraph glued to the
  list, and Backspace on THAT mangles it — but even reproducing that (typed `* ` → Backspace) came out
  tight here. Fixing 441 may make this moot; re-check after 441.

## Scope

- [ ] FIRST: reproduce. Get the exact steps from the user (mode IR/WYSIWYG, how the empty item was
      created, caret position, marker type) or a recording, and extend `list-typing-probe.spec.ts`
      (add a WYSIWYG pass) until the loose "big gaps" state is captured — the deliverable that turns
      this from "unreproduced" into a gated fix.
- [ ] THEN fix at the right layer: the loose-list machinery is Vditor's `fixList` empty-item branch
      (`fixBrowserBehavior.ts:492-503`) appending `\n\n` to the previous item, and our `list-tight.ts`
      (`observeTightLists`, task 391) already repairs a tight list that an edit made loose — check
      whether the repair covers this case or needs to.
- [ ] Do NOT regress the Backspace-on-marker fix (task 428, `list-backspace.ts`) — its guard already
      SKIPS empty items, so an empty-item Backspace is Vditor's branch, not ours; confirm that split
      stays correct.

## See also

- `media-src/node_modules/vditor/src/ts/util/fixBrowserBehavior.ts` (`fixList` empty-item branch
  :492-503), `media-src/src/list-tight.ts` (`observeTightLists` — the tight-list repair, task 391),
  `media-src/src/list-backspace.ts` (task 428 — skips empty items on purpose).
- [428](428-list-editing-usability-vs-real-editors.md) (umbrella),
  [391](391-list-goes-loose-while-editing.md) (the tight→loose repair, DONE — the mechanism this
  report most resembles), [441](441-list-autoformat-on-space.md) (possible root cause).
