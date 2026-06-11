import { describe, it, expect } from 'vitest'
import { matchCallout } from './callouts'

describe('matchCallout', () => {
  it('matches GitHub alert types (case-insensitive)', () => {
    expect(matchCallout('[!NOTE]')).toMatchObject({
      type: 'note',
      foldable: false,
    })
    expect(matchCallout('[!Tip]')).toMatchObject({ type: 'tip' })
    expect(matchCallout('[!WARNING]')?.type).toBe('warning')
  })

  it('captures an optional title after the marker', () => {
    expect(matchCallout('[!NOTE] Heads up')).toMatchObject({
      type: 'note',
      title: 'Heads up',
    })
    expect(matchCallout('[!note]')?.title).toBe('')
  })

  it('parses Obsidian foldable suffixes', () => {
    expect(matchCallout('[!note]-')).toMatchObject({
      foldable: true,
      open: false,
    })
    expect(matchCallout('[!note]+ Title')).toMatchObject({
      foldable: true,
      open: true,
      title: 'Title',
    })
  })

  it('accepts unknown types (rendered with a neutral style)', () => {
    expect(matchCallout('[!whatever]')?.type).toBe('whatever')
  })

  it('returns null for normal blockquote text', () => {
    expect(matchCallout('Just a quote.')).toBeNull()
    expect(matchCallout('[not a callout]')).toBeNull()
    expect(matchCallout('')).toBeNull()
  })

  it('tolerates leading whitespace', () => {
    expect(matchCallout('  [!tip] x')?.type).toBe('tip')
  })
})
