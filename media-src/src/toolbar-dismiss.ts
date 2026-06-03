// Close open toolbar dropdowns (the "…" more menu, headings, emoji, theme pickers)
// when the user clicks outside them. Vditor only closes toolbar submenus on editor
// focus or when another trigger is clicked — there's no click-outside handler — so
// a click on empty space / the toolbar would leave the menu open.
//
// Companion to vscode-chrome.css (the VS Code-native menu *look*); this is the
// click-outside *behaviour*. Register once at startup; it reads the DOM live, so it
// keeps working across Vditor re-inits. Scoped to the toolbar so it never touches
// the IR table panel or the autocomplete hint (those live in the editor content
// and manage their own visibility).
export function setupToolbarDismiss(doc: Document = document): void {
  doc.addEventListener('mousedown', (event) => {
    const target = event.target as Node | null
    const openPanels = doc.querySelectorAll<HTMLElement>(
      '.vditor-toolbar .vditor-hint[style*="block"], .vditor-toolbar .vditor-panel[style*="block"]',
    )
    for (const panel of openPanels) {
      // a click on the trigger button or inside the menu is Vditor's to handle
      const owner = panel.closest('.vditor-toolbar__item')
      if (owner && target && owner.contains(target)) continue
      panel.style.display = 'none'
      for (const current of panel.querySelectorAll('.vditor-hint--current')) {
        current.classList.remove('vditor-hint--current')
      }
    }
  })
}
