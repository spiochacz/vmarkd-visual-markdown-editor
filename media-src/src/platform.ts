// Tiny, side-effect-free platform check shared across the webview (toolbar hints,
// table hotkeys, undo keybinding). `navigator.platform` is deprecated but still the
// most reliable Mac signal inside the VS Code webview. The optional `nav` argument
// keeps it injectable for unit tests.
export function isMac(nav: Pick<Navigator, 'platform'> = navigator): boolean {
  return nav.platform.toLowerCase().includes('mac')
}
