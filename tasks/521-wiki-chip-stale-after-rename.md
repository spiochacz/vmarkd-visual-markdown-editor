# 521 — renaming a wiki page leaves stale chips that offer to fork a duplicate

**Status:** 📋 OPEN — **deferred by decision 2026-08-13**: today's behaviour stays and is pinned by
a test; this file is now the spec for doing it properly when someone picks it up. Found by QA journey · **Impact:** 🟠 silent: the link keeps LOOKING
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

## Decision taken (2026-08-13)

**Ship nothing for now; keep the current behaviour and pin it.** Rationale: every other fix in this
batch changed editor behaviour where the user was already working. This one writes to the user's
OTHER files, which is a different class of action and deserves a deliberate design pass rather than
being patched in passing while adjacent work was in flight.

The rest of this file is the spec for doing it properly.

## How to do it properly

### 1. Decide the scope first — it drives everything else

| Scope | Solves it? | Undo | Cost |
|---|---|---|---|
| Open documents only | Half — chips in closed files stay stale and, per the constraint above, become indistinguishable from intentional ones | Yes: ordinary edits, Ctrl+Z works | Low |
| Whole `wiki.root` | Yes | **No** — writes files the user never opened | Needs a setting, probably a confirmation, and a progress/undo story |

Recommendation: implement the whole-root rewrite behind a setting
(`vmarkd.wiki.updateLinksOnRename`, values `prompt` / `always` / `never`, default `prompt`),
mirroring how other editors handle the same problem. `prompt` keeps the destructive half opt-in per
occurrence, which is what makes the no-undo cost acceptable.

### 2. Implementation

- Hook `vscode.workspace.onDidRenameFiles` — the ONLY point where `oldUri`/`newUri` coexist
  (see the constraint section). There is exactly one listener today, in
  `src/session/editor-session.ts`, and it handles the open document's own identity; this is a
  separate concern and should not be bolted onto it.
- Gate on: wiki enabled, and the renamed file inside `wiki.root`.
- Resolve the old and new wiki KEYS with the same logic `cache.resolve()` uses, so a rewrite matches
  exactly what resolution would have matched — do not hand-roll a second key derivation.
- Rewrite `[[old]]` → `[[new]]`, **preserving pipe display labels** (`[[old|Label]]` →
  `[[new|Label]]`) and any surrounding text. Reuse `src/shared/wiki-core.ts` /
  `media-src/src/links/wiki-serialize.ts` rather than a regex over raw markdown.
- For open documents, go through `WorkspaceEdit` so the change is visible and undoable. For closed
  ones, a workspace edit still gives a single undo entry in VS Code — prefer that over raw
  `fs.writeFile`.
- Handle a rename that is really a MOVE inside the root (path changes, basename does not) and a
  move OUT of the root (the link genuinely becomes unresolvable — do not rewrite it to something
  wrong).

### 3. Edge cases that will bite

- Case-only renames (`b.md` → `B.md`) on case-insensitive filesystems.
- Two pages whose keys collide after the rename.
- A rename performed while a document holding a chip is DIRTY — do not silently discard the user's
  unsaved edits (see `external-change-while-dirty.spec.ts` for the contract that already holds).
- Undo of the rename itself: VS Code can undo a file rename; the link rewrite should not be left
  behind pointing at a file that no longer has that name.
- A chip pointing at a page that does not exist yet must be left ALONE — that is the legitimate
  workflow the constraint section describes.

## Regression coverage already in place

`test/vscode-e2e/wiki-rename-stale-chip.spec.ts` pins **today's behaviour**: the chip text is
unchanged after the rename, and activating it produces the not-found prompt rather than navigating
to the renamed file. That is deliberate — it means the current state is a known, tested contract
rather than an accident, and whoever implements the above MUST flip that test in the same commit.

`test/vscode-e2e/wiki-create-missing-page.spec.ts` (journey D3) covers the create-page flow that
must keep working untouched — it is the legitimate workflow this bug's obvious "fix" would have
broken.

## Verification (for whoever implements it)

- Renaming a wiki target updates chips pointing at it, in open AND closed documents per the chosen
  scope, with pipe display labels intact.
- A chip pointing at a never-existing page is untouched, and `Create Page` still works — D3's spec
  stays green.
- The setting's `never` value really does nothing, and `prompt` does not fire on a rename outside
  the wiki root.
- A dirty document holding a chip does not lose unsaved edits.
- `wiki-rename-stale-chip.spec.ts` flipped to the new contract, and a new case covers a
  closed-document rewrite if that scope is chosen.
