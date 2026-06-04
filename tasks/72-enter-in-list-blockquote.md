# Task: Enter in a blockquote nested in a list item escapes the quote (#1925)

> **Status:** 🅿️ Parked (2026-06-04). Reproduced + tripwired
> (`media-src/e2e/keybugs.spec.ts`, 🔴 #1925). Fix deferred — high risk, low value.
> **Source:** Vditor upstream #1925.
> **Value / Risk:** 🟡 niche editing correctness (no data loss) / **high** — the fix is
> surgery on Vditor's core Enter/list keydown handler.

## Problem
In IR, a blockquote nested inside a list item (`- > quoted text`): pressing Enter at the
end of the quote line does NOT continue the quote — it inserts an empty `  >` line and
the next typed text lands in a **new list item** (`- more quote`) instead of staying in
the blockquote.

```
- item one
- > quoted text     ← caret here, press Enter, type "more quote"
```
yields
```
- item one
- > quoted text
  >
- more quote        ← escaped the quote AND created a new list item
```

## Root cause (localized)
- `fixBlockquote` (`util/fixBrowserBehavior.ts:1020`) only special-cases the **empty-line**
  Enter (the "逐层跳出" / escape-outward case). A **non-empty** Enter falls through to the
  generic Enter handler.
- For a **standalone** blockquote the generic handler keeps the caret in the quote
  (verified: `> quoted text` + Enter + type → `> quoted text\n>\n> second line`).
- For a blockquote **inside a list item** the generic list/Enter logic mis-routes the new
  block into a sibling list item. The defect is the list+blockquote interaction in the
  generic handler, not `fixBlockquote`.

## Why parked
- No upstream/fork reference fix to port.
- The change is in Vditor's **core Enter/list keydown** path — Enter in lists and quotes
  is among the most-used operations, with a large, hard-to-enumerate edge-case surface; a
  speculative patch risks regressing everyday editing.
- The trigger (blockquote nested in a list item) is rare and there is **no data loss** —
  the text is preserved, just restructured. Same call as task 56's parked list-scope
  rewrite.

## If revisited
Add a non-empty-Enter branch to `fixBlockquote` (or a pre-check before the list handler)
that, when the blockquote is inside an `LI`, continues the quote and places the caret on
the new quote line — guarded by an esbuild `onLoad` patch with a version anchor, and a
full regression suite (standalone-quote Enter, normal list Enter, empty-line escape,
nested list Enter) before shipping. Flip the 🔴 #1925 tripwire to a correctness test.

## Verify
Tripwire 🔴 #1925 stays red (bug present) until fixed; then it flips and becomes a
correctness assertion.
