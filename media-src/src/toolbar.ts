import { t } from './lang'

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
  vditor.vditor[mode].range = range.cloneRange()
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

// Toolbar icons restyled to VS Code codicons (task 44). codicons are MIT-licensed;
// these <path> data are lifted from the codicon source. The matching toolbar
// title-bar buttons use the same codicon names ($(go-to-file)/$(settings-gear)).
const editInVsCodeIcon =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.58594 1.00098C8.98394 1.00098 9.36646 1.15943 9.64746 1.44043L12.5605 4.35352C12.8415 4.63552 13.001 5.01704 13.001 5.41504V13.001C13.001 14.106 12.106 15.001 11.001 15.001H5.00098C3.89599 15.001 3.00098 14.106 3.00098 13.001V6.00098H4.00098V13.001C4.00098 13.553 4.44899 14.001 5.00098 14.001H11.001C11.553 14.001 12.001 13.553 12.001 13.001V6.00098H9.50098C8.67299 6.00096 8.00098 5.32897 8.00098 4.50098V2.00098C7.99198 1.97699 7.98265 1.9527 7.97266 1.92871C7.89674 1.74704 7.78717 1.5812 7.64746 1.44238L7.20605 1.00098H8.58594ZM9 4.5C9 4.776 9.224 5 9.5 5H11.793L9 2.20703V4.5Z"/><path fill="currentColor" d="M4.5 0C4.63299 0 4.75952 0.0534683 4.85352 0.147461L6.85352 2.14746C6.90042 2.19336 6.93789 2.24775 6.96289 2.30859C6.98789 2.36959 7.00097 2.43498 7.00098 2.50098C7.00098 2.56698 6.98789 2.63236 6.96289 2.69336C6.93789 2.75323 6.90043 2.80956 6.85352 2.85547L4.85352 4.85547C4.75956 4.94917 4.63278 5.00195 4.5 5.00195C4.36722 5.00195 4.24044 4.94917 4.14648 4.85547C4.05248 4.76147 3.99902 4.63398 3.99902 4.50098C3.99903 4.36799 4.05249 4.24146 4.14648 4.14746L5.29297 3.00098H2.5C2.10201 3.00098 1.72045 3.15944 1.43945 3.44043C1.15846 3.72242 1.00001 4.10298 1 4.50098V5.50098C1 5.63398 0.947516 5.76147 0.853516 5.85547C0.759563 5.94817 0.632774 6.00098 0.5 6.00098C0.367225 6.00098 0.240437 5.94917 0.146484 5.85547C0.0534844 5.76147 0 5.63398 0 5.50098V4.50098C6.17892e-06 3.83799 0.263427 3.20239 0.732422 2.7334C1.20142 2.26441 1.83701 2.00098 2.5 2.00098H5.29297L4.14648 0.855469C4.05248 0.761469 3.99902 0.633977 3.99902 0.500977C3.99903 0.367985 4.05249 0.241455 4.14648 0.147461C4.24048 0.0534683 4.36701 0 4.5 0Z"/></svg>'

const wikiPagesIcon =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M2.5 2C1.67157 2 1 2.67157 1 3.5V12.5C1 13.3284 1.67157 14 2.5 14H6C6.8178 14 7.54389 13.6073 8 13.0002C8.45612 13.6073 9.1822 14 10 14H13.5C14.3284 14 15 13.3284 15 12.5V3.5C15 2.67157 14.3284 2 13.5 2H10C9.1822 2 8.45612 2.39267 8 2.99976C7.54389 2.39267 6.8178 2 6 2H2.5ZM7.5 4.5V11.5C7.5 12.3284 6.82843 13 6 13H2.5C2.22386 13 2 12.7761 2 12.5V3.5C2 3.22386 2.22386 3 2.5 3H6C6.82843 3 7.5 3.67157 7.5 4.5ZM8.5 11.5V4.5C8.5 3.67157 9.17157 3 10 3H13.5C13.7761 3 14 3.22386 14 3.5V12.5C14 12.7761 13.7761 13 13.5 13H10C9.17157 13 8.5 12.3284 8.5 11.5Z"/></svg>'

const backIcon =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z"/></svg>'

// Outline / table-of-contents: a top-level bullet with a long rule plus two indented
// bullets with shorter rules — reads as a document structure, distinct from the flat
// "list" toolbar icon. No explicit size so it inherits Vditor's 15px svg sizing.
const outlineIcon =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M2 2.25a1 1 0 100 2 1 1 0 000-2zM5 2.5a.75.75 0 000 1.5h9a.75.75 0 000-1.5H5zM4 7a1 1 0 100 2 1 1 0 000-2zM7 7.25a.75.75 0 000 1.5h7a.75.75 0 000-1.5H7zM4 11.75a1 1 0 100 2 1 1 0 000-2zM7 12a.75.75 0 000 1.5h7a.75.75 0 000-1.5H7z"/></svg>'

interface ToolbarOptions {
  wikiEnabled?: boolean
}

export function createToolbar(options: ToolbarOptions = {}) {
  const toolbarItems = [
    'emoji',
    'headings',
    'bold',
    'italic',
    'strike',
    {
      hotkey: '⌘K',
      icon: '<svg><use xlink:href="#vditor-icon-link"></use></svg>',
      name: 'link',
      click() {
        insertMarkdownLink()
      },
      tipPosition: 'n',
    },
    '|',
    'list',
    'ordered-list',
    'check',
    'outdent',
    'indent',
    '|',
    'quote',
    'line',
    'code',
    'inline-code',
    'insert-before',
    'insert-after',
    '|',
    'upload',
    'table',
    '|',
    'undo',
    'redo',
    '|',
    { name: 'outline', icon: outlineIcon },
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
      toolbar: [
        'both',
        // content-theme + code-theme pickers dropped from the toolbar — VS Code
        // manages the theme: content follows the editor colours, and the code
        // block highlight is the `markdown-editor.codeTheme` setting.
        // outline + preview promoted to the main toolbar.
        {
          name: 'settings',
          tip: 'Settings',
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
        { name: 'info', tip: 'About Vditor' },
        {
          name: 'about',
          tip: 'About vMarkd',
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
