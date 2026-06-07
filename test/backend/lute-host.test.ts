import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  prerenderPrefix,
  prewarmLute,
  renderForMode,
  renderWikiChipsInHtml,
  reserializeMarkdown,
} from '../../src/lute-host'

// The real extension root — lute-host reads media/vditor/dist/js/lute/lute.min.js
// from here and runs it in an isolated vm (same path the host uses at runtime).
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// prerenderPrefix is pure — no Lute needed. It bounds what we feed Lute: small
// docs pass through; long docs are cut to a clean leading slice for the overlay.
describe('prerenderPrefix', () => {
  it('passes through a document within the cap unchanged', () => {
    const md = '# Title\n\nshort body\n'
    expect(prerenderPrefix(md)).toBe(md)
  })

  it('truncates a long document to a clean block boundary', () => {
    const para = (n: number) => `## Section ${n}\n\nLorem ipsum dolor sit.\n\n`
    let md = '# Title\n\n'
    for (let i = 0; i < 500; i++) md += para(i)
    const out = prerenderPrefix(md)
    expect(out.length).toBeLessThan(md.length)
    expect(out.length).toBeLessThanOrEqual(12_000)
    // keeps the very top, drops the far tail
    expect(out).toContain('Section 0')
    expect(out).not.toContain('Section 499')
    // cut on a block boundary → ends with a whole block, not a half-written line
    expect(/(Lorem ipsum dolor sit\.|## Section \d+)$/.test(out)).toBe(true)
  })

  it('drops a dangling unterminated code fence at the cut', () => {
    // a long lead-in, then an opened-but-not-closed fence near the cap
    const head = `${'filler paragraph text.\n\n'.repeat(450)}`
    const md = `${head}\`\`\`js\nconst x = 1\n${'// line\n'.repeat(2000)}`
    const out = prerenderPrefix(md)
    // even number of fence lines (the unterminated one was dropped)
    expect((out.match(/^```/gm) || []).length % 2).toBe(0)
  })

  it('drops an unterminated fence even when the doc OPENS with it (offset 0)', () => {
    // the only fence is on the very first line — the old guard missed this because
    // it cut on '\n```' (which needs a preceding newline) while counting '^```'
    const md = `\`\`\`js\n${'const x = 1\n'.repeat(3000)}`
    const out = prerenderPrefix(md)
    expect((out.match(/^```/gm) || []).length % 2).toBe(0)
  })
})

// renderWikiChipsInHtml is pure — no Lute needed. It rewrites [[…]] literals in
// the host-rendered overlay HTML into the same chip spans the live editor emits.
describe('renderWikiChipsInHtml', () => {
  it('rewrites a simple [[link]] to a chip span', () => {
    const out = renderWikiChipsInHtml('<p data-block="0">[[Home]]</p>')
    expect(out).toContain('class="wiki-link-chip"')
    expect(out).toContain('data-wiki-target="Home"')
    expect(out).toContain('data-wiki-source="[[Home]]"')
    expect(out).toContain('>Home</span>')
    expect(out).not.toContain('[[Home]]</p>')
  })

  it('uses the label for [[target|label]] but targets the key', () => {
    const out = renderWikiChipsInHtml('<p>[[Target|Display Label]]</p>')
    expect(out).toContain('data-wiki-target="Target"')
    expect(out).toContain('data-wiki-source="[[Target|Display Label]]"')
    expect(out).toContain('>Display Label</span>')
  })

  it('rewrites multiple links on one line', () => {
    const out = renderWikiChipsInHtml('<p>[[A]] and [[B]]</p>')
    expect(out.match(/wiki-link-chip/g)).toHaveLength(2)
  })

  it('escapes HTML in target/label', () => {
    const out = renderWikiChipsInHtml('<p>[[A&B]]</p>')
    expect(out).toContain('data-wiki-target="A&amp;B"')
    expect(out).toContain('>A&amp;B</span>')
  })

  it('leaves HTML without wiki links untouched', () => {
    const html = '<p>Just text with [single] brackets</p>'
    expect(renderWikiChipsInHtml(html)).toBe(html)
  })
})

describe('lute-host renderForMode', () => {
  it('skips split (sv) mode — structurally different, no overlay', () => {
    expect(renderForMode(ROOT, '# Heading\n', 'sv')).toBeUndefined()
  })

  it('returns undefined before Lute is warm (no host block on first open)', () => {
    // a freshly imported module: Lute not loaded yet → no synchronous host render,
    // it only kicks a prewarm so the NEXT open is covered.
    expect(renderForMode(ROOT, '# Heading\n', 'ir')).toBeUndefined()
  })

  describe('after warmup', () => {
    beforeAll(async () => {
      prewarmLute(ROOT)
      // prewarm defers the (~250 ms synchronous) load via setTimeout(0).
      await new Promise((r) => setTimeout(r, 1000))
    })

    it('renders IR DOM with the source marker for ir mode', () => {
      const html = renderForMode(ROOT, '# Heading One\n', 'ir')
      expect(html).toContain('Heading One')
      // the literal "#" source marker span — IR only
      expect(html).toContain('vditor-ir__marker--heading')
    })

    it('renders WYSIWYG DOM without the IR source marker', () => {
      const html = renderForMode(ROOT, '# Heading One\n', 'wysiwyg')
      expect(html).toContain('Heading One')
      expect(html).not.toContain('vditor-ir__marker--heading')
    })

    it('pre-renders a truncated prefix for a long document (no host freeze)', () => {
      const para = (n: number) => `## Section ${n}\n\nbody text here.\n\n`
      let md = '# Top Heading\n\n'
      for (let i = 0; i < 600; i++) md += para(i)
      const html = renderForMode(ROOT, md, 'ir')
      expect(html).toBeDefined()
      // the top of the document is painted…
      expect(html).toContain('Top Heading')
      expect(html).toContain('Section 0')
      // …but the far tail is not (it was truncated for the overlay)
      expect(html).not.toContain('Section 599')
    })

    it('renders wiki [[links]] as chips when wikiEnabled (instant-paint match)', () => {
      const html = renderForMode(ROOT, 'See [[Home]] here.\n', 'ir', true)
      expect(html).toContain('class="wiki-link-chip"')
      expect(html).toContain('data-wiki-target="Home"')
      expect(html).not.toContain('[[Home]]</') // no raw literal left in text
    })

    it('leaves [[links]] as literal text when wiki is disabled', () => {
      const html = renderForMode(ROOT, 'See [[Home]] here.\n', 'ir', false)
      expect(html).toContain('[[Home]]')
      expect(html).not.toContain('wiki-link-chip')
    })

    it('does not leak Lute into the shared host global', () => {
      expect((globalThis as { Lute?: unknown }).Lute).toBeUndefined()
    })

    // The equivalence signal the minimal-diff write-back (task 61) relies on:
    // reserializeMarkdown(block) === editor block ⇒ block unchanged ⇒ keep original.
    it('reserializeMarkdown round-trips prose and reflows an unpadded table (task 61)', () => {
      // prose is a fixed point (no reflow) — round-trips byte-for-byte
      expect(reserializeMarkdown(ROOT, 'Just a paragraph.\n')?.trim()).toBe(
        'Just a paragraph.',
      )
      // a hand-written unpadded table reflows to Lute's padded canonical form —
      // so original unpadded bytes != reserialized, which is how an *untouched*
      // table is matched (reserialize(original) === editor's padded output).
      const padded = reserializeMarkdown(ROOT, '|a|b|\n|-|-|\n|1|2|\n')
      expect(padded).toContain('| a | b |')
    })
  })
})
