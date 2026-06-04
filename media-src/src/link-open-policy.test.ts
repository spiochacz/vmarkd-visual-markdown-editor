// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldOpenLink,
  setLinkOpenMode,
  getLinkOpenMode,
  applyLinkOpenSetting,
  installLinkOpenGate,
  isEditorContentLink,
} from './link-open-policy'

describe('link-open-policy', () => {
  beforeEach(() => setLinkOpenMode('modifier')) // restore default between tests

  describe("'modifier' mode (default — plain click edits, Ctrl/Cmd opens)", () => {
    it('non-mac: opens only when Ctrl is held', () => {
      expect(shouldOpenLink({ ctrlKey: true, metaKey: false }, false)).toBe(
        true,
      )
      expect(shouldOpenLink({ ctrlKey: false, metaKey: false }, false)).toBe(
        false,
      )
      expect(shouldOpenLink({ ctrlKey: false, metaKey: true }, false)).toBe(
        false,
      )
    })
    it('mac: opens only when Cmd/meta is held', () => {
      expect(shouldOpenLink({ ctrlKey: false, metaKey: true }, true)).toBe(true)
      expect(shouldOpenLink({ ctrlKey: true, metaKey: false }, true)).toBe(
        false,
      )
    })
  })

  describe("'click' mode (plain click opens — legacy)", () => {
    it('opens on any click regardless of modifier', () => {
      setLinkOpenMode('click')
      expect(shouldOpenLink({ ctrlKey: false, metaKey: false }, false)).toBe(
        true,
      )
      expect(shouldOpenLink({ ctrlKey: true, metaKey: false }, false)).toBe(
        true,
      )
    })
  })

  describe('applyLinkOpenSetting maps the host boolean', () => {
    it('true / undefined → modifier mode (Ctrl to open is the default)', () => {
      applyLinkOpenSetting(true)
      expect(getLinkOpenMode()).toBe('modifier')
      applyLinkOpenSetting(undefined)
      expect(getLinkOpenMode()).toBe('modifier')
    })
    it('false → click mode (plain click opens)', () => {
      applyLinkOpenSetting(false)
      expect(getLinkOpenMode()).toBe('click')
    })
  })

  describe('isEditorContentLink scopes the policy to editor content only', () => {
    const linkIn = (wrapperClass: string) => {
      const wrap = document.createElement('div')
      wrap.className = wrapperClass
      const a = document.createElement('a')
      a.href = 'https://example.com'
      wrap.appendChild(a)
      document.body.appendChild(wrap)
      return a
    }

    it('true for a link inside the document content (ir/wysiwyg/sv/preview)', () => {
      expect(isEditorContentLink(linkIn('vditor-ir'))).toBe(true)
      expect(isEditorContentLink(linkIn('vditor-wysiwyg'))).toBe(true)
      expect(isEditorContentLink(linkIn('vditor-sv'))).toBe(true)
      expect(isEditorContentLink(linkIn('vditor-preview'))).toBe(true)
    })

    it('false for chrome: dialogs/tips, toolbar, or bare body', () => {
      expect(isEditorContentLink(linkIn('vditor-tip'))).toBe(false)
      expect(isEditorContentLink(linkIn('vditor-toolbar'))).toBe(false)
      const bare = document.createElement('a')
      document.body.appendChild(bare)
      expect(isEditorContentLink(bare)).toBe(false)
      expect(isEditorContentLink(null)).toBe(false)
    })
  })

  describe('installLinkOpenGate exposes the global the Vditor patches call', () => {
    it('installs window.__vmarkdShouldOpenLink reflecting the current mode', () => {
      const win: any = { navigator: { platform: 'Linux x86_64' } }
      installLinkOpenGate(win)
      setLinkOpenMode('modifier')
      expect(win.__vmarkdShouldOpenLink({ ctrlKey: false })).toBe(false)
      expect(win.__vmarkdShouldOpenLink({ ctrlKey: true })).toBe(true)
      setLinkOpenMode('click')
      expect(win.__vmarkdShouldOpenLink({ ctrlKey: false })).toBe(true)
    })
  })
})
