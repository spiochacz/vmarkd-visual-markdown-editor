import { keyboard } from '@testing-library/user-event/dist/keyboard'

import _ from 'lodash'
import Vditor from 'vditor'
window.vscode =
  (window as any).acquireVsCodeApi && (window as any).acquireVsCodeApi()
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
// 切换 content-theme 时自动修改 vditor theme
export function fixDarkTheme() {
  let $ct = document.querySelector('[data-type="content-theme"]')
  $ct.nextElementSibling.addEventListener('click', (e) => {
    if ((e.target as any).tagName !== 'BUTTON') return
    let type = (e.target as any).getAttribute('data-type')
    if (type === 'dark') {
      vditor.setTheme(type)
    } else {
      vditor.setTheme('classic')
    }
  })
}
// panel hover 加定时延迟
export function fixPanelHover() {
  document.querySelectorAll<HTMLElement>('.vditor-panel').forEach((el) => {
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
    reader.onload = function (evt) {
      res(evt.target.result.toString().split(',')[1])
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}
// 保存 vditor 配置到 vscode 同步存储
export function saveVditorOptions() {
  let vditorOptions = {
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
          '.vditor-panel--left button, .vditor-panel--arrow button, .vditor-panel button'
        )
      ) {
        setTimeout(() => {
          saveVditorOptions()
        }, 500)
      }
    })
  })
}

function normalizeResponsiveTables(root: ParentNode = document) {
  root.querySelectorAll<HTMLTableElement>('.vditor-reset table').forEach((table) => {
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
      '.vditor-reset table colgroup col, .vditor-reset table th, .vditor-reset table td'
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
  const syncTables = _.debounce(() => {
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
    if (activateWikiLink(wikiElement)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }

    const linkElement = target?.closest<HTMLAnchorElement>('a[href]')
    if (linkElement?.href) {
      e.preventDefault()
      e.stopPropagation()
      openLink(linkElement.href)
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
  window.open = (url: string, ...args: any[]) => {
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
  let _exec = document.execCommand.bind(document)
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
