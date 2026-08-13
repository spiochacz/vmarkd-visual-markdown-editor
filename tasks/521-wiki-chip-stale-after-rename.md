# 521 — renaming a wiki page leaves stale chips that offer to fork a duplicate

**Status:** 📋 OPEN — bug, found by QA journey · **Impact:** 🟠 silent: the link keeps LOOKING
valid, and the offered repair creates a duplicate page instead of reaching the renamed file ·
**Found:** 2026-08-13 implementing [task 516](516-qa-journey-coverage-plan.md) journey A5
(= an open item in [task 455](parked/455-dark-journey-probe-backlog.md)).

## Symptom

`a.md` contains a `[[b]]` chip. Rename `b.md` → `c.md`. Then:

1. The chip in `a.md` still reads **`[[b]]`** — no rewrite, and the document is not even marked
   dirty. Nothing tells the user the link is now broken.
2. Activating the chip (Ctrl/Cmd+Enter) shows:
   > Wiki page "b" was not found under "&lt;wiki-root&gt;". · **[Create Page]**
3. Taking the offered action calls `createWikiPage(root, key)` with the **stale** key `b`, writing
   a brand-new **`b.md`** at the wiki root — the exact path the renamed file used to occupy —
   seeded with `# B`, orphaned from the real content now living in `c.md`.

So the user's most natural repair *forks the wiki*: two pages, the stub at the old name and the
real one at the new name, with the link pointing at the stub.

A dead link that announces itself is a minor annoyance. This one looks healthy and quietly
duplicates content, which is why it is worth fixing rather than documenting.

## Why it happens

There is no rewrite mechanism at all — a design gap, not a broken one.

`grep -rn "onDidRenameFiles" src/ media-src/src` has exactly **one** hit:
`src/session/editor-session.ts` — and it only re-points the **currently open document's own
identity** (`activeUri`, tab title, file watcher) when the renamed file *is that document*. It has
no knowledge of chip references inside other documents and never scans for them.

Resolution is by current text: `onOpenWikilink` (`src/session/asset-link-actions.ts`) calls
`cache.resolve(key)` with whatever the chip says; 0 matches → the warning + `Create Page`, which
routes to `createWikiPage(root, key)` in `src/wiki/wiki.ts` (`newFileName = ${key}.md`).

## The constraint that decides the design

**A stale chip is indistinguishable from an intentionally-empty one.** `[[b]]` left behind by a
rename and `[[Notes for 2027]]` written on purpose before the page exists are the SAME TEXT in the
document. There is no history in the file, no marker, nothing recording that the target once
existed. Any fix that inspects a broken chip after the fact cannot tell the two apart.

Two consequences, both load-bearing:

- **The only sound basis is the `onDidRenameFiles` event itself** — the single moment where
  `oldUri` and `newUri` exist together. A second later that information is gone for good. So the
  fix is either rename-time rewriting, or nothing.
- **An earlier option in this file — "make the failure honest: stop offering Create Page / show
  the chip as broken" — is WRONG and has been removed.** Offering to create the page is CORRECT
  behaviour for an unresolved wiki link; that is the core wiki workflow. Weakening it would break
  a real feature in order to soften the symptom of a different problem, and it would not even
  distinguish the two cases it was meant to distinguish.

## Fix direction (not implemented)

The remaining choice is only about SCOPE of the rewrite:

1. **Rewrite chips on rename.** Listen to `onDidRenameFiles`; when a renamed file is inside the
   wiki root, rewrite `[[old]]` → `[[new]]` across wiki documents (at minimum the open ones; ideally
   every page in the wiki root, via the existing wiki cache). Must preserve pipe display labels
   (`[[old|Label]]` → `[[new|Label]]`) — see `media-src/src/links/wiki-serialize.ts` and
   `src/shared/wiki-core.ts`.
   - **Open documents only**: changes are visible and undoable with Ctrl+Z because they go through
     ordinary edits. But chips in closed files stay stale, so the problem is only half solved.
   - **The whole wiki root**: actually solves it, at the cost of writing files the user never
     opened, with no undo. Deserves a setting, and probably a confirmation.

Either way this mutates the user's OTHER files, which is a different class of action from the rest
of the fixes in this batch — those changed editor behaviour where the user was already working.
That is why this one waits for a deliberate decision rather than being patched in passing.

## Regression coverage already in place

`test/vscode-e2e/wiki-rename-stale-chip.spec.ts` pins **today's broken contract**: the chip text is
unchanged after the rename, and activating it produces the not-found prompt rather than navigating
to the renamed file. Fixing this MUST flip that test — update it in the same commit, never delete it.

## Verification

- After renaming a wiki target, chips pointing at it either resolve to the new file or are visibly
  broken — never silently stale.
- No path offers to create a page at a name that was just renamed away.
- Pipe display labels survive whatever rewrite is chosen.
- The pinned test flipped to the new contract and green.
