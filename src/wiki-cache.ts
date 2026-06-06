import * as vscode from 'vscode'
import * as NodePath from 'node:path'
import { collectWikiMarkdownFiles, getWikiKeys } from './wiki'
import { stripMarkdownExtension } from './wiki-core'

const WIKI_GLOB = '**/*.{md,markdown}'
const DEBOUNCE_MS = 50

export class WikiCache {
  private keyToUris = new Map<string, vscode.Uri[]>()
  private uriToKeys = new Map<string, string[]>()
  private cachedAllKeys: string[] | null = null
  private watcher: vscode.FileSystemWatcher | undefined
  private debounceTimer: NodeJS.Timeout | undefined
  private onChange: (() => void) | undefined

  private constructor(public readonly root: vscode.Uri) {}

  static async build(
    root: vscode.Uri,
    onChange?: () => void,
  ): Promise<WikiCache> {
    const cache = new WikiCache(root)
    cache.onChange = onChange
    await cache.fullScan()
    cache.startWatcher()
    return cache
  }

  has(key: string): boolean {
    return this.keyToUris.has(key)
  }

  resolve(key: string): vscode.Uri[] {
    return this.keyToUris.get(key) ?? []
  }

  allPageKeys(): string[] {
    if (!this.cachedAllKeys) {
      this.cachedAllKeys = Array.from(this.keyToUris.keys()).sort()
    }
    return this.cachedAllKeys
  }

  // Names offered by the autocomplete. A unique basename is shown bare ("Home");
  // a basename shared by several files is path-qualified ("a/Page", "b/Page") so
  // each entry is distinguishable AND the inserted [[a/Page]] resolves to exactly
  // one file (its relative-path key is unique). Without this, duplicate-basename
  // pages collapse into one ambiguous "Page" entry that can't be told apart.
  allDisplayNames(): string[] {
    const files = this.allFiles()
    // Count basenames case-insensitively, matching how resolution normalizes.
    const baseCount = new Map<string, number>()
    for (const uri of files) {
      const base = stripMarkdownExtension(
        NodePath.basename(uri.fsPath),
      ).toLowerCase()
      baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
    }
    const names = new Set<string>()
    for (const uri of files) {
      const base = stripMarkdownExtension(NodePath.basename(uri.fsPath))
      if ((baseCount.get(base.toLowerCase()) ?? 0) > 1) {
        const rel = NodePath.relative(this.root.fsPath, uri.fsPath).replace(
          /\\/g,
          '/',
        )
        names.add(stripMarkdownExtension(rel))
      } else {
        names.add(base)
      }
    }
    return Array.from(names).sort()
  }

  allFiles(): vscode.Uri[] {
    const seen = new Set<string>()
    const result: vscode.Uri[] = []
    for (const uris of this.keyToUris.values()) {
      for (const uri of uris) {
        if (!seen.has(uri.fsPath)) {
          seen.add(uri.fsPath)
          result.push(uri)
        }
      }
    }
    return result.sort((a, b) => a.fsPath.localeCompare(b.fsPath))
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.watcher?.dispose()
  }

  private async fullScan(): Promise<void> {
    this.keyToUris.clear()
    this.uriToKeys.clear()
    this.cachedAllKeys = null
    const files = await collectWikiMarkdownFiles(this.root)
    for (const file of files) {
      this.indexFile(file)
    }
  }

  private indexFile(file: vscode.Uri): void {
    const keys = getWikiKeys(this.root, file)
    this.uriToKeys.set(file.fsPath, keys)
    for (const key of keys) {
      const existing = this.keyToUris.get(key)
      if (existing) {
        if (!existing.some((u) => u.fsPath === file.fsPath)) {
          existing.push(file)
        }
      } else {
        this.keyToUris.set(key, [file])
      }
    }
    this.cachedAllKeys = null
  }

  private removeFile(fsPath: string): void {
    const keys = this.uriToKeys.get(fsPath)
    if (!keys) return
    for (const key of keys) {
      const uris = this.keyToUris.get(key)
      if (!uris) continue
      const filtered = uris.filter((u) => u.fsPath !== fsPath)
      if (filtered.length) {
        this.keyToUris.set(key, filtered)
      } else {
        this.keyToUris.delete(key)
      }
    }
    this.uriToKeys.delete(fsPath)
    this.cachedAllKeys = null
  }

  private startWatcher(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.root, WIKI_GLOB),
    )
    const scheduleUpdate = () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.onChange?.()
      }, DEBOUNCE_MS)
    }
    this.watcher.onDidCreate((uri) => {
      this.indexFile(uri)
      scheduleUpdate()
    })
    this.watcher.onDidDelete((uri) => {
      this.removeFile(uri.fsPath)
      scheduleUpdate()
    })
  }
}

export { extractWikiTargets } from './wiki-core'

// Resolve only the targets found in the current document against a cache.
// Returns the subset of keys that exist. O(targets), not O(all wiki files).
export function resolveVisibleTargets(
  cache: WikiCache,
  targets: string[],
): string[] {
  return targets.filter((key) => cache.has(key))
}

// Singleton cache per wiki root, shared across all editors in the same wiki.
const cacheByRoot = new Map<string, WikiCache>()
const buildingByRoot = new Map<string, Promise<WikiCache>>()

export async function getOrBuildCache(
  root: vscode.Uri,
  onChange?: () => void,
): Promise<WikiCache> {
  const key = root.fsPath
  const existing = cacheByRoot.get(key)
  if (existing) return existing

  let building = buildingByRoot.get(key)
  if (!building) {
    building = WikiCache.build(root, onChange).then((cache) => {
      cacheByRoot.set(key, cache)
      buildingByRoot.delete(key)
      return cache
    })
    buildingByRoot.set(key, building)
  }
  return building
}

export function invalidateCache(root: vscode.Uri): void {
  const key = root.fsPath
  const existing = cacheByRoot.get(key)
  if (existing) {
    existing.dispose()
    cacheByRoot.delete(key)
  }
  buildingByRoot.delete(key)
}

export function disposeAllCaches(): void {
  for (const cache of cacheByRoot.values()) cache.dispose()
  cacheByRoot.clear()
  buildingByRoot.clear()
}

// For testing: clear the singleton map without calling dispose.
export function _resetCacheMap(): void {
  cacheByRoot.clear()
  buildingByRoot.clear()
}
