// Link-open policy (task 62, configurable).
//
// Whether clicking a link follows it (opens in the OS browser via the host) or
// leaves the caret for editing is a user setting. Two modes:
//   'modifier' (default) — plain click edits; Ctrl (Win/Linux) / Cmd (mac) opens.
//   'click'              — plain click opens (the app's legacy behaviour).
//
// The decision point lives here so all three consumers agree: the IR and WYSIWYG
// Vditor source patches (which call the installed global `__vmarkdShouldOpenLink`)
// and our document-level `fixLinkClick` (real <a href> in WYSIWYG/SV/preview).
import { isMac } from './platform'

export type LinkOpenMode = 'modifier' | 'click'

let mode: LinkOpenMode = 'modifier'

export function setLinkOpenMode(m: LinkOpenMode): void {
  mode = m
}
export function getLinkOpenMode(): LinkOpenMode {
  return mode
}

// Map the host's boolean setting (`linkOpenWithModifier`, default true) to a mode.
export function applyLinkOpenSetting(
  openWithModifier: boolean | undefined,
): void {
  mode = openWithModifier === false ? 'click' : 'modifier'
}

// The modifier policy applies ONLY to links in the editor's document content
// (where a plain click means "place the caret to edit"). Links in chrome — the
// About/Info dialog and other tips, the toolbar, panels, popovers — are not
// editable text, so they open on a plain click regardless of the policy.
const EDITOR_CONTENT_SELECTOR =
  '.vditor-ir, .vditor-wysiwyg, .vditor-sv, .vditor-preview'
export function isEditorContentLink(el: Element | null): boolean {
  return !!el?.closest(EDITOR_CONTENT_SELECTOR)
}

// Should this pointer event follow the link? In 'click' mode always; in 'modifier'
// mode only when the platform modifier is held.
export function shouldOpenLink(
  event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'> | undefined,
  mac: boolean = isMac(),
): boolean {
  if (mode === 'click') return true
  return mac ? !!event?.metaKey : !!event?.ctrlKey
}

// Install the global the (build-time) Vditor source patches reference. The mac
// check is bound once from this window's navigator; the mode is read live so a
// config change takes effect without re-installing.
export function installLinkOpenGate(
  win: Window & typeof globalThis = window,
): void {
  const mac = isMac(win.navigator)
  ;(win as any).__vmarkdShouldOpenLink = (
    event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>,
  ) => shouldOpenLink(event, mac)
}
