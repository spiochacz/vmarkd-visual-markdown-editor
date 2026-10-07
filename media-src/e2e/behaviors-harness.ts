/**
 * Harness for the message-contract + DOM-utility e2e tests (no full Vditor).
 *
 * Exposes the webview helpers as globals so the spec can drive each one with a
 * minimal DOM fixture and a stubbed `window.vscode` / `window.vditor`. The
 * vscode stub is installed by the spec via page.addInitScript BEFORE this
 * bundle runs; preload.ts's initVsCodeApi() call (task 470) picks it up
 * through acquireVsCodeApi().
 */
import '../src/boot/preload'
import * as utils from '../src/util/utils'
// Task 185 split several helpers out of the utils.ts grab-bag into focused
// modules: the DOM "fix*" helpers fixLinkClick/fixResponsiveTables moved to
// link-click-fix.ts / responsive-tables.ts, and the toolbar-persistence logic
// (saveVditorOptions/handleToolbarClick) to toolbar-actions.ts. The behavior
// spec still drives the fix* family as one group, so re-aggregate those two
// under __utils (siblings of fixCut, which stayed in utils);
// expose the persistence functions under their own __toolbarActions namespace
// (matching the concern-grouped __liveConfig/__linkPolicy globals below).
import { fixLinkClick } from '../src/links/link-click-fix'
import { fixResponsiveTables } from '../src/chrome/responsive-tables'
import {
  handleToolbarClick,
  saveVditorOptions,
} from '../src/chrome/toolbar-actions'
import { createToolbar } from '../src/chrome/toolbar'
import { t } from '../src/util/lang'
import { applyBodyOptions, swapStyle } from '../src/boot/live-config'
import { applyLinkOpenSetting } from '../src/links/link-open-policy'

;(window as any).__utils = { ...utils, fixLinkClick, fixResponsiveTables }
;(window as any).__toolbarActions = { saveVditorOptions, handleToolbarClick }
;(window as any).__createToolbar = createToolbar
;(window as any).__t = t
;(window as any).__liveConfig = { applyBodyOptions, swapStyle }
;(window as any).__linkPolicy = { applyLinkOpenSetting }
;(window as any).__ready = true
