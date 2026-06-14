import { describe, it, expect } from 'vitest'
import { matchCallout } from './callouts'

describe('matchCallout', () => {
  it('matches GitHub alert types (case-insensitive)', () => {
    expect(matchCallout('[!NOTE]')).toMatchObject({ type: 'note' })
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

  it("accepts Obsidian's foldable suffixes but ignores them (fold support dropped)", () => {
    expect(matchCallout('[!note]-')).toMatchObject({ type: 'note', title: '' })
    expect(matchCallout('[!note]+ Title')).toMatchObject({
      type: 'note',
      title: 'Title',
    })
    expect(matchCallout('[!note]-')).not.toHaveProperty('foldable')
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
