import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createDiffScheduler,
  getHeadContent,
  makeDiffComputer,
  MAX_DIFF_CONTENT_SIZE,
} from '../../src/git-diff'

// A fake `vscode.git` extension API: one repo rooted at /repo, with a
// configurable HEAD blob per relative path.
function fakeGitApi(repoRoot: string, headByPath: Record<string, string>) {
  return {
    repositories: [
      {
        rootUri: { fsPath: repoRoot },
        show: vi.fn(async (_ref: string, rel: string) => {
          if (rel in headByPath) return headByPath[rel]
          throw new Error('not found')
        }),
      },
    ],
  }
}

function fakeExtensions(api: any, active = true) {
  return {
    getExtension: vi.fn((id: string) => {
      if (id !== 'vscode.git') return undefined
      return {
        isActive: active,
        exports: { getAPI: (_v: number) => api },
        activate: vi.fn(async () => ({ getAPI: (_v: number) => api })),
      }
    }),
  }
}

describe('getHeadContent', () => {
  it('returns the HEAD blob for a file inside a repo', async () => {
    const api = fakeGitApi('/repo', { 'note.md': 'head text\n' })
    const ext = fakeExtensions(api)
    const out = await getHeadContent('/repo/note.md', ext as any)
    expect(out).toBe('head text\n')
  })

  it('returns null when the git extension is missing', async () => {
    const ext = { getExtension: vi.fn(() => undefined) }
    expect(await getHeadContent('/repo/note.md', ext as any)).toBeNull()
  })

  it('returns null when the file is in no repo', async () => {
    const api = fakeGitApi('/other', { 'note.md': 'x' })
    const ext = fakeExtensions(api)
    expect(await getHeadContent('/repo/note.md', ext as any)).toBeNull()
  })

  it('returns null when show() throws (untracked / new file)', async () => {
    const api = fakeGitApi('/repo', {}) // no blobs → show throws
    const ext = fakeExtensions(api)
    expect(await getHeadContent('/repo/note.md', ext as any)).toBeNull()
  })

  it('activates the git extension when it is not yet active', async () => {
    const api = fakeGitApi('/repo', { 'note.md': 'h\n' })
    const ext = fakeExtensions(api, false)
    expect(await getHeadContent('/repo/note.md', ext as any)).toBe('h\n')
  })
})

describe('createDiffScheduler', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('debounces and posts diff-info after the delay', async () => {
    const posted: any[] = []
    const post = (m: any) => posted.push(m)
    const compute = vi.fn(async (_c: string) => [
      { startLine: 0, endLine: 1, type: 'added' as const },
    ])
    const schedule = createDiffScheduler(post, compute, 300)

    schedule('v1')
    schedule('v2') // collapses with the first
    expect(compute).not.toHaveBeenCalled() // nothing before the delay

    await vi.advanceTimersByTimeAsync(300)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(compute).toHaveBeenCalledWith('v2') // latest content wins
    expect(posted).toEqual([
      {
        command: 'diff-info',
        changes: [{ startLine: 0, endLine: 1, type: 'added' }],
      },
    ])
  })

  it('skips recompute when content is unchanged since the last run', async () => {
    const posted: any[] = []
    const compute = vi.fn(async () => [])
    const schedule = createDiffScheduler((m) => posted.push(m), compute, 300)

    schedule('same')
    await vi.runAllTimersAsync()
    schedule('same')
    await vi.runAllTimersAsync()

    expect(compute).toHaveBeenCalledTimes(1) // second run skipped
  })

  it('swallows compute errors without posting or throwing', async () => {
    const posted: any[] = []
    const compute = vi.fn(async () => {
      throw new Error('boom')
    })
    const schedule = createDiffScheduler((m) => posted.push(m), compute, 300)
    schedule('x')
    // the async timer callback catches its own error; flushing must not reject
    await vi.runAllTimersAsync()
    expect(compute).toHaveBeenCalledTimes(1)
    expect(posted).toEqual([]) // a failed diff leaves existing markers untouched
  })
})

describe('makeDiffComputer', () => {
  it('returns line changes when HEAD differs from the current content', async () => {
    const api = fakeGitApi('/repo', { 'note.md': 'a\nb\nc\n' })
    const compute = makeDiffComputer(
      '/repo/note.md',
      fakeExtensions(api) as any,
    )
    const changes = await compute('a\nB\nc\n')
    expect(changes.length).toBeGreaterThan(0)
  })

  it('returns [] when HEAD is unavailable (no git / untracked)', async () => {
    const compute = makeDiffComputer('/repo/note.md', {
      getExtension: vi.fn(() => undefined),
    } as any)
    expect(await compute('x\n')).toEqual([])
  })

  it('returns [] for content over the size cap (skips the diff)', async () => {
    const api = fakeGitApi('/repo', { 'note.md': 'a\n' })
    const compute = makeDiffComputer(
      '/repo/note.md',
      fakeExtensions(api) as any,
    )
    const big = 'x'.repeat(MAX_DIFF_CONTENT_SIZE + 1)
    expect(await compute(big)).toEqual([])
  })
})
