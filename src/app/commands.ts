import * as vscode from 'vscode'
import type { HeadingItem } from '../markdown/outline-tree'
import {
  findTabForUri,
  getCommandTarget,
  isDiffContextForUri,
  isSupportedMarkdownUri,
} from '../platform/tab-targeting'
import { MarkdownEditorViewType } from '../shared/editor-view-type'
import {
  FORMAT_HOTKEYS,
  UNBOUND_FORMAT_COMMANDS,
} from '../shared/format-hotkeys'

// What the commands need from extension.ts, injected so this module needn't import
// (and cycle with) the provider or the module-level logger/reveal helpers.
interface CommandDeps {
  debug: (...args: unknown[]) => void
  showError: (msg: string) => void
  revealCaretInSource: (
    panel: vscode.WebviewPanel,
    docUri: vscode.Uri,
    viewColumn: vscode.ViewColumn,
  ) => Promise<void>
  findPanelForUri: (
    uri: vscode.Uri,
  ) => { panel: vscode.WebviewPanel } | undefined
}

// The open* commands share this target-resolve + guard prologue. The guard SET varies by
// command (openEditor/openInSplit reject diff + require a supported md uri; openTextEditor
// only needs a target; openSourceToSide requires a supported uri but tolerates diff), so
// the two optional guards are toggled by flags — the check order (not-found → diff →
// supported) and error messages are preserved exactly. Returns undefined (after showing the
// matching error) when a guard fails, so the caller bails.
function resolveOpenTarget(
  uri: vscode.Uri | undefined,
  deps: CommandDeps,
  opts: { rejectDiff?: boolean; requireSupported?: boolean },
): vscode.Uri | undefined {
  const target = getCommandTarget(uri)
  if (!target) {
    deps.showError(`Cannot find markdown file!`)
    return undefined
  }
  if (opts.rejectDiff && isDiffContextForUri(target)) {
    deps.showError(`Markdown editor is unavailable in diff editors.`)
    return undefined
  }
  if (opts.requireSupported && !isSupportedMarkdownUri(target)) {
    deps.showError(`Markdown editor can only open local markdown files.`)
    return undefined
  }
  return target
}

// Resolve the panel for the active editor's document — shared by the host-triggered commands
// below (paste-plain, activate-link-at-caret, fix/renormalize list numbering) that have no view
// of the live caret/selection themselves: they just forward their trigger to whichever panel is
// showing the active editor's document, same target-resolve pattern as `vmarkd.pastePlain`'s
// original comment describes. Task 502 — jscpd flagged 4 near-identical copies of this
// uri-then-panel resolve (differing only in which `command` each then posts).
function resolveActivePanel(
  deps: CommandDeps,
): { panel: vscode.WebviewPanel } | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri
  const target = uri ?? resolveOpenTarget(undefined, deps, {})
  if (!target) return undefined
  return deps.findPanelForUri(target)
}

// openEditor and openInSplit resolve their target with the exact same debug+guard call
// (reject diff editors, require a supported markdown uri) before diverging on which
// `vscode.openWith` variant to run. Task 502 — jscpd flagged the byte-identical copy.
function resolveSupportedEditorTarget(
  uri: vscode.Uri | undefined,
  args: unknown[],
  deps: CommandDeps,
): vscode.Uri | undefined {
  deps.debug('command', uri, args)
  return resolveOpenTarget(uri, deps, {
    rejectDiff: true,
    requireSupported: true,
  })
}

// Task 505 — one entry per PROMOTED Vditor formatting hotkey PLUS undo/redo (command registered,
// no keybinding — see `format-hotkeys.ts`'s `UNBOUND_FORMAT_COMMANDS` header for why), each a real
// VS Code command so it's discoverable in the Command Palette (and, for the 12 in FORMAT_HOTKEYS,
// rebindable in the Keyboard Shortcuts UI via `contributes.keybindings`) — same discoverability/
// rebind-fallback framing as `vmarkd.activateLinkAtCaret` above. `toolbarName` is the name Vditor's
// own `vditor.toolbar.elements` is keyed by; every command below posts the SAME
// `trigger-toolbar-hotkey` message and lets the webview dispatch a click on that toolbar item's
// button (message-router.ts), reusing Vditor's own formatting/undo/redo logic rather than
// reimplementing it host-side.
//
// Derived from the shared table (`../shared/format-hotkeys`) rather than hand-written, so a
// renamed/added/removed row can't drift between the command registration loop and the toolbar/
// package.json consumers — see that module's header for the full one-owner-per-key design and
// task 505 for the collision-bucket research behind the FINAL 12-key set (up one from Phase 4's
// promoted-with-a-key count of 11, since `headings` is newly promoted here — task 505 reclassified
// its Ctrl+H collision, VS Code's Find & Replace, as an accepted editor-level collision, see
// `format-hotkeys.ts` — but down from Phase 4's total of 13 registered commands, since undo/redo
// move to command-registered-but-unbound: `undo-keybind.ts` already owns their keys end-to-end).
// `link`, `table`, `line` (HR), `insert-before`, `insert-after`, `emoji` have no command at all —
// toolbar/mouse-only, matching "Markdown All in One"'s own restraint researched in 492.
// `fullscreen` (⌘') and `both` (⌘P, still live via Vditor's submenu hotkey fallback — pre-existing,
// out of scope) were never in scope either.
export const FORMAT_COMMANDS: readonly {
  command: string
  toolbarName: string
}[] = [
  ...FORMAT_HOTKEYS.map(({ command, toolbarName }) => ({
    command,
    toolbarName,
  })),
  ...UNBOUND_FORMAT_COMMANDS,
]

export function registerCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps,
) {
  for (const { command, toolbarName } of FORMAT_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        const entry = resolveActivePanel(deps)
        if (!entry) return
        entry.panel.webview.postMessage({
          command: 'trigger-toolbar-hotkey',
          name: toolbarName,
        })
      }),
    )
  }
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vmarkd.openEditor',
      async (uri?: vscode.Uri, ...args) => {
        const target = resolveSupportedEditorTarget(uri, args, deps)
        if (!target) return
        // Reveal an existing vMarkd tab for this file instead of opening a
        // duplicate (task 36): target its own column so VS Code focuses it.
        const existing = findTabForUri(target, 'custom')
        if (existing) {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            target,
            MarkdownEditorViewType,
            { viewColumn: existing.group.viewColumn },
          )
          return
        }
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          MarkdownEditorViewType,
        )
      },
    ),
    vscode.commands.registerCommand(
      'vmarkd.openInSplit',
      async (uri?: vscode.Uri, ...args) => {
        const target = resolveSupportedEditorTarget(uri, args, deps)
        if (!target) return
        // Open the visual editor beside the current view (task 10).
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          MarkdownEditorViewType,
          vscode.ViewColumn.Beside,
        )
      },
    ),
    vscode.commands.registerCommand(
      'vmarkd.openTextEditor',
      async (uri?: vscode.Uri, ...args) => {
        deps.debug('command', uri, args)
        const target = resolveOpenTarget(uri, deps, {})
        if (!target) return
        await vscode.commands.executeCommand(
          'vscode.openWith',
          target,
          'default',
        )
      },
    ),
    vscode.commands.registerCommand(
      'vmarkd.openSourceToSide',
      async (uri?: vscode.Uri, ...args) => {
        deps.debug('command', uri, args)
        const target = resolveOpenTarget(uri, deps, { requireSupported: true })
        if (!target) return
        // Reuse an existing source tab (focus it in its column); otherwise open
        // the text view in the adjacent column (task 36). When this is invoked
        // from a live vMarkd editor for the same file, also jump to the caret's
        // line (task 16) — one button does both: open source to the side AND
        // reveal the cursor.
        const existing = findTabForUri(target, 'text')
        const viewColumn = existing
          ? existing.group.viewColumn
          : vscode.ViewColumn.Beside
        const panelEntry = deps.findPanelForUri(target)
        if (panelEntry) {
          await deps.revealCaretInSource(panelEntry.panel, target, viewColumn)
        } else {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            target,
            'default',
            { viewColumn },
          )
        }
      },
    ),
    // Task 287 — paste as plain text (Ctrl+Shift+V), the universal "paste without formatting"
    // chord. Driven from the HOST, not a capture-phase key handler in the webview, for a reason
    // that is not stylistic: a webview cannot read the system clipboard synchronously from a
    // keydown, and VS Code's own bridge answers Ctrl+V through a host round-trip anyway. The host
    // CAN read it, so it does — and this also sidesteps the chord being claimed elsewhere, since
    // the keybinding is scoped to `activeCustomEditorId == vmarkd.editor`.
    vscode.commands.registerCommand('vmarkd.pastePlain', async () => {
      // The custom editor's document is not an activeTextEditor, so resolve the panel from the
      // active tab instead — the same path the outline/reveal commands use.
      const entry = resolveActivePanel(deps)
      if (!entry) return
      const text = await vscode.env.clipboard.readText()
      if (!text) return
      entry.panel.webview.postMessage({ command: 'paste-plain', text })
    }),
    // Task 457/459 — Ctrl/Cmd+Enter, registered as a real VS Code command (not only a webview key
    // handler) so the binding is discoverable + rebindable in the Keyboard Shortcuts UI (decision
    // 4). Same target-resolve pattern as `vmarkd.pastePlain` above. The command/message names are
    // unchanged from task 457 (`vmarkd.activateLinkAtCaret` / `activate-link-at-caret`) even though
    // the chord's scope has since widened to callouts too (task 459's unification onto this SAME
    // chord, replacing its own Ctrl/Cmd+Alt+Enter) — renaming would have re-verified nothing (the
    // webview's own capture-phase keydown listener is the primary path; this command is the
    // discoverability/rebind fallback) while touching a passing e2e spec for no functional gain.
    // The webview's OWN Ctrl/Cmd+Enter keydown listener (util/caret-gesture.ts) already activates
    // whatever is under the caret directly — this command posts the SAME trigger to the webview via
    // `activate-link-at-caret`, so whichever trigger the real VS Code session actually resolves the
    // chord through, both land on the identical registered caret-gesture handlers (never two
    // implementations of the activation logic).
    vscode.commands.registerCommand('vmarkd.activateLinkAtCaret', async () => {
      const entry = resolveActivePanel(deps)
      if (!entry) return
      entry.panel.webview.postMessage({ command: 'activate-link-at-caret' })
    }),
    // Task 255 — "Fix list numbering" / "Renormalize all lists". Same resolve-panel-then-
    // postMessage pattern as `vmarkd.activateLinkAtCaret` above: the host has no view of the
    // live caret/selection, so it just forwards the trigger and the webview (which owns both)
    // does the actual work — silently no-op-ing when there's no list to normalize.
    // Task 522 — Ctrl/Cmd+F and Escape-while-find-is-visible route through these so the webview
    // learns the host find widget's state (it cannot observe it, and Electron's findInFrame focus
    // handshake otherwise lets the editor steal focus from the find box). Tell the webview FIRST,
    // then drive the built-in widget.
    vscode.commands.registerCommand('vmarkd.findOpen', async () => {
      resolveActivePanel(deps)?.panel.webview.postMessage({
        command: 'find-open',
      })
      await vscode.commands.executeCommand(
        'editor.action.webvieweditor.showFind',
      )
    }),
    vscode.commands.registerCommand('vmarkd.findClose', async () => {
      await vscode.commands.executeCommand(
        'editor.action.webvieweditor.hideFind',
      )
      resolveActivePanel(deps)?.panel.webview.postMessage({
        command: 'find-close',
      })
    }),
    vscode.commands.registerCommand('vmarkd.fixListNumbering', async () => {
      const entry = resolveActivePanel(deps)
      if (!entry) return
      entry.panel.webview.postMessage({ command: 'fix-list-numbering' })
    }),
    vscode.commands.registerCommand('vmarkd.renormalizeAllLists', async () => {
      const entry = resolveActivePanel(deps)
      if (!entry) return
      entry.panel.webview.postMessage({ command: 'renormalize-all-lists' })
    }),
    vscode.commands.registerCommand('vmarkd.openSettings', async () => {
      // Open the Settings UI filtered to this extension's options.
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:spiochacz.vmarkd',
      )
    }),
    vscode.commands.registerCommand(
      'vmarkd.outlineReveal',
      (item: HeadingItem) => {
        const panel = deps.findPanelForUri(item.documentUri)
        if (panel) {
          panel.panel.webview.postMessage({
            command: 'scroll-to-heading',
            index: item.index,
          })
          panel.panel.reveal?.(undefined, false)
        } else {
          // No open vMarkd webview — fall back to revealing the source line.
          void vscode.window.showTextDocument(item.documentUri).then((ed) => {
            const pos = new vscode.Position(item.line, 0)
            ed.selection = new vscode.Selection(pos, pos)
            ed.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.AtTop,
            )
          })
        }
      },
    ),
  )
}
