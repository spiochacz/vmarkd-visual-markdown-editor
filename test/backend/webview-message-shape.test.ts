import { describe, expect, it } from 'vitest'
import { firstWebviewMessageShapeViolation } from '../../src/webview-host/webview-message-shape'

// Task 148 item 3 (payload-shape validation, host side — HALF of the fix, the other half is
// wiring this into extension.ts's onDidReceiveMessage once that file is clear to edit). Mirrors
// media-src/src/message-router.ts's own `firstShapeViolation` for the OPPOSITE direction: a
// malformed/drifted webview→host message currently reaches its handler as-is, and TypeScript's
// WebviewMessage union only checks internal callers, not what actually arrives on the wire.
//
// The field table is DELIBERATELY not "every non-optional protocol.ts field" — it lists only
// fields the actual extension.ts handler (or the module it delegates to, e.g.
// asset-link-actions.ts) reads UNCONDITIONALLY, with no coercion/fallback that already makes a
// missing/malformed value harmless (Number()/Boolean()/`?? ''`/`?.`). Verified against the real
// handler bodies, not guessed from the type alone — see the module's own header comment for the
// per-command reasoning.
describe('firstWebviewMessageShapeViolation', () => {
  it('flags a missing required field', () => {
    // onEdit reads message.content unconditionally (writeback.syncToEditor(message.content, …)).
    expect(firstWebviewMessageShapeViolation({}, 'edit')).toBe('content')
  })

  it('flags a required field with the wrong type', () => {
    // onUpload does message.files.map(...) — a non-array throws a TypeError inside the handler.
    expect(
      firstWebviewMessageShapeViolation({ files: 'not-an-array' }, 'upload'),
    ).toBe('files')
  })

  it('passes a message with every required field present and correctly typed', () => {
    expect(
      firstWebviewMessageShapeViolation({ content: 'hello' }, 'edit'),
    ).toBeNull()
    expect(
      firstWebviewMessageShapeViolation({ files: ['a.png'] }, 'upload'),
    ).toBeNull()
  })

  it('requires a boolean `value` for set-reflow-line-breaks (task 83)', () => {
    expect(
      firstWebviewMessageShapeViolation({}, 'set-reflow-line-breaks'),
    ).toBe('value')
    expect(
      firstWebviewMessageShapeViolation(
        { value: 'false' },
        'set-reflow-line-breaks',
      ),
    ).toBe('value')
    expect(
      firstWebviewMessageShapeViolation(
        { value: false },
        'set-reflow-line-breaks',
      ),
    ).toBeNull()
  })

  it('never flags a command with no required fields, however the message is shaped', () => {
    // docMode coerces every field (Number()/Boolean()) in the real handler — nothing can crash,
    // so nothing is required here even though the protocol type marks them all non-optional.
    expect(firstWebviewMessageShapeViolation({}, 'docMode')).toBeNull()
    expect(
      firstWebviewMessageShapeViolation(
        { blocks: 'nonsense', chars: null },
        'docMode',
      ),
    ).toBeNull()
    // ready/edit-in-vscode/navigate-back/open-settings/list-wiki-pages/cursor-offset carry no
    // payload at all.
    expect(firstWebviewMessageShapeViolation({}, 'ready')).toBeNull()
  })

  it('does not flag fields the handler already defends with a fallback (log, copy-html, save-options)', () => {
    // log: appendRawLine(String(message?.text ?? '')) — already tolerant of a missing/wrong `text`.
    expect(firstWebviewMessageShapeViolation({}, 'log')).toBeNull()
    // copy-html/copy-markdown: String(message.content ?? '') — same reasoning.
    expect(firstWebviewMessageShapeViolation({}, 'copy-html')).toBeNull()
    expect(firstWebviewMessageShapeViolation({}, 'copy-markdown')).toBeNull()
    // save-options: sanitizeVditorOptions(message.options) is BUILT to tolerate any shape.
    expect(firstWebviewMessageShapeViolation({}, 'save-options')).toBeNull()
  })

  it('returns null for an unknown/unlisted command (dispatcher already handles "no handler")', () => {
    expect(firstWebviewMessageShapeViolation({}, 'not-a-real-command')).toBe(
      null,
    )
  })

  it('checks every required field of a multi-field command (diagram-cache-get, diagram-render-cached)', () => {
    // diagram-cache-get: `for (const hash of message.hashes)` throws if hashes isn't iterable;
    // requestId is echoed back verbatim in the reply.
    expect(
      firstWebviewMessageShapeViolation(
        { requestId: 'r1' },
        'diagram-cache-get',
      ),
    ).toBe('hashes')
    expect(
      firstWebviewMessageShapeViolation(
        { requestId: 'r1', hashes: ['h1'] },
        'diagram-cache-get',
      ),
    ).toBeNull()
    // diagram-render-cached: diagramCache.put(uri, message.diagramId, message.hash, message.svg).
    expect(
      firstWebviewMessageShapeViolation(
        { diagramId: 'd1', hash: 'h1' },
        'diagram-render-cached',
      ),
    ).toBe('svg')
  })
})
