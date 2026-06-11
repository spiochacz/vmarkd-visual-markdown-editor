import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WikiCache,
  _resetCacheMap,
  extractWikiTargets,
  getOrBuildCache,
  invalidateCache,
  resolveVisibleTargets,
} from '../../src/wiki-cache'
import { normalizeWikiLookupKey } from '../../src/wiki-core'
import { FileType, mock, Uri } from './vscode-mock'

const F = FileType.File
const D = FileType.Directory

function mountFs(tree: Record<string, [string, number][]>) {
  mock.setReadDirectory(async (uri: Uri) => tree[uri.fsPath] ?? [])
}

describe('WikiCache', () => {
  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
  })

  it('indexes files and resolves by basename key', async () => {
    mountFs({
      '/ws/wiki': [
        ['Home.md', F],
        ['My Page.md', F],
      ],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    expect(cache.has('home')).toBe(true)
    expect(cache.has('my-page')).toBe(true)
    expect(cache.has('nonexistent')).toBe(false)
    cache.dispose()
  })

  it('resolves by relative path key for nested files', async () => {
    mountFs({
      '/ws/wiki': [['sub', D]],
      '/ws/wiki/sub': [['Deep Page.md', F]],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    expect(cache.has('sub/deep-page')).toBe(true)
    expect(cache.has('deep-page')).toBe(true)
    expect(cache.resolve('deep-page')).toHaveLength(1)
    expect(cache.resolve('deep-page')[0].fsPath).toBe(
      '/ws/wiki/sub/Deep Page.md',
    )
    cache.dispose()
  })

  it('returns multiple matches for ambiguous basename', async () => {
    mountFs({
      '/ws/wiki': [
        ['a', D],
        ['b', D],
      ],
      '/ws/wiki/a': [['Page.md', F]],
      '/ws/wiki/b': [['Page.md', F]],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const matches = cache.resolve('page')
    expect(matches).toHaveLength(2)
    cache.dispose()
  })

  it('allPageKeys returns sorted deduplicated keys', async () => {
    mountFs({
      '/ws/wiki': [
        ['Alpha.md', F],
        ['sub', D],
      ],
      '/ws/wiki/sub': [['Beta.md', F]],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const keys = cache.allPageKeys()
    expect(keys).toContain('alpha')
    expect(keys).toContain('beta')
    expect(keys).toContain('sub/beta')
    expect(keys).toEqual([...keys].sort())
    cache.dispose()
  })

  it('allDisplayNames returns original-cased basenames without extension', async () => {
    mountFs({
      '/ws/wiki': [
        ['Home.md', F],
        ['Getting Started.md', F],
        ['sub', D],
      ],
      '/ws/wiki/sub': [['Deep Page.md', F]],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const names = cache.allDisplayNames()
    expect(names).toContain('Home')
    expect(names).toContain('Getting Started')
    expect(names).toContain('Deep Page')
    // No extension, no lowercasing, no slugification
    expect(names).not.toContain('home')
    expect(names).not.toContain('getting-started')
    cache.dispose()
  })

  it('path-qualifies display names for duplicate basenames', async () => {
    mountFs({
      '/ws/wiki': [
        ['Home.md', F], // unique basename → stays bare
        ['a', D],
        ['b', D],
      ],
      '/ws/wiki/a': [['Page.md', F]], // Page.md exists in two dirs
      '/ws/wiki/b': [['Page.md', F]],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const names = cache.allDisplayNames()
    // Unique basename: bare
    expect(names).toContain('Home')
    // Duplicate basename: path-qualified, NOT a bare "Page"
    expect(names).toContain('a/Page')
    expect(names).toContain('b/Page')
    expect(names).not.toContain('Page')
    // Each qualified name resolves to exactly one file
    expect(cache.resolve(normalizeWikiLookupKey('a/Page'))).toHaveLength(1)
    expect(cache.resolve(normalizeWikiLookupKey('b/Page'))).toHaveLength(1)
    cache.dispose()
  })

  it('every display name normalizes to a key present in allPageKeys', async () => {
    // Guards the hint↔missing-check contract: a page offered in the autocomplete
    // (display name) must resolve to a known key, or its chip renders as a broken
    // (red) link even though the page exists.
    mountFs({
      '/ws/wiki': [
        ['Home.md', F],
        ['Getting Started.md', F],
        ['C++ Notes.md', F],
        ['sub', D],
        ['other', D],
      ],
      // Deep Page is unique; Dup exists in two dirs (path-qualified display names)
      '/ws/wiki/sub': [
        ['Deep Page.md', F],
        ['Dup.md', F],
      ],
      '/ws/wiki/other': [['Dup.md', F]],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const keys = new Set(cache.allPageKeys())
    const names = cache.allDisplayNames()
    expect(names).toContain('sub/Dup')
    expect(names).toContain('other/Dup')
    for (const name of names) {
      expect(keys.has(normalizeWikiLookupKey(name))).toBe(true)
    }
    cache.dispose()
  })

  it('allFiles returns unique sorted files', async () => {
    mountFs({
      '/ws/wiki': [
        ['A.md', F],
        ['B.md', F],
      ],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const files = cache.allFiles()
    expect(files).toHaveLength(2)
    expect(files[0].fsPath).toBe('/ws/wiki/A.md')
    expect(files[1].fsPath).toBe('/ws/wiki/B.md')
    cache.dispose()
  })
})

describe('getOrBuildCache — singleton per root', () => {
  let readDirCount: number

  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
    readDirCount = 0
    mock.setReadDirectory(async (uri: Uri) => {
      readDirCount++
      const tree: Record<string, [string, number][]> = {
        '/ws/wiki': [
          ['A.md', F],
          ['B.md', F],
        ],
      }
      return tree[uri.fsPath] ?? []
    })
  })

  it('builds cache on first call and reuses on second', async () => {
    const c1 = await getOrBuildCache(Uri.file('/ws/wiki'))
    const after1 = readDirCount
    const c2 = await getOrBuildCache(Uri.file('/ws/wiki'))
    const after2 = readDirCount

    expect(c1).toBe(c2)
    expect(after1).toBe(1)
    expect(after2).toBe(1) // no additional scan
    c1.dispose()
  })

  it('concurrent calls share the same build promise', async () => {
    const [c1, c2] = await Promise.all([
      getOrBuildCache(Uri.file('/ws/wiki')),
      getOrBuildCache(Uri.file('/ws/wiki')),
    ])
    expect(c1).toBe(c2)
    expect(readDirCount).toBe(1)
    c1.dispose()
  })
})

describe('invalidateCache — clears a specific root', () => {
  let readDirCount: number

  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
    readDirCount = 0
    mock.setReadDirectory(async (uri: Uri) => {
      readDirCount++
      const tree: Record<string, [string, number][]> = {
        '/ws': [['A.md', F]],
        '/ws/docs': [['B.md', F]],
      }
      return tree[uri.fsPath] ?? []
    })
  })

  it('forces a rebuild on the next getOrBuildCache call', async () => {
    const c1 = await getOrBuildCache(Uri.file('/ws'))
    const afterBuild = readDirCount
    expect(c1.has('a')).toBe(true)

    invalidateCache(Uri.file('/ws'))

    const c2 = await getOrBuildCache(Uri.file('/ws'))
    expect(c2).not.toBe(c1) // new instance
    expect(readDirCount).toBe(afterBuild + 1) // one re-scan
    c2.dispose()
  })

  it('does not affect caches for other roots', async () => {
    // Build the /ws cache so the invalidateCache('/ws') below has something to drop;
    // the instance itself isn't asserted here (the /ws/docs cache is what matters).
    await getOrBuildCache(Uri.file('/ws'))
    const c2 = await getOrBuildCache(Uri.file('/ws/docs'))
    const afterBuild = readDirCount

    invalidateCache(Uri.file('/ws'))

    // /ws/docs cache still valid
    const c2Again = await getOrBuildCache(Uri.file('/ws/docs'))
    expect(c2Again).toBe(c2)
    expect(readDirCount).toBe(afterBuild) // no re-scan for docs
    c2.dispose()
  })

  it('is safe to call on a root that has no cache', () => {
    expect(() => invalidateCache(Uri.file('/nonexistent'))).not.toThrow()
  })
})

describe('extractWikiTargets', () => {
  it('extracts normalized keys from wiki link syntax', () => {
    const md = 'See [[My Page]] and [[sub/Other|label]] here.'
    const keys = extractWikiTargets(md)
    expect(keys).toContain('my-page')
    expect(keys).toContain('sub/other')
    expect(keys).toHaveLength(2)
  })

  it('deduplicates repeated targets', () => {
    const md = '[[Page]] and [[Page]] again'
    expect(extractWikiTargets(md)).toHaveLength(1)
  })

  it('returns empty for text without wiki links', () => {
    expect(extractWikiTargets('just plain text')).toHaveLength(0)
  })

  it('skips invalid targets that normalize to empty', () => {
    expect(extractWikiTargets('[[]]')).toHaveLength(0)
    expect(extractWikiTargets('[[  ]]')).toHaveLength(0)
  })
})

describe('resolveVisibleTargets', () => {
  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
  })

  it('returns only targets that exist in the cache', async () => {
    mountFs({
      '/ws/wiki': [
        ['existing.md', F],
        ['another.md', F],
      ],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    const result = resolveVisibleTargets(cache, [
      'existing',
      'missing',
      'another',
    ])
    expect(result).toEqual(['existing', 'another'])
    cache.dispose()
  })
})

describe('watcher integration', () => {
  beforeEach(() => {
    mock.reset()
    _resetCacheMap()
  })

  it('adds a new file to the cache on watcher create event', async () => {
    mountFs({ '/ws/wiki': [['A.md', F]] })
    const onChange = vi.fn()
    const cache = await WikiCache.build(Uri.file('/ws/wiki'), onChange)

    expect(cache.has('a')).toBe(true)
    expect(cache.has('new-page')).toBe(false)

    const watcher = mock.calls.fileSystemWatchers[0]
    watcher._fireCreate(Uri.file('/ws/wiki/New Page.md'))

    expect(cache.has('new-page')).toBe(true)
    expect(cache.resolve('new-page')[0].fsPath).toBe('/ws/wiki/New Page.md')

    // onChange is debounced — wait for it
    await new Promise((r) => setTimeout(r, 80))
    expect(onChange).toHaveBeenCalled()
    cache.dispose()
  })

  it('removes a file from the cache on watcher delete event', async () => {
    mountFs({
      '/ws/wiki': [
        ['A.md', F],
        ['B.md', F],
      ],
    })
    const cache = await WikiCache.build(Uri.file('/ws/wiki'))
    expect(cache.has('a')).toBe(true)

    const watcher = mock.calls.fileSystemWatchers[0]
    watcher._fireDelete(Uri.file('/ws/wiki/A.md'))

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    cache.dispose()
  })
})
