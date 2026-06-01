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

// Toolbar icons restyled to VS Code codicons (task 44). codicons are MIT-licensed;
// these <path> data are lifted from the codicon source. The matching toolbar
// title-bar buttons use the same codicon names ($(go-to-file)/$(settings-gear)).
const editInVsCodeIcon =
	'<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.58594 1.00098C8.98394 1.00098 9.36646 1.15943 9.64746 1.44043L12.5605 4.35352C12.8415 4.63552 13.001 5.01704 13.001 5.41504V13.001C13.001 14.106 12.106 15.001 11.001 15.001H5.00098C3.89599 15.001 3.00098 14.106 3.00098 13.001V6.00098H4.00098V13.001C4.00098 13.553 4.44899 14.001 5.00098 14.001H11.001C11.553 14.001 12.001 13.553 12.001 13.001V6.00098H9.50098C8.67299 6.00096 8.00098 5.32897 8.00098 4.50098V2.00098C7.99198 1.97699 7.98265 1.9527 7.97266 1.92871C7.89674 1.74704 7.78717 1.5812 7.64746 1.44238L7.20605 1.00098H8.58594ZM9 4.5C9 4.776 9.224 5 9.5 5H11.793L9 2.20703V4.5Z"/><path fill="currentColor" d="M4.5 0C4.63299 0 4.75952 0.0534683 4.85352 0.147461L6.85352 2.14746C6.90042 2.19336 6.93789 2.24775 6.96289 2.30859C6.98789 2.36959 7.00097 2.43498 7.00098 2.50098C7.00098 2.56698 6.98789 2.63236 6.96289 2.69336C6.93789 2.75323 6.90043 2.80956 6.85352 2.85547L4.85352 4.85547C4.75956 4.94917 4.63278 5.00195 4.5 5.00195C4.36722 5.00195 4.24044 4.94917 4.14648 4.85547C4.05248 4.76147 3.99902 4.63398 3.99902 4.50098C3.99903 4.36799 4.05249 4.24146 4.14648 4.14746L5.29297 3.00098H2.5C2.10201 3.00098 1.72045 3.15944 1.43945 3.44043C1.15846 3.72242 1.00001 4.10298 1 4.50098V5.50098C1 5.63398 0.947516 5.76147 0.853516 5.85547C0.759563 5.94817 0.632774 6.00098 0.5 6.00098C0.367225 6.00098 0.240437 5.94917 0.146484 5.85547C0.0534844 5.76147 0 5.63398 0 5.50098V4.50098C6.17892e-06 3.83799 0.263427 3.20239 0.732422 2.7334C1.20142 2.26441 1.83701 2.00098 2.5 2.00098H5.29297L4.14648 0.855469C4.05248 0.761469 3.99902 0.633977 3.99902 0.500977C3.99903 0.367985 4.05249 0.241455 4.14648 0.147461C4.24048 0.0534683 4.36701 0 4.5 0Z"/></svg>'

const wikiPagesIcon =
	'<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M2.5 2C1.67157 2 1 2.67157 1 3.5V12.5C1 13.3284 1.67157 14 2.5 14H6C6.8178 14 7.54389 13.6073 8 13.0002C8.45612 13.6073 9.1822 14 10 14H13.5C14.3284 14 15 13.3284 15 12.5V3.5C15 2.67157 14.3284 2 13.5 2H10C9.1822 2 8.45612 2.39267 8 2.99976C7.54389 2.39267 6.8178 2 6 2H2.5ZM7.5 4.5V11.5C7.5 12.3284 6.82843 13 6 13H2.5C2.22386 13 2 12.7761 2 12.5V3.5C2 3.22386 2.22386 3 2.5 3H6C6.82843 3 7.5 3.67157 7.5 4.5ZM8.5 11.5V4.5C8.5 3.67157 9.17157 3 10 3H13.5C13.7761 3 14 3.22386 14 3.5V12.5C14 12.7761 13.7761 13 13.5 13H10C9.17157 13 8.5 12.3284 8.5 11.5Z"/></svg>'

const backIcon =
	'<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z"/></svg>'

const settingsIcon =
	'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M12 9C10.3425 9 9.00002 10.3425 9.00002 12C9.00002 13.6575 10.3425 15 12 15C13.6575 15 15 13.6575 15 12C15 10.3425 13.6575 9 12 9ZM12 13.5C11.172 13.5 10.5 12.828 10.5 12C10.5 11.172 11.172 10.5 12 10.5C12.828 10.5 13.5 11.172 13.5 12C13.5 12.828 12.828 13.5 12 13.5ZM21.8475 14.5725L19.9185 12.942C19.8675 12.8985 19.8195 12.8505 19.776 12.7995C19.332 12.279 19.3965 11.5005 19.9185 11.058L21.8475 9.4275C22.0395 9.2655 22.113 9.0045 22.0365 8.766C21.579 7.3545 20.823 6.06 19.8285 4.962C19.7085 4.83 19.5405 4.758 19.368 4.758C19.2975 4.758 19.227 4.77 19.1595 4.794L16.779 5.6415C16.716 5.664 16.65 5.682 16.584 5.694C16.509 5.7075 16.434 5.715 16.3605 5.715C15.7725 5.715 15.2505 5.298 15.141 4.701L14.6865 2.223C14.6415 1.977 14.451 1.782 14.205 1.7295C13.485 1.5765 12.7485 1.5 12.0015 1.5C11.2545 1.5 10.5165 1.578 9.79652 1.7295C9.55052 1.782 9.36002 1.977 9.31502 2.223L8.86202 4.701C8.85002 4.767 8.83202 4.8315 8.80952 4.8945C8.62802 5.4 8.15102 5.715 7.64102 5.715C7.50302 5.715 7.36202 5.691 7.22402 5.643L4.84352 4.7955C4.77602 4.7715 4.70402 4.7595 4.63502 4.7595C4.46252 4.7595 4.29452 4.8315 4.17452 4.9635C3.17852 6.0615 2.42402 7.356 1.96502 8.7675C1.88702 9.006 1.96202 9.267 2.15402 9.429L4.08302 11.0595C4.13402 11.103 4.18202 11.151 4.22552 11.202C4.66952 11.7225 4.60502 12.501 4.08302 12.9435L2.15402 14.574C1.96202 14.736 1.88852 14.997 1.96502 15.2355C2.42252 16.647 3.17852 17.9415 4.17452 19.0395C4.29452 19.1715 4.46252 19.2435 4.63502 19.2435C4.70552 19.2435 4.77602 19.2315 4.84352 19.2075L7.22402 18.36C7.28702 18.3375 7.35302 18.3195 7.41902 18.3075C7.49402 18.294 7.56902 18.288 7.64252 18.288C8.23052 18.288 8.75252 18.705 8.86202 19.302L9.31502 21.78C9.36002 22.026 9.55052 22.221 9.79652 22.2735C10.5165 22.4265 11.2545 22.503 12.0015 22.503C12.7485 22.503 13.4865 22.425 14.205 22.2735C14.451 22.221 14.6415 22.026 14.6865 21.78L15.141 19.302C15.153 19.236 15.171 19.1715 15.1935 19.1085C15.375 18.603 15.852 18.288 16.362 18.288C16.5 18.288 16.641 18.312 16.779 18.36L19.158 19.2075C19.227 19.2315 19.2975 19.2435 19.3665 19.2435C19.539 19.2435 19.707 19.1715 19.827 19.0395C20.823 17.9415 21.5775 16.647 22.035 15.2355C22.113 14.997 22.038 14.736 21.846 14.574L21.8475 14.5725ZM19.092 17.589L17.2815 16.944C16.9845 16.839 16.6755 16.785 16.362 16.785C15.2085 16.785 14.1705 17.514 13.782 18.5985C13.731 18.738 13.6935 18.882 13.6665 19.029L13.3215 20.9055C12.8865 20.9685 12.444 21 12.0015 21C11.559 21 11.1165 20.9685 10.68 20.904L10.3365 19.0275C10.098 17.727 8.96552 16.7835 7.64252 16.7835C7.48052 16.7835 7.31552 16.7985 7.14902 16.8285C7.00352 16.8555 6.86102 16.893 6.72002 16.9425L4.90952 17.5875C4.35752 16.896 3.91652 16.1385 3.59102 15.321L5.05202 14.0865C5.61152 13.614 5.95202 12.951 6.01202 12.222C6.07202 11.493 5.84252 10.785 5.36702 10.227C5.27102 10.1145 5.16452 10.008 5.05202 9.912L3.59102 8.6775C3.91652 7.86 4.35752 7.101 4.90952 6.411L6.72002 7.056C7.01702 7.161 7.32602 7.215 7.64102 7.215C8.79452 7.215 9.83252 6.486 10.221 5.4015C10.272 5.2605 10.3095 5.1165 10.3365 4.971L10.68 3.0945C11.1165 3.0315 11.559 2.9985 12.0015 2.9985C12.444 2.9985 12.8865 3.03 13.3215 3.093L13.665 4.9695C13.9035 6.27 15.036 7.2135 16.359 7.2135C16.521 7.2135 16.686 7.1985 16.851 7.1685C16.9965 7.1415 17.1405 7.104 17.2815 7.0545L19.092 6.4095C19.644 7.0995 20.085 7.8585 20.4105 8.676L18.951 9.9105C18.3915 10.383 18.0495 11.046 17.991 11.775C17.931 12.504 18.1605 13.2135 18.636 13.77C18.7335 13.884 18.8385 13.989 18.9525 14.085L20.4135 15.3195C20.088 16.137 19.647 16.896 19.095 17.586L19.092 17.589Z"/></svg>'

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
		'<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="currentColor" d="M14.414 3.207L12.793 1.586C12.421 1.213 11.905 1 11.379 1H3C1.897 1 1 1.897 1 3V13C1 14.103 1.897 15 3 15H13C14.103 15 15 14.103 15 13V4.621C15 4.095 14.787 3.579 14.414 3.207ZM9 2V3.5C9 3.776 8.776 4 8.5 4H6.5C6.224 4 6 3.776 6 3.5V2H9ZM5 14V9.5C5 9.224 5.224 9 5.5 9H10.5C10.776 9 11 9.224 11 9.5V14H5ZM14 13C14 13.551 13.551 14 13 14H12V9.5C12 8.673 11.327 8 10.5 8H5.5C4.673 8 4 8.673 4 9.5V14H3C2.449 14 2 13.551 2 13V3C2 2.449 2.449 2 3 2H5V3.5C5 4.327 5.673 5 6.5 5H8.5C9.327 5 10 4.327 10 3.5V2H11.379C11.642 2 11.9 2.107 12.086 2.293L13.707 3.914C13.893 4.1 14 4.358 14 4.621V13Z"/></svg>',
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
