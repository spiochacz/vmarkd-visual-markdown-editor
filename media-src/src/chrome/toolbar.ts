import { t } from '../util/lang'
import { isMac } from '../util/platform'
import { FORMAT_HOTKEYS, formatTip } from '../../../src/shared/format-hotkeys'
import {
  backIcon,
  editInVsCodeIcon,
  linkIcon,
  moreIcon,
  outlineIcon,
  reflowIcon,
  wikiPagesIcon,
} from './toolbar-icons'

// Task 505 — one owner per key: every promoted item (FORMAT_HOTKEYS) and every deliberately-
// unpromoted-but-formerly-hotkeyed item below gets `hotkey: ''`, which makes Vditor's own
// `matchHotKey` (node_modules/vditor/src/ts/util/hotKey.ts) return `false` immediately and stops
// its bubble-phase handler from ever intercepting/`preventDefault()`ing that key — so the VS Code
// command (registered in src/app/commands.ts from the SAME table) becomes the sole owner. For a
// FORMAT_HOTKEYS row, the tooltip is rebuilt from the table's own `key`/`mac` fields via
// `formatTip` (NOT Vditor's `updateHotkeyTip`, which only understands its own `⌘`/`⇧` notation).
const FORMAT_HOTKEYS_BY_NAME = new Map(
  FORMAT_HOTKEYS.map((row) => [row.toolbarName, row]),
)

// Returns the toolbar item config for a promoted (keyed) name: hotkey disabled, tip rebuilt from
// the shared table. Throws on a name not in FORMAT_HOTKEYS — a typo here would otherwise silently
// fall back to Vditor's own (now-stale) hotkey/tip, exactly the bug this task fixes. `mac` is
// read fresh per `createToolbar()` call (below) rather than cached at module load, so it reflects
// `isMac()` at the time the toolbar is actually built.
function promoted(name: string, mac: boolean) {
  const row = FORMAT_HOTKEYS_BY_NAME.get(name)
  if (!row) throw new Error(`"${name}" is not in FORMAT_HOTKEYS`)
  return { name, hotkey: '', tip: formatTip(row.label, mac, row) }
}

// Build-time constants injected via esbuild `define` (see esbuild-shared.mjs):
// the Vditor version and the vendored Lute pin (commit + date). Empty if unpinned.
declare const __VMARKD_VDITOR_VERSION__: string
declare const __VMARKD_LUTE_COMMIT__: string
declare const __VMARKD_LUTE_COMMITTED_AT__: string

// "About vMarkd" dialog (shown via vditor.tip.show). Mirrors the version line of the
// "About vditor" dialog — Vditor + the pinned Lute build as a GitHub commit link +
// date — and links to the vMarkd repo. Rendered inside the webview tip; the links
// are chrome (not editor content), so they open on a plain click. Pure (takes its
// version data as args) so it's unit-testable; the call site passes the build-time
// `define` constants.
export const VMARKD_REPO =
  'https://github.com/spiochacz/vmarkd-visual-markdown-editor'
export function aboutVmarkdHtml(v: {
  vditorVersion: string
  luteCommit: string
  luteCommittedAt: string
}): string {
  const lute = v.luteCommit
    ? `Lute <a href="https://github.com/88250/lute/commit/${v.luteCommit}" target="_blank">${v.luteCommit.slice(0, 7)}</a>${v.luteCommittedAt ? ` (${v.luteCommittedAt})` : ''}`
    : 'Lute'
  return (
    '<div style="max-width: 440px;font-size: 14px;line-height: 22px;margin-bottom: 14px;">' +
    '<p style="text-align: center;margin: 14px 0"><em>vMarkd — a visual Markdown editor for VS Code</em></p>' +
    '<ul style="list-style: none">' +
    `<li>GitHub: <a href="${VMARKD_REPO}" target="_blank">spiochacz/vmarkd-visual-markdown-editor</a></li>` +
    '<li>License: MIT</li>' +
    `<li>Version: Vditor v${v.vditorVersion} / ${lute}</li>` +
    '</ul>' +
    '</div>'
  )
}

function getEditorRange(): Range | undefined {
  const mode = vditor.getCurrentMode()
  const editor = vditor.vditor?.[mode]?.element as HTMLElement | undefined
  const selection = window.getSelection()

  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0)
    if (
      editor?.contains(range.commonAncestorContainer) ||
      editor?.isEqualNode(range.commonAncestorContainer as Node)
    ) {
      return range.cloneRange()
    }
  }

  const storedRange = vditor.vditor?.[mode]?.range as Range | undefined
  return storedRange?.cloneRange()
}

function getCharBeforeRange(range: Range): string {
  const mode = vditor.getCurrentMode()
  const editor = vditor.vditor?.[mode]?.element as HTMLElement | undefined
  if (!editor) return ''

  const beforeRange = range.cloneRange()
  beforeRange.selectNodeContents(editor)
  beforeRange.setEnd(range.startContainer, range.startOffset)
  return beforeRange.toString().slice(-1)
}

function restoreEditorRange(range: Range | undefined) {
  if (!range) return
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  const mode = vditor.getCurrentMode()
  // Mirrors the optional-chained reads above (getEditorRange/getCharBeforeRange): the current
  // mode's editor state can be absent (e.g. mode just switched), in which case there's nowhere
  // to store the range — same no-op the reads already tolerate.
  const modeState = vditor.vditor[mode]
  if (!modeState) return
  modeState.range = range.cloneRange()
}

function insertMarkdownLink() {
  const range = getEditorRange()
  const selectedText = (range?.toString() || '').trim()
  const beforeChar = range ? getCharBeforeRange(range) : ''
  const needsLeadingSpace = Boolean(beforeChar) && !/\s/.test(beforeChar)
  const leadingSpace = needsLeadingSpace ? ' ' : ''

  vditor.focus()
  restoreEditorRange(range)

  if (selectedText) {
    vditor.updateValue(`${leadingSpace}[${selectedText}]()`)
    return
  }

  vditor.insertValue(`${leadingSpace}[]()`)
}

interface ToolbarOptions {
  wikiEnabled?: boolean
  /** Click handler of the reflow-line-breaks toggle (injected: chrome must not import editing). */
  onToggleReflow?: () => void
}

export function createToolbar(options: ToolbarOptions = {}) {
  const mac = isMac()
  const toolbarItems = [
    // No VS Code command / keybinding for these — toolbar/mouse-only (task 505 §4). Still
    // `hotkey: ''`'d so Vditor doesn't own a key VS Code doesn't also formally own.
    { name: 'emoji', hotkey: '' },
    promoted('headings', mac),
    promoted('bold', mac),
    promoted('italic', mac),
    promoted('strike', mac),
    {
      hotkey: '',
      icon: linkIcon,
      name: 'link',
      click() {
        insertMarkdownLink()
      },
      // Was 'n' (above the button) — the toolbar is the topmost chrome in the webview with no
      // room above it, so an 'n' tooltip renders off the top of the viewport and is invisible.
      // Every other early-toolbar item already defaults to 's'; this one just never got it.
      tipPosition: 's',
    },
    '|',
    promoted('list', mac),
    promoted('ordered-list', mac),
    promoted('check', mac),
    promoted('outdent', mac),
    promoted('indent', mac),
    '|',
    promoted('quote', mac),
    // Pre-existing label override (not hotkey-related): Vditor's own i18n for 'line' is the
    // terse "Line"; kept across the hotkey:'' change since it's still accurate.
    { name: 'line', hotkey: '', tip: t('horizontalRule') },
    promoted('code', mac),
    promoted('inline-code', mac),
    { name: 'insert-before', hotkey: '' },
    { name: 'insert-after', hotkey: '' },
    '|',
    'upload',
    { name: 'table', hotkey: '' },
    '|',
    // undo/redo keep their vmarkd.format.* command (Command Palette only, no keybinding) —
    // media-src/src/editing/undo-keybind.ts (task 463) already owns Ctrl/Cmd+Z, +Y, +Shift+Z
    // from anywhere in the webview; see format-hotkeys.ts's UNBOUND_FORMAT_COMMANDS header.
    // Both still advertise their (functional, just not VS-Code-keybound) shortcut in the
    // tooltip — `hotkey: ''` alone would silently drop it, unlike every other no-keybinding item,
    // since undo/redo actually DO have a working key, just owned by undo-keybind.ts instead of a
    // registered command.
    {
      name: 'undo',
      hotkey: '',
      tip: `${t('undo')} (${mac ? 'Cmd' : 'Ctrl'}+Z)`,
    },
    {
      name: 'redo',
      hotkey: '',
      // Pre-existing label override (not hotkey-related): documents the extra Shift+Ctrl/Cmd+Z
      // chord undo-keybind.ts owns, which Vditor's own tooltip never advertised.
      tip: `${t('redo')} (Shift+Ctrl/Cmd+Z)`,
    },
    '|',
    { name: 'outline', icon: outlineIcon },
    // Task 83 — pressed state is synced by reflow-toggle.ts (it is not a Vditor-managed toggle).
    {
      name: 'reflow-line-breaks',
      icon: reflowIcon,
      tip: t('reflowLineBreaks'),
      click() {
        options.onToggleReflow?.()
      },
    },
    'preview',
    '|',
    ...(options.wikiEnabled
      ? [
          {
            name: 'navigate-back',
            tipPosition: 's',
            tip: t('navigateBack'),
            className: 'right',
            icon: backIcon,
            click() {
              vscode.postMessage({
                command: 'navigate-back',
              })
            },
          },
          {
            name: 'wiki-pages',
            tipPosition: 's',
            tip: t('wikiPages'),
            className: 'right',
            icon: wikiPagesIcon,
            click() {
              vscode.postMessage({
                command: 'list-wiki-pages',
              })
            },
          },
          '|',
        ]
      : []),
    {
      name: 'edit-in-vscode',
      tipPosition: 's',
      tip: t('editInVsCode'),
      className: 'right',
      icon: editInVsCodeIcon,
      click() {
        vscode.postMessage({
          command: 'edit-in-vscode',
        })
      },
    },
    { name: 'edit-mode', tipPosition: 'e' },
    {
      name: 'more',
      tipPosition: 'e',
      icon: moreIcon,
      toolbar: [
        // Task 505 follow-up: this nested `more` submenu was missed by the original sweep (its
        // top-level-only completeness test never walked `more.toolbar`) — `both` still carried
        // Vditor's native `⌘P` hotkey, live and unneutralised: it kept shadowing VS Code's own
        // Ctrl+P (Quick Open, a very high-frequency workbench command) AND rendered its tooltip
        // in Vditor's native `<Ctrl+P>` bracket style, inconsistent with every promoted item's
        // `(Ctrl+X)` style from `formatTip`. `both` has no cross-tool precedent as a keyboard
        // action and no VS Code command of its own — same "drop it" bucket as link/table/emoji,
        // not a remap candidate.
        { name: 'both', hotkey: '' },
        // content-theme + code-theme pickers dropped from the toolbar — VS Code
        // manages the theme: content follows the editor colours, and the code
        // block highlight is the `markdown-editor.codeTheme` setting.
        // outline + preview promoted to the main toolbar.
        {
          name: 'settings',
          tip: t('settings'),
          // Plain text label, matching the sibling dropdown rows (Outline/Preview/
          // Info/Help render as text via the .vditor-hint button rule). No gear icon.
          icon: 'Settings',
          click() {
            vscode.postMessage({
              command: 'open-settings',
            })
          },
        },
        // The 'info' item shows Vditor's original About dialog (translated to English
        // by the fixInfoDialog esbuild patch), with the Help dialog's links folded in
        // as a section below it — so the separate Vditor 'help' item is dropped. Renamed
        // "About Vditor" (tip drives the dropdown label for level-2 items).
        { name: 'info', tip: t('aboutVditor') },
        {
          name: 'about',
          tip: t('aboutVmarkd'),
          // Shows the vMarkd About dialog (version + GitHub link) as a webview tip,
          // matching the "About vditor" dialog. `vditor` is the IVditor instance
          // Vditor passes to a Custom item's click; its `.tip` renders the popup.
          icon: 'About vMarkd',
          click(_event: Event, vditor: any) {
            vditor.tip.show(
              aboutVmarkdHtml({
                vditorVersion: __VMARKD_VDITOR_VERSION__,
                luteCommit: __VMARKD_LUTE_COMMIT__,
                luteCommittedAt: __VMARKD_LUTE_COMMITTED_AT__,
              }),
              0,
            )
          },
        },
      ],
    },
  ]

  return toolbarItems.map((it: any) => {
    if (typeof it === 'string') {
      it = { name: it }
    }
    it.tipPosition = it.tipPosition || 's'
    return it
  })
}
