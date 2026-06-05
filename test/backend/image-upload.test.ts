import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditorProvider } from '../../src/extension'
import { mock, workspace } from './vscode-mock'

// The webview posts a `{ command: 'upload', files: [{ name, base64 }] }` message
// (Vditor's upload hook → main.ts). The host `onUpload` handler decodes each
// file, writes it into the resolved assets folder, and replies with a
// `{ command: 'uploaded', files: [<doc-relative path>] }` so the editor can
// rewrite the image link. These tests drive that handler through the mock panel.

function resolveProvider(fsPath = '/workspace/note.md', text = '# Hi\n') {
  mock.setWorkspaceFolder('/workspace')
  const context = mock.createExtensionContext()
  const document = mock.createTextDocument(fsPath, text)
  const panel = mock.createWebviewPanel()
  const provider = new MarkdownEditorProvider(context as any)
  provider.resolveCustomTextEditor(document as any, panel as any)
  return { context, document, panel, provider }
}

function uploadedReplies() {
  return mock.calls.postMessage.filter((m: any) => m.command === 'uploaded')
}

function writtenPaths() {
  return mock.calls.fsWrites.map((w) => w.uri.fsPath)
}

const b64 = (s: string) => Buffer.from(s).toString('base64')

describe('image upload (onUpload)', () => {
  beforeEach(() => mock.reset())

  it('writes a decoded image into the default assets folder and replies with its relative path', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'pic.png', base64: b64('PNG-BYTES') }],
    })

    // created the assets dir next to the document
    expect(mock.calls.fsDirsCreated.map((u) => u.fsPath)).toContain(
      '/workspace/assets',
    )
    // wrote the *decoded* bytes to assets/pic.png
    const write = mock.calls.fsWrites.find(
      (w) => w.uri.fsPath === '/workspace/assets/pic.png',
    )
    expect(write).toBeDefined()
    expect(Buffer.from(write!.content).toString()).toBe('PNG-BYTES')
    // replied with the document-relative link
    expect(uploadedReplies().at(-1)?.files).toEqual(['assets/pic.png'])
  })

  it('writes every file of a multi-file upload and replies with all paths', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    await panel._receiveMessage({
      command: 'upload',
      files: [
        { name: 'a.png', base64: b64('A') },
        { name: 'b.jpg', base64: b64('B') },
      ],
    })
    expect(writtenPaths().sort()).toEqual([
      '/workspace/assets/a.png',
      '/workspace/assets/b.jpg',
    ])
    expect(uploadedReplies().at(-1)?.files).toEqual([
      'assets/a.png',
      'assets/b.jpg',
    ])
  })

  it('honours a custom image.saveFolder setting', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    mock.setConfig({ 'image.saveFolder': 'media/img' })
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'pic.png', base64: b64('X') }],
    })
    expect(writtenPaths().at(-1)).toBe('/workspace/media/img/pic.png')
    expect(uploadedReplies().at(-1)?.files).toEqual(['media/img/pic.png'])
  })

  it('expands the ${fileBasenameNoExtension} placeholder in the save folder', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    mock.setConfig({ 'image.saveFolder': 'assets/${fileBasenameNoExtension}' })
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'pic.png', base64: b64('X') }],
    })
    expect(writtenPaths().at(-1)).toBe('/workspace/assets/note/pic.png')
    expect(uploadedReplies().at(-1)?.files).toEqual(['assets/note/pic.png'])
  })

  it('resolves the assets folder relative to the document dir, not the workspace root', async () => {
    const { panel } = resolveProvider('/workspace/docs/guide.md')
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'pic.png', base64: b64('X') }],
    })
    // assets sit next to the doc, and the link stays relative to the doc
    expect(writtenPaths().at(-1)).toBe('/workspace/docs/assets/pic.png')
    expect(uploadedReplies().at(-1)?.files).toEqual(['assets/pic.png'])
  })

  it('refuses to upload in an untrusted workspace — no writes, warns the user', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    mock.setTrusted(false)
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'pic.png', base64: b64('X') }],
    })
    expect(mock.calls.fsWrites).toHaveLength(0)
    expect(uploadedReplies()).toHaveLength(0)
    expect(mock.calls.showWarning.map((w) => w.message).join(' ')).toContain(
      'Trust this workspace',
    )
  })

  it('round-trips a converted .webp name verbatim (task 74 contract)', async () => {
    // The webview converts to WebP and sends the .webp name; the host is
    // format-agnostic — it writes that name and echoes it back for the link.
    const { panel } = resolveProvider('/workspace/note.md')
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'shot.webp', base64: b64('WEBP') }],
    })
    expect(writtenPaths().at(-1)).toBe('/workspace/assets/shot.webp')
    expect(uploadedReplies().at(-1)?.files).toEqual(['assets/shot.webp'])
  })

  it('reports an error and writes nothing when the assets folder cannot be created', async () => {
    const { panel } = resolveProvider('/workspace/note.md')
    vi.mocked(workspace.fs.createDirectory).mockRejectedValueOnce(
      new Error('EACCES'),
    )
    await panel._receiveMessage({
      command: 'upload',
      files: [{ name: 'pic.png', base64: b64('X') }],
    })
    expect(mock.calls.fsWrites).toHaveLength(0)
    expect(uploadedReplies()).toHaveLength(0)
    expect(mock.calls.showError.join(' ')).toContain('Invalid image folder')
  })
})
