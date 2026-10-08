import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { prewarmLute, renderForMode } from '../../src/lute/lute-host'
import { wikiTextToHtml } from '../../media-src/src/links/custom-renderer'
import {
  isLuteArtifactBuilt,
  waitForLuteWarm,
  warnLuteArtifactMissing,
} from './lute-artifact'

// Task 532 step 4 — the host's string transform (lute-host.ts renderWikiChipsInHtml, which paints the
// instant-paint overlay for a wiki file) and the webview's custom renderer (custom-renderer.ts
// wikiTextToHtml, which paints the live editor) are two implementations of one rule. This pins them
// together on a corpus, the way soft-break-html-parity.test.ts pins wrapSoftBreaksInHtml against
// wrapTopBlock: the same markdown must give chips with the same target / source / title / label
// whichever side renders them. The host side is driven through the REAL Node Lute (renderForMode), so
// the entity-escaping of the text it receives is the production one.

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const LUTE_BUILT = isLuteArtifactBuilt(ROOT)
if (!LUTE_BUILT) warnLuteArtifactMissing('wiki chip parity', ROOT)

// (A literal HTML entity INSIDE a page name, `[[a &amp; b]]`, is out: the IR render turns the entity into
// its own dual-node span, so the host regex matches across markup. Exotic; not pinned here.)
const CORPUS: Record<string, string> = {
  plain: 'a [[Home]] b',
  label: '[[Target|Display Label]]',
  two: '[[A]] and [[B|b]]',
  ampersand: '[[A&B]] in a name',
  ampersandLabel: '[[x|Tom & Jerry]]',
  quote: '[[say "hi"]]',
  apostrophe: "[[it's]] here",
  unicode: '[[Ünï cödé|Ünï]]',
  spaces: 'see [[ spaced name ]] now',
}

interface Chip {
  target: string | null
  source: string | null
  title: string | null
  text: string
}

const chipsOf = (html: string): Chip[] => {
  const doc = new JSDOM(`<body>${html}</body>`).window.document
  return Array.from(doc.querySelectorAll('.wiki-link-chip')).map((el) => ({
    target: el.getAttribute('data-wiki-target'),
    source: el.getAttribute('data-wiki-source'),
    title: el.getAttribute('title'),
    // the live editor appends a zero-width caret anchor after each chip; it is outside the span
    text: el.textContent ?? '',
  }))
}

describe('wiki chips: host overlay vs webview renderer', () => {
  beforeAll(async () => {
    if (!LUTE_BUILT) return
    prewarmLute(ROOT)
    await waitForLuteWarm()
  })

  for (const [name, md] of Object.entries(CORPUS)) {
    it(name, () => {
      if (!LUTE_BUILT) return
      const host = chipsOf(renderForMode(ROOT, md, 'ir', true) ?? '')
      const webview = chipsOf(wikiTextToHtml(md, true))
      expect(host.length).toBeGreaterThan(0)
      expect(host).toEqual(webview)
    })
  }
})
