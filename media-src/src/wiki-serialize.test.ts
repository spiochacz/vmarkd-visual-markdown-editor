import { describe, expect, it } from 'vitest'
import { rewriteWikiChipsToSource } from './wiki-serialize'

describe('rewriteWikiChipsToSource', () => {
  const chip = (target: string, source: string, label?: string) =>
    `<span class="wiki-link-chip" data-wiki-link="1" data-wiki-target="${target}" data-wiki-source="${source}" title="Open wiki page ${target}" role="link" tabindex="0">${label ?? target}</span>`

  it('replaces a simple wiki chip with its [[source]]', () => {
    const html = `<p>See ${chip('Home', '[[Home]]')} here.</p>`
    expect(rewriteWikiChipsToSource(html)).toBe('<p>See [[Home]] here.</p>')
  })

  it('handles pipe syntax: [[Target|Label]] round-trips correctly', () => {
    const html = `<p>${chip('Target', '[[Target|Display Label]]', 'Display Label')}</p>`
    expect(rewriteWikiChipsToSource(html)).toBe('<p>[[Target|Display Label]]</p>')
  })

  it('handles multiple chips in one block', () => {
    const html = `<p>${chip('A', '[[A]]')} and ${chip('B', '[[B]]')} and ${chip('C', '[[C]]')}</p>`
    expect(rewriteWikiChipsToSource(html)).toBe('<p>[[A]] and [[B]] and [[C]]</p>')
  })

  it('handles missing-page chips (data-wiki-missing="1")', () => {
    const missingChip =
      '<span class="wiki-link-chip" data-wiki-link="1" data-wiki-target="Missing" data-wiki-source="[[Missing]]" data-wiki-missing="1" role="link" tabindex="0">Missing</span>'
    expect(rewriteWikiChipsToSource(`<p>${missingChip}</p>`)).toBe(
      '<p>[[Missing]]</p>',
    )
  })

  it('unescapes HTML entities in data-wiki-source', () => {
    const html = chip('A&B', '[[A&amp;B]]', 'A&amp;B')
    expect(rewriteWikiChipsToSource(html)).toBe('[[A&B]]')
  })

  it('does not touch non-wiki spans', () => {
    const html = '<p><span class="other">text</span></p>'
    expect(rewriteWikiChipsToSource(html)).toBe(html)
  })

  it('does not touch HTML without wiki chips', () => {
    const html = '<p>Just plain **bold** text</p>'
    expect(rewriteWikiChipsToSource(html)).toBe(html)
  })

  it('handles chip inside bold/emphasis wrappers', () => {
    const html = `<p><strong>see ${chip('Page', '[[Page]]')}</strong></p>`
    expect(rewriteWikiChipsToSource(html)).toBe(
      '<p><strong>see [[Page]]</strong></p>',
    )
  })
})
