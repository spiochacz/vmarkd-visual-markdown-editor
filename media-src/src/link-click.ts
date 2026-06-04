// IR link-click routing (task 62 — deliberate UX change, not a dead-click fix).
//
// Today an IR link click opens the URL (Vditor calls `window.open(markerText)`,
// which our fixLinkClick override in utils.ts routes to the host → OS browser). We
// change IR to a Typora-style split: a plain click places the caret in the link for
// editing; only Ctrl/Cmd+click follows the link. The modifier gate lives in the
// Vditor IR source patch (esbuild-shared.mjs `fixIrLinkClick`) because Vditor's
// `link.click` callback is handed only the marker element — not the event — so the
// modifier can't be read here. By the time Vditor invokes `link.click`, the patch
// has already established the modifier was held, so this just opens.
export interface OpenLinkMessage {
  command: 'open-link'
  href: string
}

// Open the URL carried by an IR link marker via the host. The marker element's
// textContent is the URL. Returns whether it posted (false for an empty href).
export function openLinkFromMarker(
  markerEl: { textContent: string | null } | null,
  post: (msg: OpenLinkMessage) => void,
): boolean {
  const href = (markerEl?.textContent ?? '').trim()
  if (!href) return false
  post({ command: 'open-link', href })
  return true
}
