import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const vditorJs = `${repoRoot}/media/vditor/dist/js`

describe('synced Vditor assets', () => {
  it('does not ship MathJax (KaTeX-only — see task 40)', () => {
    if (!existsSync(vditorJs)) {
      // Assets only exist after `foy build` (gitignored). In CI the build runs
      // before tests, so this guard is meaningful there.
      return
    }
    expect(existsSync(`${vditorJs}/mathjax`)).toBe(false)
  })
})
