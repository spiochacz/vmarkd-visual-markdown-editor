import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectWikiMarkdownFiles,
  getWikiDocumentContext,
  getWikiPageKeys,
  getWikiRoot,
  isWikiFile,
  resolveWikiLink,
} from '../../src/wiki'
import { FileType, mock, Uri } from './vscode-mock'

// A tiny virtual filesystem for vscode.workspace.fs.readDirectory: dir fsPath ->
// [name, FileType][]. Markdown files anywhere under a `wiki/` ancestor are wiki
// pages; their lookup keys are the basename and the wiki-root-relative path,
// both normalized (lowercase, spaces/underscores -> '-', extension stripped).
function mountFs(tree: Record<string, [string, number][]>) {
  mock.setReadDirectory(async (uri: Uri) => tree[uri.fsPath] ?? [])
}

const F = FileType.File
const D = FileType.Directory

describe('wiki', () => {
  beforeEach(() => {
    mock.reset()
    mock.setWorkspaceFolder('/ws')
  })

  describe('getWikiRoot', () => {
    it('returns the nearest ancestor named "wiki" for a markdown file', () => {
      const root = getWikiRoot(Uri.file('/ws/wiki/sub/Page.md'))
      expect(root?.fsPath).toBe('/ws/wiki')
    })
    it('is case-insensitive on the folder name', () => {
      expect(getWikiRoot(Uri.file('/ws/WIKI/Page.md'))?.fsPath).toBe('/ws/WIKI')
    })
    it('returns undefined when no wiki ancestor exists', () => {
      expect(getWikiRoot(Uri.file('/ws/docs/Page.md'))).toBeUndefined()
    })
    it('returns undefined for non-markdown files', () => {
      expect(getWikiRoot(Uri.file('/ws/wiki/note.txt'))).toBeUndefined()
    })
    it('returns undefined for a non-file scheme', () => {
      expect(getWikiRoot(Uri.parse('untitled:/ws/wiki/x.md'))).toBeUndefined()
    })
  })

  describe('isWikiFile', () => {
    it('is true for a markdown file under a wiki folder', () => {
      expect(isWikiFile(Uri.file('/ws/wiki/Page.md'))).toBe(true)
    })
    it('is false outside a wiki folder, for non-md, and for undefined', () => {
      expect(isWikiFile(Uri.file('/ws/docs/Page.md'))).toBe(false)
      expect(isWikiFile(Uri.file('/ws/wiki/note.txt'))).toBe(false)
      expect(isWikiFile(undefined)).toBe(false)
    })
  })

  describe('getWikiDocumentContext', () => {
    it('is enabled with a root label inside a wiki', () => {
      const ctx = getWikiDocumentContext(Uri.file('/ws/wiki/Page.md'))
      expect(ctx.enabled).toBe(true)
      expect(ctx.rootLabel).toBeTruthy()
    })
    it('is disabled outside a wiki or for undefined', () => {
      expect(getWikiDocumentContext(Uri.file('/ws/docs/x.md')).enabled).toBe(
        false,
      )
      expect(getWikiDocumentContext(undefined).enabled).toBe(false)
    })
  })

  describe('collectWikiMarkdownFiles', () => {
    it('recursively collects .md/.markdown and skips other files', async () => {
      mountFs({
        '/ws/wiki': [
          ['Home.md', F],
          ['readme.markdown', F],
          ['note.txt', F],
          ['sub', D],
        ],
        '/ws/wiki/sub': [['Deep.md', F]],
      })
      const files = await collectWikiMarkdownFiles(Uri.file('/ws/wiki'))
      expect(files.map((f) => f.fsPath).sort()).toEqual([
        '/ws/wiki/Home.md',
        '/ws/wiki/readme.markdown',
        '/ws/wiki/sub/Deep.md',
      ])
    })
  })

  describe('getWikiPageKeys', () => {
    it('exposes the basename key and the root-relative path key, normalized', async () => {
      mountFs({
        '/ws/wiki': [['Home.md', F], ['sub', D]],
        '/ws/wiki/sub': [['Deep Page.md', F]],
      })
      const keys = await getWikiPageKeys(Uri.file('/ws/wiki'))
      expect(keys.sort()).toEqual(['deep-page', 'home', 'sub/deep-page'])
    })
  })

  describe('resolveWikiLink', () => {
    const source = Uri.file('/ws/wiki/Home.md')

    it('is disabled when the source is not in a wiki', async () => {
      const r = await resolveWikiLink(Uri.file('/ws/docs/x.md'), 'Home')
      expect(r.kind).toBe('disabled')
    })

    it('is invalid when the target normalizes to empty', async () => {
      mountFs({ '/ws/wiki': [['Home.md', F]] })
      expect((await resolveWikiLink(source, '   ')).kind).toBe('invalid')
    })

    it('resolves a unique match by basename (case/space-insensitive)', async () => {
      mountFs({
        '/ws/wiki': [['Home.md', F], ['sub', D]],
        '/ws/wiki/sub': [['Deep Page.md', F]],
      })
      const r = await resolveWikiLink(source, 'deep page')
      expect(r.kind).toBe('resolved')
      if (r.kind === 'resolved')
        expect(r.target.fsPath).toBe('/ws/wiki/sub/Deep Page.md')
    })

    it('ignores a display alias after "|"', async () => {
      mountFs({ '/ws/wiki': [['Home.md', F]] })
      const r = await resolveWikiLink(source, 'Home | shown text')
      expect(r.kind).toBe('resolved')
    })

    it('reports missing when nothing matches', async () => {
      mountFs({ '/ws/wiki': [['Home.md', F]] })
      expect((await resolveWikiLink(source, 'Nope')).kind).toBe('missing')
    })

    it('reports ambiguous when several files share the key', async () => {
      mountFs({
        '/ws/wiki': [['Home.md', F], ['a', D], ['b', D]],
        '/ws/wiki/a': [['Page.md', F]],
        '/ws/wiki/b': [['Page.md', F]],
      })
      const r = await resolveWikiLink(source, 'Page')
      expect(r.kind).toBe('ambiguous')
      if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2)
    })
  })
})
