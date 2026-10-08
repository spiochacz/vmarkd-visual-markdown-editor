import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DiagramCache } from '../../src/webview-host/diagram-cache-host'

// Task 184 — the pure host cache (no vscode): LRU + size cap, per-doc PINNED current-set
// fairness, disk round-trip, version-key invalidation. Driven against a real tmp dir with a
// deterministic clock (now = incrementing counter) and flushDelayMs:0 (explicit flushNow()).

let dir: string
// Monotonic clock so LRU ordering is deterministic (oldest lastUsed evicts first).
let clock: number
const now = () => ++clock

function makeCache(
  opts: Partial<ConstructorParameters<typeof DiagramCache>[0]> = {},
) {
  return new DiagramCache({
    dir,
    version: 'v1',
    maxBytes: 1_000_000,
    now,
    flushDelayMs: 0,
    ...opts,
  })
}

// An SVG string of an approximate byte size (so we can drive the byte cap deterministically).
const svgOf = (tag: string, bytes = 100) =>
  `<svg data-t="${tag}">${'x'.repeat(Math.max(0, bytes - 20))}</svg>`

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmarkd-cache-'))
  clock = 0
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('DiagramCache — memory tier', () => {
  it('stores + serves a render by hash', () => {
    const c = makeCache()
    c.put('doc://a', 'd2#0', 'h1', svgOf('one'))
    expect(c.get('h1')).toContain('data-t="one"')
    expect(c.get('missing')).toBeUndefined()
  })

  it('a hit bumps recency so it is NOT the next eviction victim', () => {
    // Cap fits ~2 small entries; three unpinned (closed-doc) entries force eviction.
    const c = makeCache({ maxBytes: 250 })
    c.put('doc://a', 'd2#0', 'h1', svgOf('1', 100))
    c.put('doc://a', 'd2#1', 'h2', svgOf('2', 100))
    c.closeDoc('doc://a') // both now unpinned LRU
    c.get('h1') // touch h1 → newer than h2
    c.put('doc://b', 'd2#0', 'h3', svgOf('3', 100)) // pushes over cap → evict oldest unpinned
    expect(c.get('h2')).toBeUndefined() // h2 was the least-recently-used → evicted
    expect(c.get('h1')).toBeDefined() // touched → survived
  })
})

describe('DiagramCache — per-doc PINNED current-set fairness', () => {
  it('editing ONE diagram never evicts sibling diagrams, and every latest render is retained', () => {
    // Cap holds ~4 entries of 100 bytes. One doc, three diagrams (A/B/C) + heavy editing of A.
    const c = makeCache({ maxBytes: 400 })
    c.put('doc://x', 'd2#0', 'A1', svgOf('A1', 100)) // A, initial
    c.put('doc://x', 'd2#1', 'B', svgOf('B', 100)) // B (sibling)
    c.put('doc://x', 'd2#2', 'C', svgOf('C', 100)) // C (sibling)
    // Heavily edit A: each new render supersedes A's previous (which becomes UNPINNED surplus).
    let lastA = 'A1'
    for (let i = 2; i <= 40; i++) {
      lastA = `A${i}`
      c.put('doc://x', 'd2#0', lastA, svgOf(lastA, 100))
    }
    // Fairness: siblings' latest renders are ALWAYS retained (pinned).
    expect(c.get('B')).toBeDefined()
    expect(c.get('C')).toBeDefined()
    // A's LATEST render is retained (pinned as the current-set entry).
    expect(c.get(lastA)).toBeDefined()
    // A's superseded early renders were reclaimed as unpinned surplus (cap enforced).
    expect(c.get('A1')).toBeUndefined()
    expect(c.stats().totalBytes).toBeLessThanOrEqual(400)
  })

  it('keeps pinned entries even when they exceed the cap (fairness wins over the cap)', () => {
    // 5 distinct diagrams pinned, cap only fits 2 — all 5 latest renders must survive.
    const c = makeCache({ maxBytes: 200 })
    for (let i = 0; i < 5; i++)
      c.put('doc://y', `d2#${i}`, `P${i}`, svgOf(`P${i}`, 100))
    for (let i = 0; i < 5; i++) expect(c.get(`P${i}`)).toBeDefined()
  })

  it('closeDoc releases pins so closed-doc renders become evictable surplus', () => {
    const c = makeCache({ maxBytes: 150 })
    c.put('doc://z', 'd2#0', 'Z', svgOf('Z', 100))
    expect(c.get('Z')).toBeDefined()
    c.closeDoc('doc://z') // Z now unpinned
    // A different open doc pushes over the cap → the closed-doc entry is reclaimed.
    c.put('doc://z2', 'd2#0', 'Z2', svgOf('Z2', 100))
    expect(c.get('Z')).toBeUndefined()
    expect(c.get('Z2')).toBeDefined()
  })
})

describe('DiagramCache — disk tier (survives restart)', () => {
  it('round-trips through disk: a fresh instance on the same dir serves the render', () => {
    const c1 = makeCache()
    c1.put('doc://a', 'd2#0', 'h1', svgOf('persisted'))
    c1.flushNow()
    // Simulate a restart: brand-new instance, same dir + version.
    const c2 = makeCache()
    expect(c2.get('h1')).toContain('data-t="persisted"')
  })

  it('version bump wipes the disk store (old-engine SVGs never reused)', () => {
    const c1 = makeCache({ version: 'v1' })
    c1.put('doc://a', 'd2#0', 'h1', svgOf('old'))
    c1.flushNow()
    const c2 = makeCache({ version: 'v2' }) // engine re-pin
    expect(c2.get('h1')).toBeUndefined()
    // The store is usable again under the new version.
    c2.put('doc://a', 'd2#0', 'h2', svgOf('new'))
    c2.flushNow()
    const c3 = makeCache({ version: 'v2' })
    expect(c3.get('h2')).toContain('data-t="new"')
  })

  it('persisted store stays under the byte cap (LRU pruned before write)', () => {
    const c = makeCache({ maxBytes: 300 })
    // 10 unpinned entries of 100 bytes: only ~3 fit.
    for (let i = 0; i < 10; i++) {
      c.put('doc://a', `d2#${i}`, `k${i}`, svgOf(`k${i}`, 100))
      c.closeDoc('doc://a') // unpin immediately so each is surplus
    }
    c.flushNow()
    expect(c.stats().totalBytes).toBeLessThanOrEqual(300)
    // The on-disk blob dir must not hold more than the cap allows either.
    const blobs = fs.readdirSync(path.join(dir, 'blobs'))
    expect(blobs.length).toBeLessThanOrEqual(3)
  })
})

describe('DiagramCache — atomic + multi-window disk tier (185/3b)', () => {
  it('flushNow leaves no tmp file and a parseable index (temp+rename)', () => {
    const a = makeCache()
    a.put('doc://a', 'd1', 'hx', svgOf('x'))
    a.flushNow()
    const files = fs.readdirSync(dir)
    expect(files.some((f) => f.includes('.tmp'))).toBe(false)
    const index = JSON.parse(
      fs.readFileSync(path.join(dir, 'index.json'), 'utf8'),
    )
    expect(index.version).toBe('v1')
    expect(index.entries.hx).toBeDefined()
  })

  it('a corrupt (torn) index falls back to an empty cache without throwing', () => {
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      '{"version":"v1","entr',
      'utf8',
    )
    const a = makeCache()
    expect(a.get('anything')).toBeUndefined()
    expect(a.stats().memoryEntries).toBe(0)
  })

  it('two windows on one dir: a later flush UNIONS with the disk index instead of overwriting', () => {
    // Both instances load the (empty) disk state FIRST — the last-write-wins bug scenario.
    const a = makeCache()
    const b = makeCache()
    a.get('warm-load-a')
    b.get('warm-load-b')
    a.put('doc://a', 'd1', 'ha', svgOf('a'))
    a.flushNow()
    b.put('doc://b', 'd1', 'hb', svgOf('b'))
    b.flushNow() // pre-fix this wrote ONLY hb, dropping ha from the index
    const c = makeCache()
    expect(c.get('ha')).toBe(svgOf('a'))
    expect(c.get('hb')).toBe(svgOf('b'))
  })

  it("an eviction in one window doesn't strand the other: the missing blob is re-written (heal)", () => {
    const a = makeCache()
    a.put('doc://a', 'd1', 'ha', svgOf('a'))
    a.flushNow()
    // Simulate the OTHER window evicting ha: blob gone + index row dropped.
    fs.rmSync(path.join(dir, 'blobs', 'ha.svg'))
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({ version: 'v1', entries: {} }),
      'utf8',
    )
    a.get('ha') // recency bump → schedules a flush
    a.flushNow() // heal: ha's row is gone from disk → blob re-queued + re-written
    const c = makeCache()
    expect(c.get('ha')).toBe(svgOf('a'))
  })

  it('a different-version disk index is not merged into ours (no old-engine rows leak)', () => {
    fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'blobs', 'old.svg'), svgOf('old'), 'utf8')
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        version: 'v0',
        entries: { old: { bytes: 100, lastUsed: 1 } },
      }),
      'utf8',
    )
    const a = makeCache() // version v1
    a.put('doc://a', 'd1', 'ha', svgOf('a'))
    a.flushNow()
    const index = JSON.parse(
      fs.readFileSync(path.join(dir, 'index.json'), 'utf8'),
    )
    expect(index.version).toBe('v1')
    expect(index.entries.old).toBeUndefined()
    expect(index.entries.ha).toBeDefined()
  })

  it('lazily hydrates only the requested blob on restart, not the whole store (task 414)', () => {
    const a = makeCache()
    a.put('doc://a', 'd1', 'hA', svgOf('A'))
    a.put('doc://a', 'd2', 'hB', svgOf('B'))
    a.flushNow()
    const c = makeCache() // fresh instance simulating a VS Code restart
    expect(c.get('hA')).toContain('data-t="A"')
    // Only hA's blob content should have been read into memory — hB stays disk-only
    // (known from the index, not yet hydrated) until something actually requests it.
    expect(c.stats().memoryEntries).toBe(1)
    expect(c.get('hB')).toContain('data-t="B"')
    expect(c.stats().memoryEntries).toBe(2)
  })

  it('totalBytes reflects the whole disk store from the index alone, before any hydration', () => {
    const svgA = svgOf('A', 100)
    const svgB = svgOf('B', 150)
    const expectedTotal =
      Buffer.byteLength(svgA, 'utf8') + Buffer.byteLength(svgB, 'utf8')
    const a = makeCache()
    a.put('doc://a', 'd1', 'hA', svgA)
    a.put('doc://a', 'd2', 'hB', svgB)
    a.flushNow()
    const c = makeCache()
    expect(c.get('nonexistent')).toBeUndefined() // triggers ensureLoaded via a miss
    expect(c.stats().totalBytes).toBe(expectedTotal)
    expect(c.stats().memoryEntries).toBe(0) // neither hA nor hB was ever read
  })

  it('evicts disk-only (un-hydrated) LRU entries under the cap without ever reading their blob', () => {
    const a = makeCache({ maxBytes: 250 })
    a.put('doc://a', 'd1', 'h1', svgOf('1', 100))
    a.closeDoc('doc://a')
    a.put('doc://a', 'd2', 'h2', svgOf('2', 100))
    a.closeDoc('doc://a')
    a.flushNow()
    const c = makeCache({ maxBytes: 250 })
    expect(c.get('missing')).toBeUndefined() // loads the index; h1/h2 total 200, under cap
    expect(c.stats().memoryEntries).toBe(0) // still disk-only, nothing hydrated yet
    c.put('doc://b', 'd1', 'h3', svgOf('3', 100)) // total → 300 > 250 → evict oldest unpinned
    expect(c.get('h1')).toBeUndefined() // evicted while still un-hydrated
    expect(c.get('h2')).toBeDefined()
    expect(c.get('h3')).toBeDefined()
  })

  it('flushNow heal-loop never writes literal "undefined" for an un-hydrated disk-only entry', () => {
    const a = makeCache()
    a.put('doc://a', 'd1', 'hA', svgOf('A'))
    a.put('doc://a', 'd2', 'hB', svgOf('B'))
    a.flushNow()
    const c = makeCache()
    expect(c.get('hA')).toContain('data-t="A"') // hydrates ONLY hA; hB stays disk-only
    // Simulate another window's eviction dropping hB's row entirely (a heal-path trigger).
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        version: 'v1',
        entries: { hA: { bytes: 100, lastUsed: 1 } },
      }),
      'utf8',
    )
    expect(() => c.flushNow()).not.toThrow()
    for (const f of fs.readdirSync(path.join(dir, 'blobs'))) {
      expect(fs.readFileSync(path.join(dir, 'blobs', f), 'utf8')).not.toBe(
        'undefined',
      )
    }
    // hA — the only hydrated entry — must still round-trip correctly.
    const c2 = makeCache()
    expect(c2.get('hA')).toContain('data-t="A"')
  })

  it('orphan blobs are GC-ed on load once aged; fresh strays survive the grace window', () => {
    const a = makeCache()
    a.put('doc://a', 'd1', 'ha', svgOf('a'))
    a.flushNow()
    const blobs = path.join(dir, 'blobs')
    const oldOrphan = path.join(blobs, 'orphan-old.svg')
    const freshOrphan = path.join(blobs, 'orphan-fresh.svg')
    fs.writeFileSync(oldOrphan, svgOf('dead'), 'utf8')
    fs.writeFileSync(freshOrphan, svgOf('maybe'), 'utf8')
    // Age one orphan past the GC grace (mtime is what the sweep compares against).
    const old = new Date(Date.now() - 60 * 60_000)
    fs.utimesSync(oldOrphan, old, old)
    const c = makeCache()
    c.get('ha') // triggers ensureLoaded → the startup GC sweep
    expect(fs.existsSync(oldOrphan)).toBe(false)
    expect(fs.existsSync(freshOrphan)).toBe(true)
    expect(fs.existsSync(path.join(blobs, 'ha.svg'))).toBe(true)
  })
})

// Task 532 step 5c — rendered diagram sizes ride in the same index file under their own key.
// A size key is 16 hex chars (shared/diagram-size isDiagramSizeKey); the store rejects anything else.
const K = (c: string) => c.repeat(16)
describe('DiagramCache — diagram sizes (task 532 step 5c)', () => {
  it('stores a size and serves it back; an unknown key has none', () => {
    const c = makeCache()
    c.putSize(K('0'), [120, 80, 6])
    expect(c.getSize(K('0'))).toEqual([120, 80, 6])
    expect(c.getSize(K('f'))).toBeUndefined()
  })

  it('survives a restart (disk round trip) next to the SVG rows', () => {
    const a = makeCache()
    a.put('doc://a', 'd2#0', 'h1', svgOf('one'))
    a.putSize(K('0'), [120, 80, 6])
    a.flushNow()
    const b = makeCache()
    expect(b.getSize(K('0'))).toEqual([120, 80, 6])
    expect(b.get('h1')).toContain('data-t="one"')
  })

  it('a newer size for the same key replaces the old one', () => {
    const a = makeCache()
    a.putSize(K('0'), [120, 80, 6])
    a.putSize(K('0'), [130, 90, 6])
    a.flushNow()
    expect(makeCache().getSize(K('0'))).toEqual([130, 90, 6])
  })

  it('merges with another window sizes instead of overwriting them', () => {
    const a = makeCache()
    const b = makeCache()
    a.putSize(K('a'), [1, 2, 3])
    b.putSize(K('b'), [4, 5, 6])
    a.flushNow()
    b.flushNow()
    const c = makeCache()
    expect(c.getSize(K('a'))).toEqual([1, 2, 3])
    expect(c.getSize(K('b'))).toEqual([4, 5, 6])
  })

  it('an engine-version bump wipes the sizes with the SVGs, and a corrupt row is skipped', () => {
    const a = makeCache()
    a.putSize(K('0'), [120, 80, 6])
    a.flushNow()
    expect(makeCache({ version: 'v2' }).getSize(K('0'))).toBeUndefined()
    const again = makeCache()
    again.putSize(K('0'), [9, 9, 9])
    again.flushNow()
    const idx = path.join(dir, 'index.json')
    const body = JSON.parse(fs.readFileSync(idx, 'utf8'))
    fs.writeFileSync(
      idx,
      JSON.stringify({
        ...body,
        version: 'v1',
        sizes: {
          [K('0')]: [1, 2, 3],
          [K('1')]: 'x',
          [K('2')]: [-1, 2, 3],
          'not-a-key': [1, 2, 3],
        },
      }),
    )
    const c = makeCache()
    expect(c.getSize(K('0'))).toEqual([1, 2, 3])
    expect(c.getSize(K('1'))).toBeUndefined()
    expect(c.getSize(K('2'))).toBeUndefined()
    expect(c.getSize('not-a-key')).toBeUndefined()
    expect(c.getSize('not-a-key')).toBeUndefined()
  })

  it('an index written before sizes existed loads with none', () => {
    const a = makeCache()
    a.put('doc://a', 'd2#0', 'h1', svgOf('one'))
    a.flushNow()
    const idx = path.join(dir, 'index.json')
    const { sizes: _drop, ...legacy } = JSON.parse(fs.readFileSync(idx, 'utf8'))
    fs.writeFileSync(idx, JSON.stringify(legacy))
    const b = makeCache()
    expect(b.getSize(K('0'))).toBeUndefined()
    expect(b.get('h1')).toContain('data-t="one"')
  })
})
