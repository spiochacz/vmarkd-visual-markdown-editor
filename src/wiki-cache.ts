import * as vscode from 'vscode'
import {
  collectWikiMarkdownFiles,
  getWikiKeys,
  normalizeWikiLookupKey,
} from './wiki'

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

// Extract wiki link targets from markdown text (same regex as custom-renderer.ts).
const WikiLinkPattern = /\[\[([^[\]\n]+?)\]\]/g
export function extractWikiTargets(markdown: string): string[] {
  WikiLinkPattern.lastIndex = 0
  const keys = new Set<string>()
  let m: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex exec loop
  while ((m = WikiLinkPattern.exec(markdown)) !== null) {
    const [target] = m[1].split('|', 1)
    const key = normalizeWikiLookupKey(target.trim())
    if (key) keys.add(key)
  }
  return Array.from(keys)
}

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
