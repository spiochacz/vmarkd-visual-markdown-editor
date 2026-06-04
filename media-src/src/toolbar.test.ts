import { describe, it, expect } from 'vitest'
import { aboutVmarkdHtml, VMARKD_REPO } from './toolbar'

describe('aboutVmarkdHtml (About vMarkd dialog)', () => {
  it('shows the version line (Vditor + pinned Lute commit link + date) and repo link', () => {
    const html = aboutVmarkdHtml({
      vditorVersion: '3.11.2',
      luteCommit: '36ea9e0966025d7f4f343cdf9a611109bfb29ef6',
      luteCommittedAt: '2026-06-03',
    })
    expect(html).toContain(VMARKD_REPO)
    expect(html).toContain(
      'href="https://github.com/spiochacz/vmarkd-visual-markdown-editor"',
    )
    expect(html).toContain('Version: Vditor v3.11.2 / ')
    expect(html).toContain(
      'https://github.com/88250/lute/commit/36ea9e0966025d7f4f343cdf9a611109bfb29ef6',
    )
    expect(html).toContain('>36ea9e0</a> (2026-06-03)')
  })

  it('falls back to a plain "Lute" label when no commit is pinned', () => {
    const html = aboutVmarkdHtml({
      vditorVersion: '3.11.2',
      luteCommit: '',
      luteCommittedAt: '',
    })
    expect(html).toContain('Version: Vditor v3.11.2 / Lute</li>')
    expect(html).not.toContain('lute/commit/')
  })
})
