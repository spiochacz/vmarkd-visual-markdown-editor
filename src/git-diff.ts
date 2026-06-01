// Host-side git-gutter support (task 17): read a file's git-HEAD blob and a
// debounced scheduler that computes the HEAD↔current diff and posts it to the
// webview. The actual line diff is the dependency-free computeDiffChanges
// (diff-lines.ts). The git-extension dependency is injected so this is unit
// testable without a real Extension Host.

import * as NodePath from 'node:path'
import { computeDiffChanges, type DiffChange } from './diff-lines'

// Don't diff giant files — the gutter is block-level anyway and the LCS cost
// isn't worth it past this size.
export const MAX_DIFF_CONTENT_SIZE = 1_000_000

interface ExtensionsLike {
  getExtension(id: string): any
}

// The HEAD content of `fsPath` via the built-in `vscode.git` extension API, or
// null when: git isn't available, the file is in no repo, or the blob can't be
// read (untracked / brand-new file). Never throws.
export async function getHeadContent(
  fsPath: string,
  extensions: ExtensionsLike,
): Promise<string | null> {
  try {
    const gitExtension = extensions.getExtension('vscode.git')
    if (!gitExtension) return null
    const exports = gitExtension.isActive
      ? gitExtension.exports
      : await gitExtension.activate()
    const git = exports?.getAPI?.(1)
    const repo = git?.repositories?.find((r: any) => {
      const root = r.rootUri.fsPath
      return fsPath === root || fsPath.startsWith(root + NodePath.sep)
    })
    if (!repo) return null
    const rel = NodePath.relative(repo.rootUri.fsPath, fsPath)
    const content = await repo.show('HEAD', rel)
    return typeof content === 'string' && content.length > 0 ? content : null
  } catch {
    return null
  }
}

export type DiffComputer = (currentContent: string) => Promise<DiffChange[]>

// Combine HEAD lookup + line diff into a single computer bound to a file.
export function makeDiffComputer(
  fsPath: string,
  extensions: ExtensionsLike,
): DiffComputer {
  return async (currentContent: string) => {
    if (currentContent.length > MAX_DIFF_CONTENT_SIZE) return []
    const head = await getHeadContent(fsPath, extensions)
    if (head === null) return []
    return computeDiffChanges(head, currentContent)
  }
}

// Debounced diff scheduler: collapses rapid edits, skips recompute when the
// content is unchanged since the last run, swallows compute errors, and posts
// `{ command: 'diff-info', changes }` to the webview.
export function createDiffScheduler(
  post: (msg: { command: 'diff-info'; changes: DiffChange[] }) => void,
  compute: DiffComputer,
  delayMs = 300,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastContent: string | undefined

  return (content: string) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      timer = undefined
      if (content === lastContent) return
      lastContent = content
      try {
        const changes = await compute(content)
        post({ command: 'diff-info', changes })
      } catch {
        /* diff failed — leave existing markers untouched */
      }
    }, delayMs)
  }
}
