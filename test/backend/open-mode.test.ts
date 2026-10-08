// Task 532 step 5a — the host (overlay mode) and the webview (Vditor boot mode) share this one rule.
import { describe, expect, test } from 'vitest'
import {
  resolveOpenMode,
  STREAM_MIN_CHARS,
  shouldStream,
} from '../../src/shared/open-mode'
import type { OpenMode } from '../../src/shared/protocol'

const SAVED = ['ir', 'wysiwyg', 'sv', undefined, 'garbage'] as const
const DEFAULTS: (OpenMode | undefined)[] = [
  undefined,
  'ir',
  'wysiwyg',
  'sv',
  'preview',
]

describe('resolveOpenMode', () => {
  test.each(
    SAVED.flatMap((saved) => DEFAULTS.map((def) => [saved, def] as const)),
  )('saved %s + default %s', (saved, def) => {
    const expected = def
      ? def === 'preview'
        ? 'ir'
        : def
      : saved === 'wysiwyg' || saved === 'sv'
        ? saved
        : 'ir'
    expect(resolveOpenMode(saved, def)).toBe(expected)
  })

  test('a configured default wins over the mode the last session ended in', () => {
    expect(resolveOpenMode('ir', 'wysiwyg')).toBe('wysiwyg')
  })

  test('preview is an overlay over IR, never a Vditor mode', () => {
    expect(resolveOpenMode('wysiwyg', 'preview')).toBe('ir')
  })

  test('no default = remember the saved mode, unknown values fall back to ir', () => {
    expect(resolveOpenMode('sv', undefined)).toBe('sv')
    expect(resolveOpenMode('garbage', undefined)).toBe('ir')
    expect(resolveOpenMode(undefined, undefined)).toBe('ir')
  })
})

// Review fix (task 532 5a): the webview forces IR for a streamed (huge) document, so the host overlay
// must follow the same rule.
describe('large documents', () => {
  test('shouldStream: over the threshold and not switched off', () => {
    expect(shouldStream(STREAM_MIN_CHARS + 1, undefined)).toBe(true)
    expect(shouldStream(STREAM_MIN_CHARS + 1, true)).toBe(true)
    expect(shouldStream(STREAM_MIN_CHARS + 1, false)).toBe(false)
    expect(shouldStream(STREAM_MIN_CHARS, undefined)).toBe(false)
    expect(shouldStream(0, undefined)).toBe(false)
  })

  test.each(['ir', 'wysiwyg', 'sv', 'preview', undefined] as const)(
    'a streamed document opens in ir whatever the default (%s)',
    (def) => {
      expect(resolveOpenMode('sv', def, true)).toBe('ir')
      expect(resolveOpenMode('wysiwyg', def, true)).toBe('ir')
    },
  )

  test('not streamed leaves the rule untouched', () => {
    expect(resolveOpenMode('ir', 'wysiwyg', false)).toBe('wysiwyg')
  })
})
