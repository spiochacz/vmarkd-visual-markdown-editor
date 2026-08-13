import NodePath from 'node:path'
import * as vscode from 'vscode'
import {
  cfgFor,
  collectConfigOptions,
  effectiveThemeKind,
  readExternalCss,
  resolveExternalCssPaths,
} from '../platform/editor-config'
import type { HostMessage } from '../shared/protocol'

interface PanelConfigDeps {
  getActiveUri: () => vscode.Uri
  postMessage: (msg: HostMessage) => void
}

// Task 405 — the panel's config/external-CSS push (postExternalCss / postLiveConfig /
// refreshExternalCssWatchers), extracted out of EditorSession. Does NOT own the panel's
// `disposables` array — `refreshExternalCssWatchers()` RETURNS the new watcher disposable
// (or undefined when there are no external CSS files) so the caller decides whether/where
// to register it, matching the original method's push-only-when-created behaviour exactly.
export class PanelConfigController {
  private externalCssWatcher: vscode.Disposable | undefined

  constructor(private readonly deps: PanelConfigDeps) {}

  postExternalCss(): void {
    this.deps.postMessage({
      command: 'reload-css',
      id: 'external-css',
      css: readExternalCss(this.deps.getActiveUri()),
    })
  }

  // Live config reload (tasks 12/26): push config-driven body options + CSS to the
  // open editor (no Vditor re-init, so cursor/scroll are preserved).
  postLiveConfig(): void {
    const uri = this.deps.getActiveUri()
    this.deps.postMessage({
      command: 'config-changed',
      options: collectConfigOptions(uri),
      // Effective light/dark mode so a live theme.content change re-themes the
      // editor (mode + code) without a reopen (task 82).
      theme: effectiveThemeKind(uri),
    })
    this.deps.postMessage({
      command: 'reload-css',
      id: 'custom-css',
      css: cfgFor(uri).get<string>('css.custom') || '',
    })
    this.postExternalCss()
  }

  // Returns the freshly-created watcher disposable (undefined when there are no external
  // CSS files configured) — the caller pushes it into ITS OWN disposables array.
  refreshExternalCssWatchers(): vscode.Disposable | undefined {
    this.externalCssWatcher?.dispose()
    const paths = resolveExternalCssPaths(this.deps.getActiveUri())
    if (paths.length === 0) {
      this.externalCssWatcher = undefined
      return undefined
    }
    this.externalCssWatcher = vscode.Disposable.from(
      ...paths.map((p) => {
        // Task 520 — MUST be a RelativePattern, not the bare path string. `resolveExternalCssPaths`
        // returns ABSOLUTE paths, and VS Code matches a string GlobPattern against
        // workspace-RELATIVE paths, so an absolute string matches nothing: the watcher constructs
        // fine, returns a disposable, and then never fires. A RelativePattern anchored on the
        // file's own directory also covers stylesheets outside every workspace folder, which the
        // string form could never watch.
        const w = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(
            vscode.Uri.file(NodePath.dirname(p)),
            NodePath.basename(p),
          ),
        )
        return vscode.Disposable.from(
          w,
          w.onDidChange(() => this.postExternalCss()),
          w.onDidCreate(() => this.postExternalCss()),
          w.onDidDelete(() => this.postExternalCss()),
        )
      }),
    )
    return this.externalCssWatcher
  }
}
