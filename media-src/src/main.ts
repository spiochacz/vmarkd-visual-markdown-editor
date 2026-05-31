import './preload'

import {
  fileToBase64,
  fixCut,
  fixDarkTheme,
  fixLinkClick,
  fixPanelHover,
  fixResponsiveTables,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'

import { deepMerge } from './deep-merge'
import Vditor from 'vditor'
import { formatTimestamp } from './format-timestamp'
import 'vditor/dist/index.css'
import { lang } from './lang'
import { createToolbar } from './toolbar'
import { fixTableIr } from './fix-table-ir'
import { setupCustomRenderer } from './custom-renderer'
import { setupOutlineFlash } from './outline'
import { applyBodyOptions, swapStyle } from './live-config'
import './main.css'

let applyingExtensionUpdate = false

// Apply Vditor's UI + content + code theme via setTheme — the proven path.
// The constructor `theme`/`preview.theme.current` options alone do NOT reliably
// apply the content/code theme at init, which left a dark VS Code showing light
// content text + white tables. Used by both init (after()) and live switching.
function applyVditorTheme(theme: 'dark' | 'light') {
  if (!window.vditor) return
  if (theme === 'dark') {
    vditor.setTheme('dark', 'dark', 'github-dark')
  } else {
    vditor.setTheme('classic', 'light', 'github')
  }
}

function initVditor(msg) {
  console.log('msg', msg)
  let inputTimer
  let defaultOptions: any = msg.cdn ? { cdn: msg.cdn } : {}
  if (msg.theme === 'dark') {
    // vditor.setTheme('dark', 'dark')
    defaultOptions = deepMerge(defaultOptions, {
      theme: 'dark',
      preview: {
        theme: {
          current: 'dark',
        },
        hljs: {
          style: 'github-dark',
        },
      }
    })
  } else {
    // Explicit light code theme — matched pair to github-dark, avoids any
    // init flash of Vditor's default before applyVditorTheme runs (task 05).
    defaultOptions = deepMerge(defaultOptions, {
      preview: {
        hljs: {
          style: 'github',
        },
      }
    })
  }
  defaultOptions = deepMerge(defaultOptions, msg.options, {
    preview: {
      math: {
        inlineDigit: true,
      }
    }
  })
  // Code-block line numbers (rendered preview only). deepMerge keeps the
  // dark-theme hljs.style sibling intact.
  if (msg.options && msg.options.codeBlockLineNumbers) {
    defaultOptions = deepMerge(defaultOptions, {
      preview: { hljs: { lineNumber: true } },
    })
  }
  // Outline panel: open-by-default + side (tasks 07/08). Default position right.
  defaultOptions = deepMerge(defaultOptions, {
    outline: {
      enable: msg.options?.showOutlineByDefault === true,
      position: msg.options?.outlinePosition === 'left' ? 'left' : 'right',
    },
  })
  if (window.vditor) {
    vditor.destroy()
    window.vditor = null
  }
  window.vditor = new Vditor('app', {
    width: '100%',
    height: '100%',
    minHeight: '100%',
    lang,
    value: msg.content,
    mode: 'ir',
    cache: { enable: false },
    // Opt-in: the counter recomputes on every keystroke (perf cost on large docs).
    counter: { enable: msg.options?.wordCount === true },
    toolbar:
      msg.options?.showToolbar === false
        ? []
        : createToolbar({ wikiEnabled: Boolean(msg.wiki && msg.wiki.enabled) }),
    toolbarConfig: { pin: true },
    ...defaultOptions,
    // Vditor 3.11.x calls this optional hook unconditionally while rendering
    // the wysiwyg toolbar; without it the editor throws on init and never
    // finishes (window.vditor stays undefined, table panel never mounts).
    customWysiwygToolbar: () => {},
    after() {
      // Force the theme through setTheme at init (constructor options don't
      // reliably apply content/code theme — see applyVditorTheme).
      applyVditorTheme(msg.theme === 'dark' ? 'dark' : 'light')
      const wikiEnabled = Boolean(msg.wiki && msg.wiki.enabled)
      setupCustomRenderer(window.vditor, {
        enabled: wikiEnabled,
        knownPages: wikiEnabled && msg.wiki.pageKeys
          ? new Set(msg.wiki.pageKeys as string[])
          : undefined,
      })
      if (wikiEnabled && typeof msg.content === 'string' && msg.content.includes('[[')) {
        applyingExtensionUpdate = true
        try {
          vditor.setValue(msg.content)
        } finally {
          setTimeout(() => { applyingExtensionUpdate = false }, 0)
        }
      }
      fixDarkTheme()
      handleToolbarClick()
      fixTableIr()
      fixResponsiveTables()
      fixPanelHover()
      if (msg.options?.outlineHighlight !== false) {
        setupOutlineFlash(window.vditor)
      }
    },
    input() {
      if (applyingExtensionUpdate) {
        return
      }
      inputTimer && clearTimeout(inputTimer)
      inputTimer = setTimeout(() => {
        vscode.postMessage({ command: 'edit', content: vditor.getValue() })
      }, 250)
    },
    upload: {
      url: '/fuzzy', // 没有 url 参数粘贴图片无法上传 see: https://github.com/Vanessa219/vditor/blob/d7628a0a7cfe5d28b055469bf06fb0ba5cfaa1b2/src/ts/util/fixBrowserBehavior.ts#L1409
      async handler(files) {
        // console.log('files', files)
        let fileInfos = await Promise.all(
          files.map(async (f) => {
            return {
              base64: await fileToBase64(f),
              name: `${formatTimestamp(new Date())}_${f.name}`.replace(
                /[^\w-_.]+/,
                '_'
              ),
            }
          })
        )
        vscode.postMessage({
          command: 'upload',
          files: fileInfos,
        })
      },
    },
  })
}

window.addEventListener('message', (e) => {
  const msg = e.data
  // console.log('msg from vscode', msg)
  switch (msg.command) {
    case 'update': {
      if (msg.type === 'init') {
        document.body.setAttribute(
          'data-wiki-file',
          msg.wiki && msg.wiki.enabled ? '1' : '0'
        )
        applyBodyOptions(msg.options)
        try {
          initVditor(msg)
        } catch (error) {
          // reset options when error
          console.error(error)
          initVditor({ content: msg.content })
          saveVditorOptions()
        }
        console.log('initVditor')
      } else {
        if (vditor.getValue() !== msg.content) {
          applyingExtensionUpdate = true
          try {
            vditor.setValue(msg.content)
          } finally {
            setTimeout(() => {
              applyingExtensionUpdate = false
            }, 0)
          }
          console.log('setValue')
        }
      }
      break
    }
    case 'set-theme': {
      // Live re-theme without re-initialising (keeps cursor/scroll). Chrome
      // colors already follow via --vscode-* CSS vars.
      applyVditorTheme(msg.theme === 'dark' ? 'dark' : 'light')
      break
    }
    case 'config-changed': {
      // Live config reload (task 26): re-apply the body-attr / CSS-var options
      // without destroying Vditor (cursor/scroll preserved).
      applyBodyOptions(msg.options)
      break
    }
    case 'reload-css': {
      // Live CSS swap (tasks 12/26): replace the customCss or external-CSS
      // <style> node in place.
      swapStyle(msg.id, msg.css)
      break
    }
    case 'uploaded': {
      msg.files.forEach((f) => {
        if (f.endsWith('.wav')) {
          vditor.insertValue(
            `\n\n<audio controls="controls" src="${f}"></audio>\n\n`
          )
        } else {
          const i = new Image()
          i.src = f
          i.onload = () => {
            vditor.insertValue(`\n\n![](${f})\n\n`)
          }
          i.onerror = () => {
            vditor.insertValue(`\n\n[${f.split('/').slice(-1)[0]}](${f})\n\n`)
          }
        }
      })
      break
    }
    default:
      break
  }
})

fixLinkClick()
fixCut()

window.addEventListener('keydown', (event) => {
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const modifierPressed = isMac
    ? event.metaKey && event.ctrlKey
    : event.ctrlKey && event.altKey
  if (modifierPressed && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    event.stopPropagation()
    vscode.postMessage({ command: 'edit-in-vscode' })
  }
})

vscode.postMessage({ command: 'ready' })
