import { debounce } from './debounce'
import { shouldOpenLink, isEditorContentLink } from './link-open-policy'
// Type the global from the package's published types (dist). The source entry
// (`vditor/src/index`) can't be used as a type root — it pulls Vditor's whole source,
// which depends on ambient globals not loaded here. main.ts constructs from source and
// casts the assignment to bridge the two identities.
import type Vditor from 'vditor'
window.vscode = (window as any).acquireVsCodeApi?.()
;(window as any).global = window

let responsiveTableCleanup: (() => void) | null = null

declare global {
  export const vditor: Vditor
  export const vscode: any
  interface Window {
    vditor: Vditor
    vscode: any
    global: Window
  }
}

export function confirm(msg: string, onOk: () => void | Promise<void>) {
  const dialog = document.createElement('dialog')
  dialog.className = 'me-confirm'
  // <form method="dialog"> closes the dialog on button click and sets
  // returnValue to the clicked button's value — no per-button listeners needed
  dialog.innerHTML = `
    <form method="dialog" class="me-confirm__body">
      <div class="me-confirm__content"></div>
      <menu class="me-confirm__buttons">
        <button value="cancel" class="me-confirm__btn">Cancel</button>
        <button value="confirm" class="me-confirm__btn me-confirm__btn--primary">Confirm</button>
      </menu>
    </form>
  `
  // textContent (not innerHTML) keeps translated messages safe from injection
  dialog.querySelector('.me-confirm__content')!.textContent = msg
  document.body.appendChild(dialog)
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue === 'confirm') {
      await onOk()
    }
    dialog.remove()
  })
  dialog.showModal()
}
// panel hover 加定时延迟
export function fixPanelHover() {
  // Only the IR table panel uses the collapse-to-"..." + delayed-collapse
  // behaviour; toolbar dropdown panels (emoji, "more", …) must not be touched.
  document
    .querySelectorAll<HTMLElement>('#fix-table-ir-wrapper .vditor-panel')
    .forEach((el) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      el.addEventListener('mouseenter', () => {
        timer && clearTimeout(timer)
        el.classList.add('vditor-panel_hover')
      })
      el.addEventListener('mouseleave', () => {
        timer = setTimeout(() => {
          el.classList.remove('vditor-panel_hover')
        }, 2000)
      })
    })
}
// 文件转base64用于传输
export const fileToBase64 = async (file) => {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = (evt) => {
      res(evt.target.result.toString().split(',')[1])
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
// 保存 vditor 配置到 vscode 同步存储
export function saveVditorOptions() {
  const vditorOptions = {
    theme: vditor.vditor.options.theme,
    mode: vditor.vditor.currentMode,
    preview: vditor.vditor.options.preview,
  }
  vscode.postMessage({
    command: 'save-options',
    options: vditorOptions,
  })
}
// toolbar 点击时保存配置
export function handleToolbarClick() {
  document.querySelectorAll('.vditor-toolbar').forEach((toolbar) => {
    toolbar.addEventListener('click', (e) => {
      if (
        (e.target as HTMLElement).closest(
          '.vditor-panel--left button, .vditor-panel--arrow button, .vditor-panel button',
        )
      ) {
        setTimeout(() => {
          saveVditorOptions()
        }, 500)
      }
    })
  })
  // The edit-mode dropdown (wysiwyg/ir/sv) is special: Vditor's own button
  // handlers call event.stopPropagation(), so a mode switch never reaches the
  // bubble-phase toolbar listener above — and the chosen mode was never persisted
  // (the editor kept reopening in whatever mode happened to get saved by some
  // OTHER panel click). Catch the mode button in the CAPTURE phase instead, which
  // runs before Vditor's stopPropagation, then save once setEditMode has applied.
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('.vditor-toolbar [data-mode]')) {
        setTimeout(() => {
          saveVditorOptions()
        }, 500)
      }
    },
    true,
  )
}

function normalizeResponsiveTables(root: ParentNode = document) {
  root
    .querySelectorAll<HTMLTableElement>('.vditor-reset table')
    .forEach((table) => {
      table.removeAttribute('width')
      table.style.setProperty('display', 'table', 'important')
      table.style.setProperty('table-layout', 'fixed', 'important')
      table.style.setProperty('width', '100%', 'important')
      table.style.setProperty('max-width', '100%', 'important')
      table.style.setProperty('min-width', '0', 'important')
      table.style.setProperty('box-sizing', 'border-box')
    })

  root
    .querySelectorAll<HTMLElement>(
      '.vditor-reset table colgroup col, .vditor-reset table th, .vditor-reset table td',
    )
    .forEach((element) => {
      element.removeAttribute('width')
      element.style.removeProperty('width')
      element.style.removeProperty('min-width')
      element.style.removeProperty('max-width')
      element.style.removeProperty('white-space')
    })
}

export function fixResponsiveTables() {
  responsiveTableCleanup?.()

  const root = document.querySelector('.vditor') ?? document.body
  const syncTables = debounce(() => {
    normalizeResponsiveTables(root)
  }, 16)

  syncTables()

  const onResize = () => {
    syncTables()
  }

  window.addEventListener('resize', onResize)

  const mutationObserver = new MutationObserver(() => {
    syncTables()
  })
  mutationObserver.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'width'],
  })

  let resizeObserver: ResizeObserver | undefined
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      syncTables()
    })
    resizeObserver.observe(root)
  }

  responsiveTableCleanup = () => {
    window.removeEventListener('resize', onResize)
    mutationObserver.disconnect()
    resizeObserver?.disconnect()
    syncTables.cancel()
  }
}

function collapseExpandedWikiChips() {
  for (const el of document.querySelectorAll('.wiki-link-chip--expanded')) {
    el.classList.remove('wiki-link-chip--expanded')
  }
}

export function fixLinkClick() {
  const openLink = (url: string) => {
    vscode.postMessage({ command: 'open-link', href: url })
  }
  const openWikiLink = (target: string) => {
    vscode.postMessage({ command: 'open-wikilink', target })
  }
  const activateWikiLink = (element: HTMLElement | null) => {
    if (!element?.dataset.wikiTarget) {
      return false
    }
    openWikiLink(element.dataset.wikiTarget)
    return true
  }
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null
    const wikiElement = target?.closest<HTMLElement>('[data-wiki-link="1"]')
    if (wikiElement) {
      // In editable areas (IR/wysiwyg contenteditable) the modifier policy
      // applies: plain click = edit (place caret), Ctrl/Cmd+click = navigate.
      // In read-only areas (preview, chrome) plain click navigates directly.
      const inEditable = !!wikiElement.closest('[contenteditable]')
      if (!inEditable || shouldOpenLink(e)) {
        e.preventDefault()
        e.stopPropagation()
        activateWikiLink(wikiElement)
      }
      // In editable mode with plain click: show [[…]] markers around the
      // chip (expand), but don't allow text editing. Click elsewhere collapses.
      if (inEditable) {
        e.preventDefault()
        e.stopPropagation()
        collapseExpandedWikiChips()
        wikiElement.classList.add('wiki-link-chip--expanded')
      }
      return
    }

    collapseExpandedWikiChips()

    // Real <a href>. Always cancel the browser's own navigation (a webview anchor
    // must never navigate the panel), then route to the host. The modifier policy
    // (task 62) applies ONLY to links in the editor's document content
    // (WYSIWYG/SV/preview), where a plain click means "edit": there a plain click is
    // left for editing and only Ctrl/Cmd+click opens. Links in chrome — the
    // About/Info dialog and other tips, toolbar, panels — are not editable text, so
    // they open on a plain click. Wiki links above are unaffected.
    const linkElement = target?.closest<HTMLAnchorElement>('a[href]')
    if (linkElement?.href) {
      e.preventDefault()
      e.stopPropagation()
      if (!isEditorContentLink(linkElement) || shouldOpenLink(e)) {
        openLink(linkElement.href)
      }
    }
  })
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null
    const wikiElement = target?.closest<HTMLElement>('[data-wiki-link="1"]')
    if (!wikiElement) {
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      activateWikiLink(wikiElement)
    }
  })

  // Delete/Backspace on wiki chips: contenteditable can't natively remove an
  // opaque inline <span> with one keystroke. Handle it ourselves: if the caret
  // is adjacent to a wiki chip (or inside one), remove the chip and leave the
  // caret in its place. Capture phase so we run before Vditor's input handler.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return

      const range = sel.getRangeAt(0)
      const container = range.startContainer
      const offset = range.startOffset

      // Case 1: caret is INSIDE a wiki chip span
      const inside =
        (container as HTMLElement)?.closest?.('[data-wiki-link="1"]') ??
        container.parentElement?.closest?.('[data-wiki-link="1"]')
      if (inside) {
        e.preventDefault()
        e.stopPropagation()
        const parent = inside.parentNode!
        const textNode = document.createTextNode('')
        parent.replaceChild(textNode, inside)
        range.setStart(textNode, 0)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        // Trigger Vditor's input handler to re-parse the block
        ;(parent as Element)
          .closest?.('[contenteditable]')
          ?.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }

      // Case 2: caret is right BEFORE a chip (Delete) or right AFTER (Backspace)
      let chip: Element | null = null
      if (container.nodeType === 1) {
        // caret in element — check child at offset
        const el = container as HTMLElement
        if (e.key === 'Delete' && el.childNodes[offset]) {
          const next = el.childNodes[offset] as HTMLElement
          if (next.nodeType === 1 && next.matches?.('[data-wiki-link="1"]'))
            chip = next
        }
        if (e.key === 'Backspace' && offset > 0 && el.childNodes[offset - 1]) {
          const prev = el.childNodes[offset - 1] as HTMLElement
          if (prev.nodeType === 1 && prev.matches?.('[data-wiki-link="1"]'))
            chip = prev
        }
      } else if (container.nodeType === 3) {
        // caret in text node — check adjacent sibling
        if (e.key === 'Delete' && offset === container.textContent!.length) {
          const next = container.nextSibling as HTMLElement
          if (next?.nodeType === 1 && next.matches?.('[data-wiki-link="1"]'))
            chip = next
        }
        if (e.key === 'Backspace' && offset === 0) {
          const prev = container.previousSibling as HTMLElement
          if (prev?.nodeType === 1 && prev.matches?.('[data-wiki-link="1"]'))
            chip = prev
        }
      }
      if (chip) {
        e.preventDefault()
        e.stopPropagation()
        const parent = chip.parentNode!
        const textNode = document.createTextNode('')
        parent.replaceChild(textNode, chip)
        range.setStart(textNode, 0)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        ;(parent as Element)
          .closest?.('[contenteditable]')
          ?.dispatchEvent(new Event('input', { bubbles: true }))
      }
    },
    true, // capture phase — before Vditor
  )
  window.open = (url: string, ..._args: any[]) => {
    openLink(url)
    return window
  }
}

/** error:
 We don't execute document.execCommand() this time, because it is called recursively.
(anonymous) @ main.js:32449
(anonymous) @ main.js:842
(anonymous) @ host.js:27
see: https://github.com/nwjs/nw.js/issues/3403 */
export function fixCut() {
  const _exec = document.execCommand.bind(document)
  document.execCommand = (cmd, ...args) => {
    if (cmd === 'delete') {
      setTimeout(() => {
        return _exec(cmd, ...args)
      })
    } else {
      return _exec(cmd, ...args)
    }
  }
}
