# Wiki Cache — "Resolve What You See" + Lazy Background Cache

## Problem

Every file open, chip click, and "Wiki Pages" toolbar action does a full recursive
directory scan (`collectWikiMarkdownFiles`) with zero caching. On a 1000-file wiki
this means 51 `readDirectory` calls per operation; on remote/WSL, seconds of blocking.

Performance tests (`test/backend/wiki-perf.test.ts`) confirm:
- No cache: repeated calls double the call count
- `resolveWikiLink` re-scans on every click
- `onReady` blocks the init message until scan completes

## Design

### Two-phase init

**Fast path (blocks init):**
1. Parse the opening markdown with regex `/\[\[([^\[\]\n]+?)\]\]/g`
2. Extract unique wiki targets (normalize with existing `normalizeWikiLookupKey`)
3. For each target, do a **targeted lookup** — walk the wiki root's directory tree
   only enough to find/reject that specific file (fs.stat on candidate paths)
4. Build a `resolvedKeys: string[]` (only the keys that exist) and send with init
5. Webview renders chips with correct existing/missing colors immediately

**Slow path (background, non-blocking):**
6. After init is sent, run full `collectWikiMarkdownFiles` asynchronously
7. Build a `WikiCache` (see below) and store it on the provider instance
8. Post `wiki-update` message to webview with full `pageKeys`
9. Webview updates its `knownPages` Set — no re-render needed because the fast
   path already colored the visible chips correctly; only newly typed chips
   (during the ~100ms gap) would flip from missing→existing

### WikiCache class (`src/wiki-cache.ts`)

```
class WikiCache {
  private keyToUris: Map<string, Uri[]>   // normalized key → matching files
  private allKeys: string[]               // cached sorted key list
  private root: Uri
  private watcher: FileSystemWatcher

  static async build(root: Uri): Promise<WikiCache>
  has(key: string): boolean               // O(1)
  resolve(key: string): Uri[]             // O(1)
  allPageKeys(): string[]                 // O(1), cached
  dispose(): void                         // kills watcher
}
```

**Build:** One full scan via `collectWikiMarkdownFiles`, then index into `keyToUris`.

**Watcher:** `createFileSystemWatcher(new RelativePattern(root, '**/*.{md,markdown}'))`
- `onDidCreate` → compute keys for new file, add to map, push `wiki-update`
- `onDidDelete` → remove keys, push `wiki-update`
- `onDidChange` → ignore (file content change doesn't affect keys)
- Debounce `wiki-update` pushes (50ms) to batch rapid create/delete (e.g. git checkout)

### Targeted lookup (`resolveTargetsQuick`)

For the fast path, avoid full scan. For each target key:
1. Split key on `/` to get segments
2. If single segment (e.g. `"my-page"`): scan **only the root directory** one level,
   then each subdirectory — but stop at first match. Alternatively, try direct
   `fs.stat` on common paths: `root/my-page.md`, `root/My Page.md`
3. If multi-segment (e.g. `"sub/deep-page"`): `fs.stat` on `root/sub/deep-page.md`
   and `root/sub/Deep Page.md` directly

Trade-off: targeted lookup can miss unusual normalizations (e.g. `My_Page.md` for
key `my-page`). Acceptable because the background scan corrects within ~100ms.
Simpler approach: just do one full scan, cache it, and use it for both fast and slow
path (first scan serves both). The "fast" part is that the scan result is cached.

**Revised simpler approach:** Do the full scan once (first file open), cache it.
The "fast path" is just `cache.has(key)` — O(1). The "lazy" part is that the cache
is built on first wiki file open, not on extension activate. Subsequent opens are free.

### resolveWikiLink — use cache

Replace:
```ts
const files = await collectWikiMarkdownFiles(root)
const matches = files.filter(c => getWikiKeys(root, c).includes(targetKey))
```
With:
```ts
const cache = await this.getWikiCache(root)
const matches = cache.resolve(targetKey)
```

### onListWikiPages — use cache

Replace `collectWikiMarkdownFiles(wikiRoot)` with `cache.allFiles()`.

### Webview message: `wiki-update`

```ts
{ command: 'wiki-update', pageKeys: string[] }
```

Webview handler in main.ts:
- Update the `knownPages` Set
- If any `[[chip]]` in the current document references a key whose status changed,
  optionally re-render (setValue). In practice the set only grows (watcher adds),
  so missing→existing flips are rare and cosmetic — skip re-render for v1.

### Lifecycle

- `WikiCache` created lazily on first wiki file open per root
- Stored on `MarkdownEditorProvider` (or a shared singleton keyed by root fsPath)
- `dispose()` called when extension deactivates or last wiki editor for that root closes
- Watcher subscription added to `context.subscriptions`

## Test plan

### Unit tests (`test/backend/wiki-cache.test.ts`)
- `WikiCache.build` indexes files correctly (same assertions as existing wiki.test.ts)
- `has()` / `resolve()` return correct results in O(1)
- `allPageKeys()` matches `getWikiPageKeys()` output
- Simulated watcher events update the cache (create/delete)
- Cache reuse: second `getWikiCache()` call returns same instance (0 scans)

### Perf tests (update `test/backend/wiki-perf.test.ts`)
- With cache: repeated `resolveWikiLink` = 0 additional `readDirectory` calls
- With cache: `onReady` second file = 0 scans
- Watcher update: 1 incremental update, not full re-scan

### E2e (if applicable)
- Existing wiki e2e in `webview-behaviors.spec.ts` should still pass unchanged

## Files to change

- **New:** `src/wiki-cache.ts` — WikiCache class
- **Modified:** `src/wiki.ts` — export `getWikiKeys`, `normalizeWikiLookupKey`, `extractWikiTarget` (used by cache)
- **Modified:** `src/extension.ts` — lazy cache creation, use cache in onReady/resolveWikiLink/onListWikiPages, handle wiki-update message
- **Modified:** `media-src/src/main.ts` — handle `wiki-update` message (update knownPages)
- **New:** `test/backend/wiki-cache.test.ts`
- **Modified:** `test/backend/wiki-perf.test.ts` — add cache-hit assertions

## Success criteria

1. First wiki file open: one full scan, cached — subsequent opens = 0 scans
2. `resolveWikiLink`: O(1) from cache, 0 `readDirectory` calls
3. File create/delete in wiki folder: cache updated via watcher within 50ms
4. Existing tests pass unchanged
5. Perf test: repeated operations show 0 additional readDirectory calls
