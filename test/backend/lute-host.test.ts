import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { prewarmLute, renderForMode } from '../../src/lute-host'

// The real extension root — lute-host reads media/vditor/dist/js/lute/lute.min.js
// from here and runs it in an isolated vm (same path the host uses at runtime).
const ROOT = fileURLToPath(new URL('../..', import.meta.url))

describe('lute-host renderForMode', () => {
  // These short-circuit before Lute is even consulted, so they're deterministic
  // regardless of warm state — and they guard the host-freeze / hang fixes.
  it('skips documents over the 12 KB size cap (would block the host)', () => {
    const big = 'x '.repeat(20_000) // ~40 KB
    expect(renderForMode(ROOT, big, 'ir')).toBeUndefined()
  })

  it('skips split (sv) mode — structurally different, no overlay', () => {
    expect(renderForMode(ROOT, '# Heading\n', 'sv')).toBeUndefined()
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

    it('still honors the size cap once warm', () => {
      expect(renderForMode(ROOT, 'x '.repeat(20_000), 'ir')).toBeUndefined()
    })

    it('does not leak Lute into the shared host global', () => {
      expect((globalThis as { Lute?: unknown }).Lute).toBeUndefined()
    })
  })
})
