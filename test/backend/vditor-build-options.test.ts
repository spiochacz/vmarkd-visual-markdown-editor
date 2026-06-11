import { describe, expect, it } from 'vitest'
import { buildVditorOptions } from '../../media-src/src/vditor-options'

// buildVditorOptions merge-order contract: config-/mode-derived values must be the
// FINAL, authoritative merge over msg.options, because saveVditorOptions persists the
// whole `preview` blob and replays it on the next init. The content-theme mode
// (`preview.theme.current`) is the flash-critical one: a stale value from a previous
// session makes Vditor's constructor (initUI → setContentTheme) reload the
// content-theme stylesheet to the WRONG file over the correct one shipped in the
// initial HTML, then after()'s setTheme reloads it back — a ~100 ms unstyled window
// that flashes wrong colours on every fresh open.
describe('buildVditorOptions — preview.theme.current is mode-authoritative', () => {
  it('a stale saved current ("light") cannot override a dark editor', () => {
    const opts = buildVditorOptions({
      theme: 'dark',
      cdn: 'https://cdn',
      options: { preview: { theme: { current: 'light' } } },
    })
    expect(opts.preview.theme.current).toBe('dark')
  })

  it('a stale saved current ("dark") cannot override a light editor', () => {
    const opts = buildVditorOptions({
      theme: 'light',
      cdn: 'https://cdn',
      options: { preview: { theme: { current: 'dark' } } },
    })
    expect(opts.preview.theme.current).toBe('light')
  })

  it('sets current explicitly for BOTH modes even with no saved blob', () => {
    expect(
      buildVditorOptions({ theme: 'dark', options: {} }).preview.theme.current,
    ).toBe('dark')
    expect(
      buildVditorOptions({ theme: 'light', options: {} }).preview.theme.current,
    ).toBe('light')
  })
})
