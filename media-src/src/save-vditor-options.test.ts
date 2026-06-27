// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { saveVditorOptions } from './utils'

// Persistence allow-list (task 152 item 4): saveVditorOptions must persist ONLY the
// user-chosen editor mode — never the config-derived `preview`/`theme` blob that used
// to shadow live config.
describe('saveVditorOptions', () => {
  it('persists only the editor mode, not preview/theme', () => {
    const post = vi.fn()
    ;(window as unknown as { vscode: unknown }).vscode = { postMessage: post }
    ;(globalThis as unknown as { vditor: unknown }).vditor = {
      vditor: {
        currentMode: 'ir',
        // The (config-derived) state that must NOT be persisted any more:
        options: {
          theme: 'dark',
          preview: { hljs: { style: 'github', lineNumber: true } },
        },
      },
    }

    saveVditorOptions()

    expect(post).toHaveBeenCalledTimes(1)
    const msg = post.mock.calls[0][0] as {
      command: string
      options: Record<string, unknown>
    }
    expect(msg.command).toBe('save-options')
    expect(msg.options).toEqual({ mode: 'ir' })
    expect(msg.options).not.toHaveProperty('preview')
    expect(msg.options).not.toHaveProperty('theme')
  })
})
