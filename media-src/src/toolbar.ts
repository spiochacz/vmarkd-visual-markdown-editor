import { t } from "./lang"
import { confirm } from "./utils"

function getEditorRange(): Range | undefined {
	const mode = vditor.getCurrentMode()
	const editor = vditor.vditor?.[mode]?.element as HTMLElement | undefined
	const selection = window.getSelection()

	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0)
		if (editor?.contains(range.commonAncestorContainer) || editor?.isEqualNode(range.commonAncestorContainer as Node)) {
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

const editInVsCodeIcon =
	'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M6 2h8.6L19 6.4V11h-2V7h-3V4H8v16h6v2H6z"/><path fill="currentColor" d="M13 13h5.17l-1.58-1.59L18 10l4 4-4 4-1.41-1.41L18.17 15H13z"/></svg>'

const wikiPagesIcon =
	'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M5 4.25A2.25 2.25 0 0 1 7.25 2h9.5A2.25 2.25 0 0 1 19 4.25v15.5A2.25 2.25 0 0 1 16.75 22h-9.5A2.25 2.25 0 0 1 5 19.75zm2 1.25v13h10V5.5zm1.22 2h1.24l1.12 4.4 1.2-4.4h1l1.18 4.4 1.13-4.4h1.24L14.9 16h-1.03l-1.38-4.97L11.07 16H10z"/></svg>'

const backIcon =
	'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z"/></svg>'

const settingsIcon =
	'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/><path fill="currentColor" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.03 7.03 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.42.32.61.22l2.49-1c.52.39 1.08.73 1.69.98l.38 2.65c.04.24.25.42.49.42h4c.24 0 .45-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65z"/></svg>'

interface ToolbarOptions {
	wikiEnabled?: boolean
}

export function createToolbar(options: ToolbarOptions = {}) {
	const toolbarItems = [
	{
	  hotkey: '⌘s',
	  name: 'save',
	  tipPosition: 's',
	  tip: t('save'),
	  className: 'save',
	  icon:
		'<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M810.667 938.667H213.333a128 128 0 01-128-128V213.333a128 128 0 01128-128h469.334a42.667 42.667 0 0130.293 12.374L926.293 311.04a42.667 42.667 0 0112.374 30.293v469.334a128 128 0 01-128 128zm-597.334-768a42.667 42.667 0 00-42.666 42.666v597.334a42.667 42.667 0 0042.666 42.666h597.334a42.667 42.667 0 0042.666-42.666v-451.84l-188.16-188.16z"/><path d="M725.333 938.667A42.667 42.667 0 01682.667 896V597.333H341.333V896A42.667 42.667 0 01256 896V554.667A42.667 42.667 0 01298.667 512h426.666A42.667 42.667 0 01768 554.667V896a42.667 42.667 0 01-42.667 42.667zM640 384H298.667A42.667 42.667 0 01256 341.333V128a42.667 42.667 0 0185.333 0v170.667H640A42.667 42.667 0 01640 384z"/></svg>',
	  click() {
		vscode.postMessage({
		  command: 'save',
		  content: vditor.getValue(),
		})
	  },
	},

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
	    ]
	  : []),
	{
	  name: 'settings',
	  tipPosition: 's',
	  tip: 'Settings',
	  className: 'right',
	  icon: settingsIcon,
	  click() {
		vscode.postMessage({
		  command: 'open-settings',
		})
	  },
	},
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
	{name:'edit-mode', tipPosition: 'e',},
	{
	  name: 'more',
	  tipPosition: 'e',
	  toolbar: [
		'both',
		'code-theme',
		'content-theme',
		'outline',
		'preview',
		{
		  name: 'copy-markdown',
		  icon: t('copyMarkdown'),
		  async click() {
			try {
			  await navigator.clipboard.writeText(vditor.getValue())
			  vscode.postMessage({
				command: 'info',
				content: 'Copy Markdown successfully!',
			  })
			} catch (error) {
			  vscode.postMessage({
				command: 'error',
				content: `Copy Markdown failed! ${error.message}`,
			  })
			}
		  },
		},
		{
		  name: 'copy-html',
		  icon: t('copyHtml'),
		  async click() {
			try {
			  await navigator.clipboard.writeText(vditor.getHTML())
			  vscode.postMessage({
				command: 'info',
				content: 'Copy HTML successfully!',
			  })
			} catch (error) {
			  vscode.postMessage({
				command: 'error',
				content: `Copy HTML failed! ${error.message}`,
			  })
			}
		  },
		},
		{
		  name: 'reset-config',
		  icon: t('resetConfig'),
		  async click() {
			confirm(t('resetConfirm'), async () => {
			  try {
				await vscode.postMessage({
				  command: 'reset-config',
				})
				await vscode.postMessage({
				  command: 'ready',
				})
				vscode.postMessage({
				  command: 'info',
				  content: 'Reset config successfully!',
				})
			  } catch (error) {
				vscode.postMessage({
				  command: 'error',
				  content: 'Reset config failed!',
				})
			  }
			})
		  },
		},
		'devtools',
		'info',
		'help',
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
