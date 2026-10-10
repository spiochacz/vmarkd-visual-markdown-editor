// Task 83 (increment 4) — the toolbar toggle for `vmarkd.editor.reflowLineBreaks`.
//
// The button is a Vditor Custom item (toolbar.ts). It is "Keep line breaks": pressed == reflow OFF (source
// line breaks kept), unpressed (the default) == soft line breaks flow. Its pressed state is the INVERSE of the
// EFFECTIVE setting, shown the same way Vditor's own outline/preview toggles show active: the `vditor-menu--current` class (styled in
// vscode-chrome.css), plus aria-pressed for assistive tech. State is written onto every matching button
// in the document, so the instant-paint overlay's toolbar clone follows too.
//
// Click = optimistic local apply (instant, no wait for the host round-trip) + a host write of the
// persisted setting. The config-changed that follows re-applies the same value, which
// applyReflowLineBreaks reports as "unchanged" — so an open Preview re-renders exactly once.
import { innerVditor } from '../util/inner-vditor'
import {
  applyReflowLineBreaks,
  getReflowLineBreaks,
  onReflowLineBreaksChange,
  rerenderOpenPreview,
} from './reflow-line-breaks'

export const REFLOW_TOGGLE_NAME = 'reflow-line-breaks'

const CURRENT = 'vditor-menu--current'

/** Reflect `on` (= reflow on; default: the current effective value, on when never applied) onto every toggle
 *  button: pressed == NOT on (line breaks kept).
 *  Vditor builds its toolbar synchronously but attaches it to the document only later (initUI), so the
 *  live toolbar element is searched directly as well as the document (overlay clone, attached toolbar). */
export function syncReflowToggle(on = getReflowLineBreaks() !== false): void {
  const selector = `[data-type="${REFLOW_TOGGLE_NAME}"]`
  const live = innerVditor()?.toolbar?.element as HTMLElement | undefined
  const buttons = new Set<Element>([
    ...document.querySelectorAll(`.vditor-toolbar ${selector}`),
    ...(live?.querySelectorAll(selector) ?? []),
  ])
  for (const btn of buttons) {
    btn.classList.toggle(CURRENT, !on)
    btn.setAttribute('aria-pressed', String(!on))
  }
}

let unsubscribe: (() => void) | undefined

/** Keep the buttons in step with every effective change (VS Code Settings edits arrive through
 *  config-changed -> applyReflowLineBreaks). Idempotent across Vditor re-inits. */
export function installReflowToggleSync(): void {
  if (unsubscribe) return
  unsubscribe = onReflowLineBreaksChange((on) => syncReflowToggle(on))
}

/** Toolbar click: flip the setting locally, then ask the host to persist it. */
export function toggleReflowLineBreaks(): void {
  const next = getReflowLineBreaks() === false
  if (applyReflowLineBreaks(next)) rerenderOpenPreview()
  vscode.postMessage({ command: 'set-reflow-line-breaks', value: next })
}
