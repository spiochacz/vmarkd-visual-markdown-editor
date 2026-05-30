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
import { profiler } from './perf'
import './main.css'

let applyingExtensionUpdate = false
// Resolves once the preloaded Lute script has loaded+evaluated (or failed).
// initVditor awaits it so `new Vditor` reuses the resident Lute (warm construct).
let lutePreloadPromise: Promise<boolean> | null = null

// Apply Vditor's UI + content + code theme via setTheme — the proven path.
// The constructor `theme`/`preview.theme.current` options alone do NOT reliably
// apply the content/code theme at init, which left a dark VS Code showing light
// content text + white tables. Used by both init (after()) and live switching.
function applyVditorTheme(theme: 'dark' | 'light') {
  if (!window.vditor) return
  if (theme === 'dark') {
    vditor.setTheme('dark', 'dark', 'atom-one-dark-reasonable')
  } else {
    vditor.setTheme('classic', 'light', 'github')
  }
}

function initVditor(msg) {
  console.log('msg', msg)
  // Profiling harness (tasks/42) — enabled per the `profiling` setting. Must be
  // set before `new Vditor` so the init span records.
  profiler.setEnabled(msg.options?.profiling === true)
  const docSize = typeof msg.content === 'string' ? msg.content.length : 0
  const initToken = profiler.start()
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
          style: 'atom-one-dark-reasonable',
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
      // Split the init cost (tasks/42): everything until `after()` fires is
      // Vditor construction + Lute's first parse (the GopherJS cost); the
      // `after()` body below is our own post-init wiring. Knowing the split
      // tells us which to attack.
      profiler.end('init.construct', initToken, docSize)
      const afterToken = profiler.start()
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
          const t = profiler.start()
          vditor.setValue(msg.content)
          profiler.end('setValue', t, msg.content.length)
        } finally {
          setTimeout(() => { applyingExtensionUpdate = false }, 0)
        }
      }
      fixDarkTheme()
      handleToolbarClick()
      fixTableIr()
      fixResponsiveTables()
      fixPanelHover()
      profiler.end('init.after', afterToken, docSize)
      profiler.end('init', initToken, docSize)
      // True end-to-end open: page-script start (window.__openT0, set by the
      // first inline script in the webview HTML) -> editor ready. Captures icon
      // + main.js eval, the ready roundtrip, any Lute preload, and construct —
      // the number to compare with/without `preloadLute`.
      const openT0 = (window as any).__openT0
      if (typeof openT0 === 'number') {
        profiler.end('open.total', openT0, docSize)
      }
      // Proof the preload fired + how long Lute's async load+eval took. Absence
      // of this row (with preloadLute on) means the load failed / didn't run.
      const preloadMs = (window as any).__lutePreloadMs
      if (typeof preloadMs === 'number' && preloadMs >= 0) {
        profiler.record('preload', preloadMs, docSize)
      }
    },
    input() {
      if (applyingExtensionUpdate) {
        return
      }
      inputTimer && clearTimeout(inputTimer)
      inputTimer = setTimeout(() => {
        const t = profiler.start()
        const content = vditor.getValue()
        profiler.end('getValue', t, content.length)
        vscode.postMessage({ command: 'edit', content })
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

window.addEventListener('message', async (e) => {
  const msg = e.data
  // console.log('msg from vscode', msg)
  switch (msg.command) {
    case 'update': {
      if (msg.type === 'init') {
        // Wait for the preloaded Lute (if any) so `new Vditor` constructs warm
        // (tasks/42). Resolves immediately once the script has already loaded.
        if (lutePreloadPromise) {
          await lutePreloadPromise
        }
        document.body.setAttribute(
          'data-wiki-file',
          msg.wiki && msg.wiki.enabled ? '1' : '0'
        )
        if (msg.options && msg.options.useVscodeThemeColor) {
          document.body.setAttribute('data-use-vscode-theme-color', '1')
        } else {
          document.body.setAttribute('data-use-vscode-theme-color', '0')
        }

        if (msg.options && msg.options.enableFullWidth) {
          document.body.setAttribute('data-full-width', '1')
        } else {
          document.body.setAttribute('data-full-width', '0')
        }
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
            const t = profiler.start()
            vditor.setValue(msg.content)
            profiler.end('setValue', t, msg.content.length)
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

// Lute preload prototype (tasks/42). Vditor lazily loads the 3.8 MB GopherJS
// Lute bundle inside `new Vditor` — ~95% of the ~650 ms init.construct cost,
// and it sits idle-blocked behind the `ready` roundtrip. Here we post `ready`
// first (so the host starts preparing the init reply on its own process), then
// kick off an async <script> load of Lute so its download+eval overlaps that
// roundtrip. We claim Vditor's dedup id (`vditorLuteScript`) on load, so
// `new Vditor` reuses the resident Lute and constructs warm (~15 ms). The init
// handler awaits lutePreloadPromise, so there is no load-vs-init race. Uses a
// plain <script src> (CORS-safe — the same path Vditor itself uses), not XHR.
// Gated by `preloadLute`; the extension embeds the URL as __vditorLutePreload.
function startLutePreload() {
  const url = (window as any).__vditorLutePreload
  if (!url || document.getElementById('vditorLuteScript')) {
    return
  }
  const start = performance.now()
  lutePreloadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => {
      if (!document.getElementById('vditorLuteScript')) {
        script.id = 'vditorLuteScript' // claim Vditor's dedup id
      }
      ;(window as any).__lutePreloadMs = performance.now() - start
      resolve(true)
    }
    script.onerror = () => {
      ;(window as any).__lutePreloadMs = -1
      resolve(false)
    }
    document.head.appendChild(script)
  })
}

vscode.postMessage({ command: 'ready' })
startLutePreload()
