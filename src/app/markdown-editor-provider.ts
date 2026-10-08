import * as vscode from 'vscode'
import * as NodePath from 'node:path'
import * as os from 'node:os'
import {
  GIT_CONFLICT_MESSAGE,
  GIT_CONFLICT_OVERRIDE,
  hasGitConflictMarkers,
} from '../writeback/git-conflict'
import { type EditorMode, renderForMode } from '../lute/lute-host'
import { isWikiFile } from '../wiki/wiki'
import {
  buildWebviewHtml,
  hasCodeFence,
  hasMath,
  sanitizeCss,
} from '../webview-host/html-builder'
import { DiagramCache } from '../webview-host/diagram-cache-host'
import { resolveCodeStyle, resolveFontSize } from '../shared/theme-registry'
import { MarkdownEditorViewType } from '../shared/editor-view-type'
import { resolveOpenMode, shouldStream } from '../shared/open-mode'
import { resolveDefaultMode } from '../platform/default-mode'
import {
  cfgFor,
  effectiveContentTheme,
  extensionVersion,
  getAssetsFolder,
  getWebviewOptions,
  markdownPreviewFontFamily,
  readExternalCss,
  sanitizeVditorOptions,
  webviewRoots,
} from '../platform/editor-config'
import { activePanels, findPanelForUri } from '../platform/active-panels'
import { EditorSession } from '../session/editor-session'
import { KeyVditorOptions } from '../platform/state-keys'

// Random per-render nonce so only our own <script> tags are allowed to run
// under the CSP (task 18 §2c) — injected inline scripts (no nonce) cannot.
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let text = ''
  for (let i = 0; i < 32; i++)
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  return text
}

// Map the VS Code UI language (vscode.env.language, a lowercase BCP-47 tag like
// "en", "zh-cn", "pt-br") to the closest Vditor i18n bundle that ships under
// media/vditor/dist/js/i18n/*.js (de_DE, en_US, es_ES, fr_FR, ja_JP, ko_KR, pt_BR,
// ru_RU, sv_SE, vi_VN, zh_CN, zh_TW). Default en_US. The host injects the matching
// bundle into the webview HTML *before* main.js so `window.VditorI18n` is set when
// Vditor is constructed; with i18n inline Vditor skips its async i18n fetch and
// builds the editor (toolbar included) synchronously inside the constructor — so
// the toolbar can be cloned into the instant-paint overlay right away, instead of
// after an extra network round-trip (see media-src/src/main.ts).
export function resolveVditorI18nLang(envLang: string | undefined): string {
  const l = (envLang || 'en').toLowerCase().replace('_', '-')
  if (l === 'zh-tw' || l === 'zh-hant') return 'zh_TW'
  if (l.startsWith('zh')) return 'zh_CN'
  const byBase: Record<string, string> = {
    de: 'de_DE',
    en: 'en_US',
    es: 'es_ES',
    fr: 'fr_FR',
    ja: 'ja_JP',
    ko: 'ko_KR',
    pt: 'pt_BR',
    ru: 'ru_RU',
    sv: 'sv_SE',
    vi: 'vi_VN',
  }
  return byBase[l.split('-')[0]] ?? 'en_US'
}

export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  // Live registry of open vMarkd panels (task 16), extracted to active-panels.ts (task 405)
  // so EditorSession can reference it without importing this class. Kept as static aliases
  // here for backward compatibility (test-facing API, commands.ts's injected `findPanelForUri`).
  static activePanels = activePanels
  static findPanelForUri = findPanelForUri

  // Config/CSS reader logic lives as free functions in editor-config.ts (SRP). These
  // static aliases keep the test-facing API (test/backend/*) that calls them as
  // MarkdownEditorProvider.<name>; production call sites use the free functions directly.
  static webviewRoots = webviewRoots
  static getWebviewOptions = getWebviewOptions
  static sanitizeCss = sanitizeCss
  static sanitizeVditorOptions = sanitizeVditorOptions
  static getAssetsFolder = getAssetsFolder

  // Task 184 — the persistent diagram render cache, ONE instance per window session (the
  // extension host outlives every webview). Disk-backed under globalStorageUri; version-keyed
  // so an engine re-pin invalidates old SVGs. LAZY (built on first use, not in the ctor) so the
  // unit tests that construct the provider with a minimal mock context (no globalStorageUri)
  // don't trip on it; the disk is only touched on the first cache message anyway.
  private _diagramCache: DiagramCache | undefined
  private get diagramCache(): DiagramCache {
    if (!this._diagramCache) {
      const base =
        this._context.globalStorageUri?.fsPath ??
        NodePath.join(os.tmpdir(), 'vmarkd-diagram-cache')
      this._diagramCache = new DiagramCache({
        dir: NodePath.join(base, 'diagram-render-cache'),
        // Task 406 — the `:h64` suffix is a CACHE-FORMAT tag, independent of the extension's
        // user-facing version: it forces exactly one clean disk wipe the first time this ships,
        // so the 32-bit-hash entries a prior install wrote are never mixed with the new 64-bit
        // ones (harmless either way — different lengths never collide — but deliberate beats
        // accidental, per task 406's own ask). Bump the tag again only if hashOf's format changes.
        version: `${extensionVersion()}:h64`,
        // The real-VS-Code e2e suite shares one worker-scoped globalStorage across all tests, so a
        // stale cache HIT from an earlier spec breaks fresh-render specs order-dependently. Wipe per
        // test (a fresh VS Code launches per test). Never set outside the harness — defeats task 184.
        freshStart: !!process.env.VMARKD_E2E,
      })
      this._context.subscriptions?.push({
        dispose: () => this._diagramCache?.dispose(),
      })
    }
    return this._diagramCache
  }

  constructor(private readonly _context: vscode.ExtensionContext) {}

  // Files the user chose to open here anyway despite the conflict warning (task 241). Keyed by
  // fsPath and deliberately per-session: once the conflict is resolved and the file reopened
  // normally, the entry is simply never consulted again.
  private readonly _conflictOverrides = new Set<string>()

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ) {
    // Task 241: never build an editor over a merge-conflicted file. One IR round-trip mangles the
    // markers past git's recognition, so the check has to come BEFORE the session starts — there is
    // no safe read-only middle ground while the serializer is in the loop.
    if (
      !this._conflictOverrides.has(document.uri.fsPath) &&
      hasGitConflictMarkers(document.getText())
    ) {
      webviewPanel.dispose()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        document.uri,
        'default',
      )
      const choice = await vscode.window.showWarningMessage(
        GIT_CONFLICT_MESSAGE,
        GIT_CONFLICT_OVERRIDE,
      )
      if (choice === GIT_CONFLICT_OVERRIDE) {
        this._conflictOverrides.add(document.uri.fsPath)
        await vscode.commands.executeCommand(
          'vscode.openWith',
          document.uri,
          MarkdownEditorViewType,
        )
      }
      return
    }
    new EditorSession(
      this._context,
      document,
      webviewPanel,
      this.diagramCache,
      (webview, uri, content, theme, initPayload) =>
        this._getHtmlForWebview(webview, uri, content, theme, initPayload),
    ).start()
  }

  private _getHtmlForWebview(
    webview: vscode.Webview,
    uri: vscode.Uri,
    content?: string,
    theme: 'dark' | 'light' = 'light',
    // Task 38: pre-serialized init payload (built by EditorSession.inlineInitPayload) forwarded into
    // the HTML so the webview boots Vditor without the ready→init roundtrip.
    initPayload?: string,
  ) {
    const toUri = (f: string) =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, f))
        .toString()
    const baseHref = `${NodePath.dirname(
      webview.asWebviewUri(vscode.Uri.file(uri.fsPath)).toString(),
    )}/`
    // Resource-scoped (task 295): a `.vscode/settings.json` in the document's own folder must win
    // over user settings. Reading without the URI silently ignored every folder-level override.
    const cfg = cfgFor(uri)
    const savedOpts = sanitizeVditorOptions(
      this._context.globalState.get(KeyVditorOptions),
    ) as { mode?: string } | undefined
    // Task 532 step 5a: the SAME rule the webview applies when it boots Vditor (resolveOpenMode), so
    // the overlay is painted in the mode the editor will open in — not the mode the last session
    // ended in when `vmarkd.editor.defaultMode` says otherwise.
    const savedMode: EditorMode = resolveOpenMode(
      savedOpts?.mode,
      resolveDefaultMode({
        setting: cfg.get<string>('editor.defaultMode'),
        byGlob: cfg.get<Record<string, string>>('editor.defaultModeByGlob'),
        relPath: vscode.workspace.asRelativePath(uri, false),
      }),
      // A huge document streams into IR whatever the mode (vditor-init.ts), so the overlay is IR too.
      shouldStream(
        content?.length ?? 0,
        cfg.get<boolean>('performance.streamLargeFiles'),
      ),
    )

    const contentTheme = effectiveContentTheme(uri)
    return buildWebviewHtml({
      toUri,
      baseHref,
      cspSource: webview.cspSource,
      nonce: getNonce(),
      theme,
      config: {
        showToolbar: cfg.get<boolean>('editor.toolbar') !== false,
        contentTheme,
        useVscodeThemeColor: contentTheme === 'auto',
        markdownPreviewFontFamily: markdownPreviewFontFamily(uri),
        enableFullWidth: cfg.get<boolean>('editor.fullWidth') === true,
        highlightHeadings: cfg.get<boolean>('editor.headingColors') === true,
        showHeadingMarkers: cfg.get<boolean>('editor.headingMarkers') !== false,
        fontSize: resolveFontSize(
          cfg.get<string>('editor.fontSize'),
          contentTheme,
        ),
        // Task 431: same shared resolver the webview's codeHljsStyle uses, so the link this emits and
        // the one Vditor's setCodeTheme would build are byte-identical — a mismatch makes setCodeTheme
        // remove and re-add the link, recreating the flash we are closing.
        codeStyle: resolveCodeStyle(
          theme,
          cfg.get<string>('theme.code'),
          contentTheme,
        ),
        allowRemoteImages: cfg.get<boolean>('image.allowRemote') === true,
        customCss: cfg.get<string>('css.custom') || '',
        externalCss: readExternalCss(uri),
      },
      preRenderedHtml:
        content !== undefined
          ? renderForMode(
              this._context.extensionPath,
              content,
              savedMode,
              isWikiFile(uri),
              cfg.get<boolean>('editor.reflowLineBreaks') !== false,
              // Task 532 step 5c: sizes the webview reported for diagrams it rendered before. The
              // lookup runs only when the document HAS a diagram, so the cache index is not read
              // for plain documents.
              (key) => this.diagramCache.getSize(key),
            )
          : undefined,
      // Gate the hljs preload on the FULL document (not the truncated preRenderedHtml) so a code fence
      // below MAX_PRERENDER_CHARS still preloads hljs (task 170 bonus).
      docHasCodeFence: content !== undefined && hasCodeFence(content),
      // Same full-document gate for the KaTeX preload (task 532 step 4).
      docHasMath: content !== undefined && hasMath(content),
      savedMode,
      i18nLang: resolveVditorI18nLang(vscode.env?.language),
      initPayload,
    })
  }
}
