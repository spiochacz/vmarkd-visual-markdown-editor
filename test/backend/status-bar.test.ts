import { describe, it, expect, beforeEach } from 'vitest'
import { activate, docLargeMode } from '../../src/extension'
import { mock, Uri, TabInputCustom, TabInputText } from './vscode-mock'

const VIEW_TYPE = 'vmarkd.editor'

// statusBarItems are created in order: [reading, mode, docSize]. docSize (task 69) is
// Right-aligned at prio 101 so it renders to the LEFT of the reading-time/word counter.
function bar() {
  const [reading, modeItem, docSize] = mock.calls.statusBarItems
  return { reading, modeItem, docSize }
}

describe('status bar — reading time + mode (task 35) + doc-size marker (task 69)', () => {
  beforeEach(() => {
    mock.reset()
    docLargeMode.clear()
  })

  it('creates three items and registers them for disposal', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    expect(mock.calls.statusBarItems).toHaveLength(3)
    mock.calls.statusBarItems.forEach((i) => {
      expect(context.subscriptions).toContain(i)
    })
  })

  it('shows reading time + WYSIWYG, and hides the large-doc marker for a normal doc', () => {
    const text = Array(250).fill('word').join(' ') // ceil(250/200) = 2 min
    mock.createTextDocument('/workspace/note.md', text)
    mock.setActiveTab(
      new TabInputCustom(Uri.file('/workspace/note.md'), VIEW_TYPE),
    )
    activate(mock.createExtensionContext() as any)

    const { reading, modeItem, docSize } = bar()
    expect(reading.visible).toBe(true)
    expect(reading.text).toContain('~2 min read')
    expect(modeItem.visible).toBe(true)
    expect(modeItem.text).toContain('WYSIWYG')
    expect(modeItem.command).toBe('vmarkd.openTextEditor') // click → source
    // No large-doc report → the marker stays hidden (it only appears for large docs).
    expect(docSize.visible).toBe(false)
  })

  it('shows the "Large md" marker and lists every active helper in the tooltip', () => {
    mock.createTextDocument('/workspace/big.md', 'word word word')
    docLargeMode.set(Uri.file('/workspace/big.md').toString(), {
      blocks: 1234,
      chars: 350_000,
      contentVisibility: true,
      streaming: false,
      incremental: true,
    })
    mock.setActiveTab(
      new TabInputCustom(Uri.file('/workspace/big.md'), VIEW_TYPE),
    )
    activate(mock.createExtensionContext() as any)

    const { docSize } = bar()
    expect(docSize.visible).toBe(true)
    expect(docSize.text).toContain('Large md')
    const tip = (docSize.tooltip as { value: string }).value
    expect(tip).toContain('content-visibility')
    expect(tip).toContain('incremental serialization')
    expect(tip).toContain('1234')
    // streaming was NOT active for this doc → not listed
    expect(tip).not.toContain('chunked streaming')
  })

  it('shows the marker when ONLY content-visibility is active (sub-block-gate doc)', () => {
    mock.createTextDocument('/workspace/mid.md', 'word word word')
    docLargeMode.set(Uri.file('/workspace/mid.md').toString(), {
      blocks: 120,
      chars: 150_000,
      contentVisibility: true,
      streaming: false,
      incremental: false,
    })
    mock.setActiveTab(
      new TabInputCustom(Uri.file('/workspace/mid.md'), VIEW_TYPE),
    )
    activate(mock.createExtensionContext() as any)

    const { docSize } = bar()
    expect(docSize.visible).toBe(true)
    const tip = (docSize.tooltip as { value: string }).value
    expect(tip).toContain('content-visibility')
    expect(tip).not.toContain('incremental serialization')
  })

  it('hides the marker when no helper is active', () => {
    mock.createTextDocument('/workspace/small.md', 'word word word')
    docLargeMode.set(Uri.file('/workspace/small.md').toString(), {
      blocks: 10,
      chars: 1000,
      contentVisibility: false,
      streaming: false,
      incremental: false,
    })
    mock.setActiveTab(
      new TabInputCustom(Uri.file('/workspace/small.md'), VIEW_TYPE),
    )
    activate(mock.createExtensionContext() as any)

    expect(bar().docSize.visible).toBe(false)
  })

  it('shows Source + open-editor toggle, and hides the doc-size marker, in the text editor', () => {
    mock.createTextDocument('/workspace/note.md', 'one two three')
    mock.setActiveTab(new TabInputText(Uri.file('/workspace/note.md')))
    activate(mock.createExtensionContext() as any)

    const { reading, modeItem, docSize } = bar()
    expect(reading.visible).toBe(true)
    expect(reading.text).toContain('~1 min read')
    expect(modeItem.text).toContain('Source')
    expect(modeItem.command).toBe('vmarkd.openEditor') // click → visual
    expect(docSize.visible).toBe(false) // no webview in source view → marker hidden
  })

  it('hides all items on a non-markdown tab', () => {
    mock.setActiveTab(new TabInputText(Uri.file('/workspace/notes.txt')))
    activate(mock.createExtensionContext() as any)
    const { reading, modeItem, docSize } = bar()
    expect(reading.visible).toBe(false)
    expect(modeItem.visible).toBe(false)
    expect(docSize.visible).toBe(false)
  })

  it('updates live when the active tab changes', () => {
    mock.createTextDocument('/workspace/note.md', 'a b c')
    activate(mock.createExtensionContext() as any)
    const { reading } = bar()
    expect(reading.visible).toBe(false) // no markdown tab active yet

    mock.setActiveTab(
      new TabInputCustom(Uri.file('/workspace/note.md'), VIEW_TYPE),
    )
    mock.fireDidChangeTabs()
    expect(reading.visible).toBe(true)
    expect(reading.text).toContain('~1 min read')
  })
})
