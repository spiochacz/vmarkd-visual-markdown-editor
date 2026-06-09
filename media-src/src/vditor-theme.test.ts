import { describe, expect, it, vi } from 'vitest'
import { setVditorTheme } from './vditor-theme'

// The DIP boundary to Vditor's theme API (task 84 / rec 2): asserts the mode→UI-name
// mapping ('dark'→'dark', 'light'→'classic'), the explicit content-theme path built
// from the cdn, and the no-path case.
describe('setVditorTheme', () => {
  const make = () => {
    const setTheme = vi.fn()
    return { vditor: { setTheme }, setTheme }
  }

  it('maps dark mode to the "dark" UI theme and builds the content-theme path', () => {
    const { vditor, setTheme } = make()
    setVditorTheme(vditor, 'dark', 'vs2015', 'https://cdn/vditor')
    expect(setTheme).toHaveBeenCalledWith(
      'dark',
      'dark',
      'vs2015',
      'https://cdn/vditor/dist/css/content-theme',
    )
  })

  it('maps light mode to the "classic" UI theme', () => {
    const { vditor, setTheme } = make()
    setVditorTheme(vditor, 'light', 'github', 'https://cdn/vditor')
    expect(setTheme).toHaveBeenCalledWith(
      'classic',
      'light',
      'github',
      'https://cdn/vditor/dist/css/content-theme',
    )
  })

  it('passes no content-theme path when cdn is absent (setContentTheme no-ops)', () => {
    const { vditor, setTheme } = make()
    setVditorTheme(vditor, 'light', 'github', undefined)
    expect(setTheme).toHaveBeenCalledWith(
      'classic',
      'light',
      'github',
      undefined,
    )
  })
})
