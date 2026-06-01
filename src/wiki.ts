import * as NodePath from 'node:path'
import * as vscode from 'vscode'

const WikiFolderName = 'wiki'
const SupportedMarkdownExtensions = new Set(['.md', '.markdown'])

export interface WikiDocumentContext {
  enabled: boolean
  rootLabel?: string
}

export type WikiLinkResolution =
  | { kind: 'disabled' }
  | { kind: 'invalid' }
  | { kind: 'missing'; key: string; root: vscode.Uri }
  | {
      kind: 'ambiguous'
      key: string
      root: vscode.Uri
      candidates: vscode.Uri[]
    }
  | { kind: 'resolved'; key: string; root: vscode.Uri; target: vscode.Uri }

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

  let current = NodePath.dirname(uri.fsPath)
  while (true) {
    if (NodePath.basename(current).toLowerCase() === WikiFolderName) {
      return vscode.Uri.file(current)
    }

    const parent = NodePath.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

export async function resolveWikiLink(
  sourceUri: vscode.Uri,
  rawTarget: string,
): Promise<WikiLinkResolution> {
  const root = getWikiRoot(sourceUri)
  if (!root) {
    return { kind: 'disabled' }
  }

  const targetKey = normalizeWikiLookupKey(extractWikiTarget(rawTarget))
  if (!targetKey) {
    return { kind: 'invalid' }
  }

  const files = await collectWikiMarkdownFiles(root)
  const matches = files.filter((candidate) =>
    getWikiKeys(root, candidate).includes(targetKey),
  )
  matches.sort((left, right) => left.fsPath.localeCompare(right.fsPath))

  if (matches.length === 0) {
    return {
      kind: 'missing',
      key: targetKey,
      root,
    }
  }

  if (matches.length > 1) {
    return {
      kind: 'ambiguous',
      key: targetKey,
      root,
      candidates: matches,
    }
  }

  return {
    kind: 'resolved',
    key: targetKey,
    root,
    target: matches[0],
  }
}

function isSupportedMarkdownUri(uri: vscode.Uri) {
  return SupportedMarkdownExtensions.has(
    NodePath.extname(uri.path).toLowerCase(),
  )
}

function extractWikiTarget(rawTarget: string) {
  const [target] = rawTarget.split('|', 1)
  return target.trim()
}

function stripMarkdownExtension(value: string) {
  return value.replace(/\.(?:md|markdown)$/i, '')
}

function normalizeWikiSegment(value: string) {
  return stripMarkdownExtension(value)
    .trim()
    .toLowerCase()
    .replace(/[ _]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeWikiLookupKey(value: string) {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => normalizeWikiSegment(segment))
    .filter(Boolean)
    .join('/')
}

function getWikiKeys(root: vscode.Uri, candidate: vscode.Uri) {
  const extension = NodePath.extname(candidate.fsPath)
  const basename = NodePath.basename(candidate.fsPath, extension)
  const relativePath = NodePath.relative(root.fsPath, candidate.fsPath).replace(
    /\\/g,
    '/',
  )
  const relativeWithoutExtension = relativePath.slice(0, -extension.length)

  return Array.from(
    new Set(
      [
        normalizeWikiLookupKey(relativeWithoutExtension),
        normalizeWikiLookupKey(basename),
      ].filter(Boolean),
    ),
  )
}

export async function collectWikiMarkdownFiles(root: vscode.Uri) {
  const results: vscode.Uri[] = []
  const queue: vscode.Uri[] = [root]

  while (queue.length) {
    const current = queue.shift()
    if (!current) {
      continue
    }

    const entries = await vscode.workspace.fs.readDirectory(current)
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

export async function getWikiPageKeys(root: vscode.Uri): Promise<string[]> {
  const files = await collectWikiMarkdownFiles(root)
  const keys = new Set<string>()
  for (const file of files) {
    for (const key of getWikiKeys(root, file)) {
      keys.add(key)
    }
  }
  return Array.from(keys)
}
