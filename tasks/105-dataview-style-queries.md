# Task 105 — Dataview-style workspace queries (design-first epic)

> **Status:** 📋 TODO — **DESIGN-FIRST EPIC, not a renderer.** Render ` ```dataview ` blocks as
> dynamic tables/lists/tasks queried across the workspace's markdown — like Obsidian's Dataview.
> This is **not** a self-contained fenced renderer (mermaid/d2/…): it's a **host-side metadata
> index + query engine**, closer to wiki-links (task 23) than to a diagram. Needs its own
> brainstorm/design + phasing before any code — do NOT start implementing from this file.
> **Source:** user request (Obsidian-vault parity). Survey: Dataview is one of the biggest
> Obsidian plugins.
> **Value / Risk:** 🟡 strong for Obsidian-migrators / **high** — large scope, reactivity,
> performance over big vaults, and a hard security boundary (`dataviewjs`).

## What Dataview is (and how it differs from every other task here)
Obsidian's Dataview indexes a vault's note **metadata** (YAML frontmatter, inline fields
`key:: value`, tasks, file metadata) and renders **dynamic** tables/lists/task views from
**queries across many notes** — via **DQL** (declarative) or **`dataviewjs`** (arbitrary JS).

Unlike mermaid/echarts/d2 (render one self-contained spec in the webview, offline), Dataview is:
- **cross-file** — needs an index of ALL workspace `.md`;
- **host-side** — file scanning/parsing/watching lives in the extension host, not the sandbox;
- **reactive** — results change when notes change;
- **not a standard** — DQL/`dv.*` are Obsidian conventions, not CommonMark.

So it belongs with the **workspace-index features (wiki-links, task 23)**, not the renderer
roadmap (87, 99–104).

## Hard scope decision: DQL-lite only, NO `dataviewjs`
`dataviewjs` executes **arbitrary JavaScript** — irreconcilable with our hardened webview CSP +
sandbox (tasks 18/67). **Out of scope, permanently.** Only a **declarative, sandboxed DQL subset**
is on the table (parsed + executed by us, never `eval`).

## Architecture sketch (for the design phase — not a build spec)
1. **Metadata index (host)** — extend the wiki index (task 23, `src/wiki.ts`) to also parse, per
   workspace `.md`: **YAML frontmatter** (depends on frontmatter handling — see the frontmatter
   analysis), **tasks** (`- [ ]`/`- [x]`), **file metadata** (path, name, mtime), and optionally
   **inline fields** (`key:: value`). Watcher → reactivity. Scoped to the workspace (untrusted-WS
   rules apply).
2. **Query engine (host)** — parse a **DQL subset** (`TABLE|LIST|TASK <fields> FROM <source>
   WHERE <expr> SORT <field> [LIMIT n]`) and execute it over the index. No JS.
3. **Render (webview)** — host posts the computed result set to the webview; a `.language-dataview`
   pass (reuse the task-99 custom fenced-renderer mechanism for the **rendering** half) draws a
   table/list/task-list. Re-render on index change.
4. **Host↔webview protocol** — webview sends the query (block text) on render; host replies with
   rows; host pushes updates when the index changes.

## MVP proposal (to validate in the design)
Phase 1: **TABLE / LIST** over **frontmatter fields** + `FROM "folder"` + `WHERE`/`SORT`/`LIMIT`,
read-only, no inline fields, no tasks, no JS. Phase 2: tasks + inline `::` fields. Phase 3:
reactivity polish. This keeps the first slice shippable and bounded.

## Risks / open questions (for brainstorm)
- **Frontmatter support** — does vMarkd parse/round-trip YAML frontmatter today? (There's a prior
  frontmatter analysis.) Dataview-lite depends on it.
- **DQL compatibility expectations** — users will expect Obsidian DQL syntax; decide how much to
  match vs a simpler dialect (document the gap).
- **Performance** — indexing/watching a large vault; incremental index updates.
- **Reactivity scope** — re-query on every file change vs debounced; which docs re-render.
- **Untrusted/virtual workspaces** — index only when trusted (capabilities, tasks 18/29).

## Process (IMPORTANT)
This is an **epic**, not a task: run **`/brainstorm` → spec → phased plan** before code. Do not
implement directly from this file. Likely several increments.

## See also
- Task 23 (wiki-links — the workspace-index infra to extend), tasks 18/29/67 (security/CSP/
  capabilities — why `dataviewjs` is out), task 99 (the fenced-render pass — reuse for the
  table/list rendering half only).
- Reference: Obsidian Dataview (DQL + dataviewjs) — `blacksmithgu/obsidian-dataview`.
