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

## Fix direction (not implemented)

Options, roughly in order of cost:

1. **Rewrite chips on rename.** Listen to `onDidRenameFiles`; when a renamed file is inside the
   wiki root, rewrite `[[old]]` → `[[new]]` across wiki documents (at minimum the open ones; ideally
   every page in the wiki root, via the existing wiki cache). Must preserve pipe display labels
   (`[[old|Label]]` → `[[new|Label]]`) — see `media-src/src/links/wiki-serialize.ts` and
   `src/shared/wiki-core.ts`.
2. **Or make the failure honest**: when a chip does not resolve, show it as visibly missing (the
   chip already has a missing state — `wiki.spec.ts` covers known/missing rendering) and, in the
   not-found prompt, offer to point it at an existing page rather than only "Create Page".
3. **At minimum**, stop the duplicate-creation trap: if the prompt is the only mechanism, it should
   not silently write to the old name when a plausible rename target exists.

Whichever route, decide deliberately — (1) mutates the user's other files, which deserves its own
thought (and possibly a setting), so this is not a one-liner.

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
