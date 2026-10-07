import { describe, it, expect } from 'vitest'
import { aboutVmarkdHtml, VMARKD_REPO, createToolbar } from './toolbar'
import { FORMAT_HOTKEYS } from '../../../src/shared/format-hotkeys'

type NamedToolbarItem = { name: string; hotkey?: string; toolbar?: unknown[] }

// A raw `createToolbar()` entry is either a bare string (Vditor default, no override) or an
// object — normalize to the object shape so a walker can read `.name`/`.toolbar` uniformly.
function normalizeItem(raw: unknown): NamedToolbarItem | undefined {
  if (typeof raw === 'string') return { name: raw }
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as { name?: unknown }).name === 'string'
  ) {
    return raw as NamedToolbarItem
  }
  return undefined
}

// Walks the FULL toolbar tree, including nested submenus (e.g. 'more's own `toolbar` array) —
// see the regression guard test below for why a top-level-only walk missed a real bug.
function collectByName(items: unknown[], out: Map<string, NamedToolbarItem>) {
  for (const raw of items) {
    const item = normalizeItem(raw)
    if (!item) continue
    out.set(item.name, item)
    if (Array.isArray(item.toolbar)) collectByName(item.toolbar, out)
  }
}

describe('aboutVmarkdHtml (About vMarkd dialog)', () => {
  it('shows the version line (Vditor + pinned Lute commit link + date) and repo link', () => {
    const html = aboutVmarkdHtml({
      vditorVersion: '3.11.3',
      luteCommit: '36ea9e0966025d7f4f343cdf9a611109bfb29ef6',
      luteCommittedAt: '2026-06-03',
    })
    expect(html).toContain(VMARKD_REPO)
    expect(html).toContain(
      'href="https://github.com/spiochacz/vmarkd-visual-markdown-editor"',
    )
    expect(html).toContain('Version: Vditor v3.11.3 / ')
    expect(html).toContain(
      'https://github.com/88250/lute/commit/36ea9e0966025d7f4f343cdf9a611109bfb29ef6',
    )
    expect(html).toContain('>36ea9e0</a> (2026-06-03)')
  })

  it('falls back to a plain "Lute" label when no commit is pinned', () => {
    const html = aboutVmarkdHtml({
      vditorVersion: '3.11.3',
      luteCommit: '',
      luteCommittedAt: '',
    })
    expect(html).toContain('Version: Vditor v3.11.3 / Lute</li>')
    expect(html).not.toContain('lute/commit/')
  })
})

// Task 505 — every promoted item (FORMAT_HOTKEYS) gets `hotkey: ''` (so Vditor's own bubble-phase
// handler never sees the key — see hotKey.ts's matchHotKey) and a tip rebuilt from the shared
// table via formatTip. Every deliberately-unpromoted item also gets `hotkey: ''` (Vditor must not
// own a key VS Code doesn't also formally own) but no NEW tip override.
describe('createToolbar — FORMAT_HOTKEYS wiring (one owner per key)', () => {
  function itemsByName() {
    return new Map(
      createToolbar()
        .filter((it: any) => it && typeof it === 'object' && it.name)
        .map((it: any) => [it.name, it]),
    )
  }

  it('disables Vditor\'s own hotkey (hotkey: "") for every FORMAT_HOTKEYS row', () => {
    const items = itemsByName()
    for (const row of FORMAT_HOTKEYS) {
      const item = items.get(row.toolbarName) as { hotkey?: string } | undefined
      expect(item, row.toolbarName).toBeDefined()
      expect(item?.hotkey, row.toolbarName).toBe('')
    }
  })

  it('builds each promoted tip from the shared table (label + formatted key), not a stale Vditor default', () => {
    const items = itemsByName()
    for (const row of FORMAT_HOTKEYS) {
      const item = items.get(row.toolbarName) as { tip?: string } | undefined
      expect(item?.tip, row.toolbarName).toContain(row.label)
      // The formatted win/linux key text (title-cased) must appear — proves the tip is derived
      // from THIS table's key field, not left over from Vditor's own ⌘/⇧ notation.
      const displayKey = row.key
        .split('+')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('+')
      expect(item?.tip, row.toolbarName).toContain(displayKey)
    }
  })

  it('disables hotkey on every deliberately-unpromoted item (link/table/line/insert-before/insert-after/emoji/undo/redo)', () => {
    const items = itemsByName()
    const noKeybind = [
      'link',
      'table',
      'line',
      'insert-before',
      'insert-after',
      'emoji',
      'undo',
      'redo',
    ]
    for (const name of noKeybind) {
      const item = items.get(name) as { hotkey?: string } | undefined
      expect(item, name).toBeDefined()
      expect(item?.hotkey, name).toBe('')
    }
  })

  it("does not invent a NEW tip for the no-keybinding items (falls back to Vditor's own label)", () => {
    const items = itemsByName()
    // link/table/insert-before/insert-after/emoji carry no tip override at all — the plain
    // `{ name, hotkey: '' }` shape from task 505 §5. undo/redo are NOT in this list — see the
    // next test: they have no VS Code keybinding either, but still advertise their (working, just
    // not command-bound) shortcut.
    for (const name of [
      'link',
      'table',
      'insert-before',
      'insert-after',
      'emoji',
    ]) {
      const item = items.get(name) as { tip?: string } | undefined
      expect(item?.tip, name).toBeUndefined()
    }
  })

  it("keeps a shortcut hint on undo/redo despite no VS Code keybinding — it's still a working key (undo-keybind.ts), just not command-bound, so dropping the hint like the no-keybinding items above would be a discoverability regression", () => {
    const items = itemsByName()
    expect((items.get('undo') as { tip?: string }).tip).toContain('Ctrl+Z')
    expect((items.get('line') as { tip?: string }).tip).toBe('Horizontal Rule')
    expect((items.get('redo') as { tip?: string }).tip).toContain(
      'Shift+Ctrl/Cmd+Z',
    )
  })

  it("promotes headings (task 505 — reclassified from 492's dropped set)", () => {
    const items = itemsByName()
    const headings = items.get('headings') as
      | { hotkey?: string; tip?: string }
      | undefined
    expect(headings?.hotkey).toBe('')
    expect(headings?.tip).toContain('Headings')
  })

  // Regression guard: `itemsByName()` above only walks TOP-LEVEL items — it never caught 'both'
  // (nested inside the 'more' submenu's own `toolbar` array) still carrying Vditor's native `⌘P`
  // hotkey, live and un-neutralised, shadowing VS Code's Ctrl+P (Quick Open) and rendering its
  // tooltip in Vditor's `<...>` bracket style instead of `formatTip`'s `(...)` style — found by
  // the user spotting the bracket-style mismatch in the real editor, not by any test. Every name
  // Vditor's own `Options.ts` assigns a default hotkey to (`media-src/node_modules/vditor/src/ts/
  // util/Options.ts`) must be neutralised (`hotkey: ''`) WHEREVER it appears in the toolbar tree,
  // nested or not — this walks the whole tree instead of trusting a fixed nesting depth.
  it('neutralises every Vditor-native hotkeyed item at ANY nesting depth, not just the top level', () => {
    // Names Options.ts gives a non-empty `hotkey` to, minus 'fullscreen' (not present in this
    // toolbar at all — createToorbar() never lists it, so there's nothing to neutralise).
    const VDITOR_NATIVE_HOTKEY_NAMES = [
      'emoji',
      'headings',
      'bold',
      'italic',
      'strike',
      'link',
      'list',
      'ordered-list',
      'check',
      'outdent',
      'indent',
      'quote',
      'line',
      'code',
      'inline-code',
      'insert-before',
      'insert-after',
      'table',
      'undo',
      'redo',
      'both',
    ]

    const all = new Map<string, { name: string; hotkey?: string }>()
    collectByName(createToolbar() as unknown[], all)

    for (const name of VDITOR_NATIVE_HOTKEY_NAMES) {
      const item = all.get(name)
      expect(
        item,
        `"${name}" should exist somewhere in the toolbar tree`,
      ).toBeDefined()
      expect(item?.hotkey, name).toBe('')
    }
  })
})
