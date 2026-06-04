import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldOpenLink,
  setLinkOpenMode,
  getLinkOpenMode,
  applyLinkOpenSetting,
  installLinkOpenGate,
} from './link-open-policy'

describe('link-open-policy', () => {
  beforeEach(() => setLinkOpenMode('modifier')) // restore default between tests

  describe("'modifier' mode (default — plain click edits, Ctrl/Cmd opens)", () => {
    it('non-mac: opens only when Ctrl is held', () => {
      expect(shouldOpenLink({ ctrlKey: true, metaKey: false }, false)).toBe(true)
      expect(shouldOpenLink({ ctrlKey: false, metaKey: false }, false)).toBe(
        false,
      )
      expect(shouldOpenLink({ ctrlKey: false, metaKey: true }, false)).toBe(
        false,
      )
    })
    it('mac: opens only when Cmd/meta is held', () => {
      expect(shouldOpenLink({ ctrlKey: false, metaKey: true }, true)).toBe(true)
      expect(shouldOpenLink({ ctrlKey: true, metaKey: false }, true)).toBe(false)
    })
  })

  describe("'click' mode (plain click opens — legacy)", () => {
    it('opens on any click regardless of modifier', () => {
      setLinkOpenMode('click')
      expect(shouldOpenLink({ ctrlKey: false, metaKey: false }, false)).toBe(
        true,
      )
      expect(shouldOpenLink({ ctrlKey: true, metaKey: false }, false)).toBe(true)
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
