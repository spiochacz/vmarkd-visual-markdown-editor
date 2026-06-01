import { describe, it, expect, beforeEach } from 'vitest'
import { activate } from '../../src/extension'
import { mock, Uri, TabInputCustom, TabInputText } from './vscode-mock'

const VIEW_TYPE = 'markdown-editor.editor'

// statusBarItems are created in order: [reading (prio 100), mode (prio 99)]
function bar() {
  const [reading, modeItem] = mock.calls.statusBarItems
  return { reading, modeItem }
}

describe('status bar — reading time + mode (task 35)', () => {
  beforeEach(() => mock.reset())

  it('creates two items and registers them for disposal', () => {
    const context = mock.createExtensionContext()
    activate(context as any)
    expect(mock.calls.statusBarItems).toHaveLength(2)
    mock.calls.statusBarItems.forEach((i) => {
      expect(context.subscriptions).toContain(i)
    })
  })

  it('shows reading time + WYSIWYG for an active custom-editor markdown tab', () => {
    const text = Array(250).fill('word').join(' ') // ceil(250/200) = 2 min
    mock.createTextDocument('/workspace/note.md', text)
    mock.setActiveTab(
      new TabInputCustom(Uri.file('/workspace/note.md'), VIEW_TYPE),
    )
    activate(mock.createExtensionContext() as any)

    const { reading, modeItem } = bar()
    expect(reading.visible).toBe(true)
    expect(reading.text).toContain('~2 min read')
    expect(modeItem.visible).toBe(true)
    expect(modeItem.text).toContain('WYSIWYG')
    expect(modeItem.command).toBe('markdown-editor.openTextEditor') // click → source
  })

  it('shows Source + open-editor toggle when the file is in the text editor', () => {
    mock.createTextDocument('/workspace/note.md', 'one two three')
    mock.setActiveTab(new TabInputText(Uri.file('/workspace/note.md')))
    activate(mock.createExtensionContext() as any)

    const { reading, modeItem } = bar()
    expect(reading.visible).toBe(true)
    expect(reading.text).toContain('~1 min read')
    expect(modeItem.text).toContain('Source')
    expect(modeItem.command).toBe('markdown-editor.openEditor') // click → visual
  })

  it('hides both items on a non-markdown tab', () => {
    mock.setActiveTab(new TabInputText(Uri.file('/workspace/notes.txt')))
    activate(mock.createExtensionContext() as any)
    const { reading, modeItem } = bar()
    expect(reading.visible).toBe(false)
    expect(modeItem.visible).toBe(false)
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
