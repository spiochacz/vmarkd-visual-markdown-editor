import './preload'

import {
  fileToBase64,
  fixCut,
  fixLinkClick,
  fixPanelHover,
  fixResponsiveTables,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'

import { deepMerge } from './deep-merge'
import Vditor from 'vditor/src/index'
import { formatTimestamp } from './format-timestamp'
import 'vditor/dist/index.css'
import { lang } from './lang'
import { createToolbar } from './toolbar'
import { fixTableIr } from './fix-table-ir'
import { setupCustomRenderer } from './custom-renderer'
import { setupOutlineFlash } from './outline'
import { setupSplitScrollSync } from './split-scroll-sync'
import { applyBodyOptions, swapStyle, initOnlyChanged } from './live-config'
import { applyMermaidTheme } from './mermaid-theme'
import { setupHistoryKeybind } from './undo-keybind'
import {
  getCursorSourceOffset,
  activeModeElement,
  lineAndTextForOffset,
} from './source-map'
import {
  renderDiffMarkers,
  clearDiffMarkers,
  type DiffChange,
} from './diff-markers'
import './main.css'

let applyingExtensionUpdate = false
// The last message Vditor was initialised from — used to re-init when a
// constructor-only setting (toolbar, word count, …) changes live (task 26).
let lastInitMsg: any = null

// Reveal-in-Source (task 16): remember the caret inside the editor. When the
// command runs from VS Code chrome (the toolbar button), focus leaves the
// webview iframe and the live selection collapses to the editor start — so the
// raw selection would read as offset 0. We snapshot the last in-editor caret on
// selectionchange and restore it before measuring, so the button and the command
// palette resolve to the SAME caret. Stored as a cloned Range.
let lastEditorRange: Range | null = null
function trackEditorCaret() {
  const v = window.vditor
  if (!v) return
  const editor = activeModeElement(v)
  if (!editor) return
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const node = sel.anchorNode
  if (!node || !editor.contains(node)) return
  // ignore a caret collapsed to the very start of the editor (the focus-loss
  // artifact we are guarding against) so it can't overwrite a real position
  if (node === editor && sel.anchorOffset === 0 && sel.isCollapsed) return
  lastEditorRange = sel.getRangeAt(0).cloneRange()
}
document.addEventListener('selectionchange', trackEditorCaret)

// Restore the remembered caret when the live selection is missing or collapsed
// to the editor start (focus left the iframe). Returns true if a restore ran.
function restoreEditorCaretIfLost(): boolean {
  const v = window.vditor
  if (!v || !lastEditorRange) return false
  const editor = activeModeElement(v)
  if (!editor) return false
  const sel = window.getSelection()
  const node = sel && sel.rangeCount > 0 ? sel.anchorNode : null
  const live = node && editor.contains(node)
  const collapsedAtStart =
    node === editor && sel!.anchorOffset === 0 && sel!.isCollapsed
  if (live && !collapsedAtStart) return false // a real caret is present; keep it
  try {
    sel!.removeAllRanges()
    sel!.addRange(lastEditorRange)
    return true
  } catch {
    return false
  }
}

// Apply Vditor's UI + content + code theme via setTheme — the proven path.
// The constructor `theme`/`preview.theme.current` options alone do NOT reliably
// apply the content/code theme at init, which left a dark VS Code showing light
// content text + white tables. Used by both init (after()) and live switching.
//
// We pass the content-theme path EXPLICITLY (4th arg) instead of letting
// setTheme fall back to `options.preview.theme.path`: that option is unreliable
// here — the host strips a stale baked path from saved options (the colors-401
// fix), which would otherwise leave setContentTheme with an empty path and make
// it a no-op, so the table/content theme never followed a live theme switch.
// Resolve the code-block highlight style: the `codeTheme` setting, or — when
// 'auto'/unset — github/github-dark following the VS Code light/dark theme.
function codeHljsStyle(theme: 'dark' | 'light', options: any): string {
  const ct = options?.codeTheme
  if (!ct || ct === 'auto') return theme === 'dark' ? 'github-dark' : 'github'
  return ct
}

function applyVditorTheme(theme: 'dark' | 'light') {
  if (!window.vditor) return
  const cdn = lastInitMsg?.cdn
  const contentThemePath = cdn ? `${cdn}/dist/css/content-theme` : undefined
  const code = codeHljsStyle(theme, lastInitMsg?.options)
  if (theme === 'dark') {
    vditor.setTheme('dark', 'dark', code, contentThemePath)
  } else {
    vditor.setTheme('classic', 'light', code, contentThemePath)
  }
}

// Remove the host-side instant-paint overlay (see src/lute-host.ts). Called once
// the live editor is built AND themed (right after applyVditorTheme), so the
// reveal is seamless — no rAF needed. Idempotent + never throws, so it's safe to
// call from a finally as a guaranteed swap even if a later after() helper throws.
function removePrerenderOverlay() {
  try {
    document.getElementById('vmarkd-prerender')?.remove()
  } catch {}
}

function initVditor(msg) {
  // Do not log `msg` — it carries the full document content (task 18 §2d).
  lastInitMsg = msg
  // Force the configured mermaid theme (wraps mermaid.initialize before Vditor
  // lazy-loads/renders it). 'auto' = follow Vditor's own dark/default choice.
  applyMermaidTheme(window, msg.options?.mermaidTheme)
  let inputTimer: ReturnType<typeof setTimeout> | undefined
  let defaultOptions: any = msg.cdn ? { cdn: msg.cdn } : {}
  const codeStyle = codeHljsStyle(
    msg.theme === 'dark' ? 'dark' : 'light',
    msg.options,
  )
  if (msg.theme === 'dark') {
    // vditor.setTheme('dark', 'dark')
    defaultOptions = deepMerge(defaultOptions, {
      theme: 'dark',
      preview: {
        theme: {
          current: 'dark',
        },
        hljs: {
          style: codeStyle,
        },
      },
    })
  } else {
    // Explicit light code theme — avoids any init flash of Vditor's default
    // before applyVditorTheme runs (task 05). Honors the codeTheme setting.
    defaultOptions = deepMerge(defaultOptions, {
      preview: {
        hljs: {
          style: codeStyle,
        },
      },
    })
  }
  defaultOptions = deepMerge(defaultOptions, msg.options, {
    preview: {
      math: {
        inlineDigit: true,
      },
      // Drop Vditor's default preview action bar (Desktop/Tablet/Mobile device
      // widths + the China-specific "copy for WeChat 公众号 / Zhihu" buttons) —
      // irrelevant in a VS Code markdown editor.
      actions: [],
    },
  })
  // Code-block line numbers (rendered preview only). deepMerge keeps the
  // dark-theme hljs.style sibling intact.
  if (msg.options?.codeBlockLineNumbers) {
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
        : createToolbar({ wikiEnabled: Boolean(msg.wiki?.enabled) }),
    toolbarConfig: { pin: true },
    ...defaultOptions,
    // Vditor 3.11.x calls this optional hook unconditionally while rendering
    // the wysiwyg toolbar; without it the editor throws on init and never
    // finishes (window.vditor stays undefined, table panel never mounts).
    customWysiwygToolbar: () => {},
    after() {
      try {
        // Force the theme through setTheme at init (constructor options don't
        // reliably apply content/code theme — see applyVditorTheme).
        applyVditorTheme(msg.theme === 'dark' ? 'dark' : 'light')
        // The live editor is now built AND themed — swap it in for the host-side
        // instant-paint overlay here, BEFORE the remaining (non-visual) helpers,
        // so a throw in any of them can't leave the overlay stuck on top.
        removePrerenderOverlay()
        const wikiEnabled = Boolean(msg.wiki?.enabled)
        setupCustomRenderer(window.vditor, {
          enabled: wikiEnabled,
          knownPages:
            wikiEnabled && msg.wiki.pageKeys
              ? new Set(msg.wiki.pageKeys as string[])
              : undefined,
        })
        if (
          wikiEnabled &&
          typeof msg.content === 'string' &&
          msg.content.includes('[[')
        ) {
          applyingExtensionUpdate = true
          try {
            vditor.setValue(msg.content)
          } finally {
            setTimeout(() => {
              applyingExtensionUpdate = false
            }, 0)
          }
        }
        handleToolbarClick()
        fixTableIr()
        fixResponsiveTables()
        fixPanelHover()
        if (msg.options?.outlineHighlight !== false) {
          setupOutlineFlash(window.vditor)
        }
        // Centre-anchored scroll sync for split (sv) view (task 48). Idempotent.
        setupSplitScrollSync()
      } finally {
        // Belt-and-suspenders: guarantee the overlay is gone even if a helper
        // (or applyVditorTheme) above threw. Idempotent.
        removePrerenderOverlay()
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
        const fileInfos = await Promise.all(
          files.map(async (f) => {
            return {
              base64: await fileToBase64(f),
              name: `${formatTimestamp(new Date())}_${f.name}`.replace(
                /[^\w-_.]+/,
                '_',
              ),
            }
          }),
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
        // A fresh editor: drop any stale gutter bars from a previous instance.
        lastDiffChanges = []
        clearDiffMarkers()
        document.body.setAttribute(
          'data-wiki-file',
          msg.wiki?.enabled ? '1' : '0',
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
              // setValue re-rendered the blocks → re-apply the gutter bars.
              if (window.vditor && lastDiffChanges.length) {
                renderDiffMarkers(window.vditor, lastDiffChanges)
              }
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
      // Live config reload (task 26): body-attr / CSS-var options apply without
      // touching Vditor. Constructor-only options (toolbar, word count, …) can't
      // — re-init Vditor with the merged options, preserving the current content.
      applyBodyOptions(msg.options)
      const codeThemeChanged =
        lastInitMsg && lastInitMsg.options?.codeTheme !== msg.options?.codeTheme
      if (lastInitMsg && initOnlyChanged(lastInitMsg.options, msg.options)) {
        const content =
          window.vditor && !applyingExtensionUpdate
            ? vditor.getValue()
            : lastInitMsg.content
        initVditor({
          ...lastInitMsg,
          content,
          options: { ...lastInitMsg.options, ...msg.options },
        })
      } else if (codeThemeChanged && window.vditor) {
        // Code-block theme isn't a constructor-only option — apply it live via
        // setTheme (swaps the hljs stylesheet) without re-init, keeping cursor.
        lastInitMsg.options = { ...lastInitMsg.options, ...msg.options }
        applyVditorTheme(lastInitMsg.theme === 'dark' ? 'dark' : 'light')
      }
      break
    }
    case 'reload-css': {
      // Live CSS swap (tasks 12/26): replace the customCss or external-CSS
      // <style> node in place.
      swapStyle(msg.id, msg.css)
      break
    }
    case 'get-cursor-offset': {
      // Reveal-in-Source (task 16): report the caret position so the host can
      // select the matching line. Restore the last in-editor caret first (the
      // toolbar button blurs the iframe and collapses the live selection). Reply
      // with the line number AND that line's text — both measured against
      // vditor.getValue() — so the host can match by content in the on-disk doc
      // (which may differ by Vditor's on-load reflow) rather than a raw offset
      // that drifts across the two text spaces. Always reply (line -1 when
      // unresolved) so the host's awaited round-trip never hangs past its timeout.
      let line = -1
      let lineText = ''
      if (window.vditor) {
        restoreEditorCaretIfLost()
        const offset = getCursorSourceOffset(window.vditor)
        if (offset >= 0) {
          const res = lineAndTextForOffset(window.vditor.getValue(), offset)
          line = res.line
          lineText = res.lineText
        }
      }
      vscode.postMessage({ command: 'cursor-offset', line, lineText })
      break
    }
    case 'diff-info': {
      // Git gutters (task 17): stash + render the change bars.
      lastDiffChanges = (msg.changes || []) as DiffChange[]
      if (window.vditor) renderDiffMarkers(window.vditor, lastDiffChanges)
      break
    }
    case 'uploaded': {
      msg.files.forEach((f) => {
        if (f.endsWith('.wav')) {
          vditor.insertValue(
            `\n\n<audio controls="controls" src="${f}"></audio>\n\n`,
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

// Route Ctrl/Cmd+Z·Y to Vditor's own undo engine instead of the browser/VS Code
// document undo — see undo-keybind.ts for the full rationale.
setupHistoryKeybind(window)

vscode.postMessage({ command: 'ready' })
