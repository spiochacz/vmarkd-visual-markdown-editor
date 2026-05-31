/**
 * Harness for the message-contract + DOM-utility e2e tests (no full Vditor).
 *
 * Exposes the webview helpers as globals so the spec can drive each one with a
 * minimal DOM fixture and a stubbed `window.vscode` / `window.vditor`. The
 * vscode stub is installed by the spec via page.addInitScript BEFORE this
 * bundle runs, so utils.ts picks it up through acquireVsCodeApi().
 */
import '../src/preload'
import * as utils from '../src/utils'
import { createToolbar } from '../src/toolbar'
import { t } from '../src/lang'
import { applyBodyOptions, swapStyle } from '../src/live-config'

;(window as any).__utils = utils
;(window as any).__createToolbar = createToolbar
;(window as any).__t = t
;(window as any).__liveConfig = { applyBodyOptions, swapStyle }
;(window as any).__ready = true
