import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WikiCache,
  _resetCacheMap,
  extractWikiTargets,
  getOrBuildCache,
  resolveVisibleTargets,
} from '../../src/wiki-cache'
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
