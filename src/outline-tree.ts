import * as vscode from 'vscode'

const ATX_HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/
const FENCE = /^(\s*)(`{3,}|~{3,})/

export interface ParsedHeading {
  level: number
  name: string
  line: number
  index: number
}

// Parse ATX headings, skipping fenced code blocks so a `# comment` inside a
// fence isn't mistaken for a heading. `index` is the heading's 0-based ordinal
// in document order — it lines up with the Nth rendered <h1-6> in the webview,
// which is how the reveal-on-click navigation finds the target.
export function parseHeadings(document: vscode.TextDocument): ParsedHeading[] {
  const out: ParsedHeading[] = []
  let fence: string | null = null
  let index = 0
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text
    const f = FENCE.exec(text)
    if (f) {
      const marker = f[2][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue
    const m = ATX_HEADING.exec(text)
    if (m) out.push({ level: m[1].length, name: m[2], line: i, index: index++ })
  }
  return out
}

export class HeadingItem extends vscode.TreeItem {
  children: HeadingItem[] = []
  constructor(
    public readonly heading: string,
    public readonly level: number,
    public readonly line: number,
    public readonly index: number,
    public readonly documentUri: vscode.Uri,
  ) {
    super(heading, vscode.TreeItemCollapsibleState.Expanded)
    this.command = {
      command: 'vmarkd.outlineReveal',
      title: 'Go to heading',
      arguments: [this],
    }
    this.iconPath = new vscode.ThemeIcon('symbol-string')
    this.tooltip = `H${level}: ${heading}`
  }
}

function buildTree(
  flat: ParsedHeading[],
  documentUri: vscode.Uri,
): HeadingItem[] {
  const root: HeadingItem[] = []
  const stack: Array<{ level: number; item: HeadingItem }> = []
  for (const h of flat) {
    const item = new HeadingItem(h.name, h.level, h.line, h.index, documentUri)
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop()
    }
    if (stack.length > 0) stack[stack.length - 1].item.children.push(item)
    else root.push(item)
    stack.push({ level: h.level, item })
  }
  return root
}

export class MarkdownOutlineProvider
  implements vscode.TreeDataProvider<HeadingItem>
{
  private _onDidChange = new vscode.EventEmitter<HeadingItem | undefined>()
  readonly onDidChangeTreeData = this._onDidChange.event
  private roots: HeadingItem[] = []
  private currentUri: vscode.Uri | undefined
  private lastSig = '\0'

  refresh(document: vscode.TextDocument | undefined): void {
    const flat = document ? parseHeadings(document) : []
    // Skip the (expensive) tree re-render when nothing changed — a rapid burst
    // of refresh() calls during a file switch would otherwise rebuild the whole
    // 300+ node tree several times and freeze the VS Code UI.
    const sig = document
      ? `${document.uri.toString()}|${flat.map((h) => `${h.level}:${h.line}:${h.name}`).join('\n')}`
      : ''
    this.currentUri = document?.uri
    this.roots = document && flat.length ? buildTree(flat, document.uri) : []
    if (sig === this.lastSig) return
    this.lastSig = sig
    this._onDidChange.fire(undefined)
  }

  get uri(): vscode.Uri | undefined {
    return this.currentUri
  }

  getTreeItem(el: HeadingItem): vscode.TreeItem {
    el.collapsibleState =
      el.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    return el
  }

  getChildren(el?: HeadingItem): HeadingItem[] {
    return el ? el.children : this.roots
  }
}
