import { afterEach, describe, expect, it, vi } from 'vitest'
import { logToHost, reportError } from './webview-log'

// webview-log posts through the global `vscode` handle (acquireVsCodeApi). Stub it
// per test; restore after.
function withVscode(post: (m: unknown) => void): void {
  ;(globalThis as { vscode?: unknown }).vscode = { postMessage: post }
}

afterEach(() => {
  ;(globalThis as { vscode?: unknown }).vscode = undefined
  vi.restoreAllMocks()
})

describe('logToHost', () => {
  it('posts a {command:"log"} message to the host', () => {
    const post = vi.fn()
    withVscode(post)
    logToHost('hello')
    expect(post).toHaveBeenCalledWith({ command: 'log', text: 'hello' })
  })

  it('falls back to console.log when the host handle is missing (never throws)', () => {
    ;(globalThis as { vscode?: unknown }).vscode = undefined
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(() => logToHost('x')).not.toThrow()
    expect(spy).toHaveBeenCalledWith('x')
  })
})

describe('reportError', () => {
  it('logs an Error via the log channel by default (not user-facing)', () => {
    const post = vi.fn()
    withVscode(post)
    reportError(new Error('boom'), 'ctx')
    expect(post).toHaveBeenCalledTimes(1)
    const [msg] = post.mock.calls[0]
    expect(msg).toMatchObject({ command: 'log' })
    expect((msg as { text: string }).text).toContain('[ctx]')
    expect((msg as { text: string }).text).toContain('boom')
  })

  it('also posts an {command:"error"} message when userFacing', () => {
    const post = vi.fn()
    withVscode(post)
    reportError('plain', 'ctx', true)
    const commands = post.mock.calls.map(
      (c) => (c[0] as { command: string }).command,
    )
    expect(commands).toContain('log')
    expect(commands).toContain('error')
  })
})
