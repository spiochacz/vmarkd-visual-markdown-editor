import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectWikiMarkdownFiles,
  getWikiPageKeys,
  resolveWikiLink,
} from '../../src/wiki'
import {
  WikiCache,
  _resetCacheMap,
  extractWikiTargets,
  getOrBuildCache,
  resolveVisibleTargets,
} from '../../src/wiki-cache'
import { FileType, mock, Uri } from './vscode-mock'

// Performance characterization of the wiki page-scan path. These tests don't
// assert wall-clock times (flaky on CI) — they COUNT how many fs.readDirectory
// calls the code makes, exposing the O(dirs) + "no cache" cost model. A future
// cache/watcher should bring the repeat-call counts to 0.

const F = FileType.File
const D = FileType.Directory

// Build a virtual wiki filesystem with `nDirs` subdirectories, each containing
// `filesPerDir` markdown files. Returns { tree, totalFiles, totalDirs }.
function buildLargeWiki(nDirs: number, filesPerDir: number) {
  const tree: Record<string, [string, number][]> = {}
  const rootEntries: [string, number][] = []
  let totalFiles = 0

  for (let d = 0; d < nDirs; d++) {
    const dirName = `section-${String(d).padStart(3, '0')}`
    rootEntries.push([dirName, D])
    const dirEntries: [string, number][] = []
    for (let f = 0; f < filesPerDir; f++) {
      dirEntries.push([`page-${String(f).padStart(3, '0')}.md`, F])
      totalFiles++
    }
    tree[`/ws/wiki/${dirName}`] = dirEntries
  }
  tree['/ws/wiki'] = rootEntries

  return { tree, totalFiles, totalDirs: nDirs + 1 }
}

describe('wiki scan performance characterization', () => {
  let readDirCallCount: number

  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
    mock.setWorkspaceFolder('/ws')
    readDirCallCount = 0
  })

  function mountAndCount(tree: Record<string, [string, number][]>) {
    mock.setReadDirectory(async (uri: Uri) => {
      readDirCallCount++
      return tree[uri.fsPath] ?? []
    })
  }

  describe('collectWikiMarkdownFiles — O(dirs) readDirectory calls', () => {
    it('small wiki (5 dirs × 10 files = 50 files): readDirectory calls = dirs + 1', async () => {
      const { tree, totalFiles, totalDirs } = buildLargeWiki(5, 10)
      mountAndCount(tree)

      const files = await collectWikiMarkdownFiles(Uri.file('/ws/wiki'))

      expect(files).toHaveLength(totalFiles)
      expect(readDirCallCount).toBe(totalDirs) // 1 root + 5 subdirs
    })

    it('medium wiki (50 dirs × 20 files = 1000 files): readDirectory calls = 51', async () => {
      const { tree, totalFiles, totalDirs } = buildLargeWiki(50, 20)
      mountAndCount(tree)

      const files = await collectWikiMarkdownFiles(Uri.file('/ws/wiki'))

      expect(files).toHaveLength(totalFiles)
      expect(readDirCallCount).toBe(totalDirs)
    })

    it('large wiki (200 dirs × 50 files = 10000 files): readDirectory calls = 201', async () => {
      const { tree, totalFiles, totalDirs } = buildLargeWiki(200, 50)
      mountAndCount(tree)

      const files = await collectWikiMarkdownFiles(Uri.file('/ws/wiki'))

      expect(files).toHaveLength(totalFiles)
      expect(readDirCallCount).toBe(totalDirs)
    })
  })

  describe('no cache — repeated calls re-scan from scratch', () => {
    it('getWikiPageKeys called twice = 2× full scan', async () => {
      const { tree, totalDirs } = buildLargeWiki(10, 10)
      mountAndCount(tree)

      await getWikiPageKeys(Uri.file('/ws/wiki'))
      const afterFirst = readDirCallCount

      await getWikiPageKeys(Uri.file('/ws/wiki'))
      const afterSecond = readDirCallCount

      expect(afterFirst).toBe(totalDirs)
      expect(afterSecond).toBe(totalDirs * 2) // no cache — doubled
    })

    it('resolveWikiLink re-scans on every click (same cost as init)', async () => {
      const { tree, totalDirs } = buildLargeWiki(10, 10)
      mountAndCount(tree)
      const source = Uri.file('/ws/wiki/section-000/page-000.md')

      await resolveWikiLink(source, 'page-005')
      const afterFirst = readDirCallCount

      await resolveWikiLink(source, 'page-003')
      const afterSecond = readDirCallCount

      expect(afterFirst).toBe(totalDirs)
      expect(afterSecond).toBe(totalDirs * 2) // full re-scan per click
    })
  })

  describe('getWikiPageKeys — normalization cost scales with file count', () => {
    it('returns 2 keys per file (basename + relative path), deduplicated', async () => {
      const { tree, totalFiles } = buildLargeWiki(5, 10)
      mountAndCount(tree)

      const keys = await getWikiPageKeys(Uri.file('/ws/wiki'))

      // Each file produces 2 keys, but basename may collide across dirs
      // (page-000 in section-000 and section-001 both produce basename "page-000").
      // The Set deduplicates, so unique keys ≤ 2 × totalFiles.
      expect(keys.length).toBeGreaterThan(0)
      expect(keys.length).toBeLessThanOrEqual(totalFiles * 2)
    })

    it('10000-file wiki: key generation completes (no timeout)', async () => {
      const { tree, totalFiles } = buildLargeWiki(200, 50)
      mountAndCount(tree)

      const start = performance.now()
      const keys = await getWikiPageKeys(Uri.file('/ws/wiki'))
      const elapsed = performance.now() - start

      expect(keys.length).toBeGreaterThan(0)
      // Log for manual inspection — not asserted (CI variance).
      // In-memory mock: should be < 100ms. Real fs: depends on disk.
      console.log(
        `  10k wiki: ${totalFiles} files → ${keys.length} keys in ${elapsed.toFixed(1)}ms ` +
          `(${readDirCallCount} readDirectory calls)`,
      )
    })
  })

  describe('impact on editor open (onReady path)', () => {
    it('simulated onReady: getWikiPageKeys blocks init message', async () => {
      const { tree } = buildLargeWiki(50, 20)
      mountAndCount(tree)

      // This is what onReady() does: scan + collect keys before posting init.
      // The webview can't render wiki chips until this completes.
      const start = performance.now()
      const keys = await getWikiPageKeys(Uri.file('/ws/wiki'))
      const elapsed = performance.now() - start

      expect(keys.length).toBeGreaterThan(0)
      console.log(
        `  onReady (1000 files): ${elapsed.toFixed(1)}ms, ` +
          `${readDirCallCount} readDirectory calls — ` +
          'webview blocked until complete',
      )
    })
  })

  describe('WITH WikiCache — cached lookups eliminate repeated scans', () => {
    it('first build scans once, subsequent has/resolve = 0 readDirectory', async () => {
      const { tree, totalDirs } = buildLargeWiki(50, 20)
      mountAndCount(tree)

      const cache = await WikiCache.build(Uri.file('/ws/wiki'))
      const afterBuild = readDirCallCount

      // 1000 resolve lookups — zero additional scans
      for (let i = 0; i < 1000; i++) {
        cache.has(`section-${String(i % 50).padStart(3, '0')}/page-000`)
        cache.resolve(`page-${String(i % 20).padStart(3, '0')}`)
      }
      expect(readDirCallCount).toBe(afterBuild) // unchanged

      cache.dispose()
      expect(afterBuild).toBe(totalDirs) // one scan total
    })

    it('getOrBuildCache: second editor open = 0 scans', async () => {
      const { tree, totalDirs } = buildLargeWiki(10, 10)
      mountAndCount(tree)

      await getOrBuildCache(Uri.file('/ws/wiki'))
      const afterFirst = readDirCallCount

      await getOrBuildCache(Uri.file('/ws/wiki'))
      expect(readDirCallCount).toBe(afterFirst) // no re-scan
      expect(afterFirst).toBe(totalDirs)
    })

    it('resolveVisibleTargets: O(targets) not O(files)', async () => {
      const { tree } = buildLargeWiki(50, 20)
      mountAndCount(tree)

      const cache = await WikiCache.build(Uri.file('/ws/wiki'))
      const afterBuild = readDirCallCount

      const targets = extractWikiTargets(
        'See [[section-000/page-000]] and [[page-005]] and [[missing]].',
      )
      const resolved = resolveVisibleTargets(cache, targets)

      expect(resolved).toContain('section-000/page-000')
      expect(resolved).toContain('page-005')
      expect(resolved).not.toContain('missing')
      expect(readDirCallCount).toBe(afterBuild) // zero scans for resolve

      cache.dispose()
    })
  })
})
