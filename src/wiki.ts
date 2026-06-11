import * as NodePath from 'node:path'
import * as vscode from 'vscode'
import { wikiKeysForRelativePath } from './wiki-core'

export { normalizeWikiLookupKey } from './wiki-core'

const SupportedMarkdownExtensions = new Set(['.md', '.markdown'])

export interface WikiDocumentContext {
  enabled: boolean
  rootLabel?: string
}

function getWikiConfig() {
  const cfg = vscode.workspace.getConfiguration('vmarkd.wiki')
  const enabled = cfg.get<boolean>('enabled') !== false
  const rootPath = cfg.get<string>('root') ?? ''
  return { enabled, rootPath }
}

export function isWikiFile(uri: vscode.Uri | undefined) {
  return Boolean(uri && isSupportedMarkdownUri(uri) && getWikiRoot(uri))
}

export function getWikiDocumentContext(
  uri: vscode.Uri | undefined,
): WikiDocumentContext {
  const root = uri ? getWikiRoot(uri) : undefined
  if (!root) {
    return { enabled: false }
  }
  return {
    enabled: true,
    rootLabel: vscode.workspace.asRelativePath(root, false),
  }
}

export function getWikiRoot(uri: vscode.Uri) {
  if (uri.scheme !== 'file' || !isSupportedMarkdownUri(uri)) {
    return undefined
  }
  const { enabled, rootPath } = getWikiConfig()
  if (!enabled) return undefined

  const folder = vscode.workspace.getWorkspaceFolder(uri)
  if (!folder) return undefined

  // Explicit root → that subfolder. Empty root → workspace root.
  return rootPath ? vscode.Uri.joinPath(folder.uri, rootPath) : folder.uri
}

function isSupportedMarkdownUri(uri: vscode.Uri) {
  return SupportedMarkdownExtensions.has(
    NodePath.extname(uri.path).toLowerCase(),
  )
}

export function getWikiKeys(root: vscode.Uri, candidate: vscode.Uri) {
  const relativePath = NodePath.relative(root.fsPath, candidate.fsPath).replace(
    /\\/g,
    '/',
  )
  return wikiKeysForRelativePath(relativePath)
}

export async function collectWikiMarkdownFiles(root: vscode.Uri) {
  const results: vscode.Uri[] = []
  const queue: vscode.Uri[] = [root]

  while (queue.length) {
    const current = queue.shift()
    if (!current) continue

    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(current)
    } catch {
      // The directory may have vanished — e.g. a configured wiki root
      // (`vmarkd.wiki.root`) that no longer exists, or a subfolder removed
      // mid-scan. Treat it as empty instead of aborting the whole scan (which
      // would otherwise crash WikiCache.build → the editor session's onReady).
      continue
    }
    for (const [name, type] of entries) {
      const entryUri = vscode.Uri.joinPath(current, name)
      if ((type & vscode.FileType.Directory) !== 0) {
        queue.push(entryUri)
        continue
      }
      if (
        (type & vscode.FileType.File) !== 0 &&
        SupportedMarkdownExtensions.has(NodePath.extname(name).toLowerCase())
      ) {
        results.push(entryUri)
      }
    }
  }

  return results
}

export async function createWikiPage(
  root: vscode.Uri,
  key: string,
): Promise<vscode.Uri> {
  const newFileName = `${key.replace(/\//g, '-')}.md`
  const newFileUri = vscode.Uri.joinPath(root, newFileName)
  const heading = key
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
  await vscode.workspace.fs.writeFile(newFileUri, Buffer.from(`# ${heading}\n`))
  return newFileUri
}
