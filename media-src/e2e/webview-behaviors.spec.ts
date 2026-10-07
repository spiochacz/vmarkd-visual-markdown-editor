import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

/**
 * E2e coverage for the webview helpers that talk to the host (message
 * contract) or manipulate the DOM — everything except wiki-link *rendering*
 * (custom-renderer with enabled:true), which belongs to the wiki task.
 *
 * Uses the lightweight `behaviors` harness: helpers exposed as globals, a
 * stubbed window.vscode that records posted messages on window.__posted, and
 * a per-test minimal DOM fixture (no full Vditor needed).
 */

async function gotoBehaviors(page: Page) {
  // Installed before the bundle runs, so the harness's explicit
  // `initVsCodeApi()` call (task 470) picks up the recording stub.
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {
        /* vscode API stub: state persistence unused in this spec */
      },
    })
  })
  await page.goto('/behaviors.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function posted(page: Page) {
  return page.evaluate(() => (window as any).__posted)
}

// NOTE: the old `confirm()` <dialog> helper was intentionally DELETED in task 185
// as dead code (zero callers — see the "the unused confirm() dialog was dropped"
// note at utils.ts:5). Its two behavior tests were removed with it: there is no
// behaviour left to protect, and re-adding a stub would test nothing real.

test.describe('fixLinkClick()', () => {
  // Default 'modifier' policy (task 62): for a link in the EDITOR CONTENT a plain
  // click is left for editing; only Ctrl/Cmd+click follows it. The `.vditor-ir`
  // wrapper is what scopes the policy (task: chrome links ignore it — see below).
  test('modifier policy: editor link — Ctrl+click opens, plain click does not', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).__linkPolicy.applyLinkOpenSetting(true) // modifier mode
      document.body.innerHTML =
        '<div class="vditor-ir"><a id="lnk" href="https://example.com/docs/page">link</a></div>'
      ;(window as any).__utils.fixLinkClick()
    })
    await page.locator('#lnk').click() // plain — must NOT open
    expect(await posted(page)).toEqual([])
    await page.locator('#lnk').click({ modifiers: ['Control'] })
    expect(await posted(page)).toContainEqual({
      command: 'open-link',
      href: 'https://example.com/docs/page',
    })
  })

  // A link OUTSIDE the editor content (About/Info dialog, tips, toolbar) is not
  // editable text, so the modifier policy must NOT gate it — a plain click opens.
  test('modifier policy: chrome link (dialog) opens on a plain click', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).__linkPolicy.applyLinkOpenSetting(true) // modifier mode
      document.body.innerHTML =
        '<div class="vditor-tip"><a id="lnk" href="https://dialog.example/info">info</a></div>'
      ;(window as any).__utils.fixLinkClick()
    })
    await page.locator('#lnk').click() // plain — must open (chrome, not editor)
    expect(await posted(page)).toContainEqual({
      command: 'open-link',
      href: 'https://dialog.example/info',
    })
  })

  test('click policy: a plain click posts open-link', async ({ page }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).__linkPolicy.applyLinkOpenSetting(false) // legacy click mode
      document.body.innerHTML =
        '<a id="lnk" href="https://example.com/docs/page">link</a>'
      ;(window as any).__utils.fixLinkClick()
    })
    await page.locator('#lnk').click()
    expect(await posted(page)).toContainEqual({
      command: 'open-link',
      href: 'https://example.com/docs/page',
    })
  })

  test('routes window.open through open-link', async ({ page }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).__utils.fixLinkClick()
      window.open('https://opened.example/from-window-open')
    })
    expect(await posted(page)).toContainEqual({
      command: 'open-link',
      href: 'https://opened.example/from-window-open',
    })
  })
})

test('fileToBase64() encodes file bytes as base64', async ({ page }) => {
  await gotoBehaviors(page)
  const b64 = await page.evaluate(async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'x.bin', {
      type: 'application/octet-stream',
    })
    return (window as any).__utils.fileToBase64(file)
  })
  // base64 of bytes 0x01 0x02 0x03 0x04
  expect(b64).toBe('AQIDBA==')
})

test('fixResponsiveTables() normalizes table sizing', async ({ page }) => {
  await gotoBehaviors(page)
  await page.evaluate(() => {
    document.body.innerHTML =
      '<div class="vditor"><div class="vditor-reset">' +
      '<table width="600"><tbody><tr><td width="200">a</td><td width="200">b</td></tr></tbody></table>' +
      '</div></div>'
    ;(window as any).__utils.fixResponsiveTables()
  })
  // syncTables() is debounced at 16ms.
  await page.waitForTimeout(60)
  const result = await page.evaluate(() => {
    const table = document.querySelector('table') as HTMLTableElement
    const td = document.querySelector('td') as HTMLTableCellElement
    return {
      width: table.style.width,
      tableHasWidthAttr: table.hasAttribute('width'),
      cellHasWidthAttr: td.hasAttribute('width'),
    }
  })
  expect(result.width).toBe('100%')
  expect(result.tableHasWidthAttr).toBe(false)
  expect(result.cellHasWidthAttr).toBe(false)
})

test.describe('toolbar config save (saveVditorOptions / handleToolbarClick)', () => {
  // Task 152/185 ALLOW-LIST: save-options now persists ONLY the user-toggled edit
  // `mode`. The pre-allow-list {theme, mode, preview} payload is gone — theme and
  // the whole preview blob are config-derived and re-applied authoritatively in
  // buildVditorOptions, so persisting them only created a stale shadow that fought
  // live config (memory: saved-Vditor-options-override-settings). These assertions
  // pin the new, narrower contract (toolbar-actions.ts:23-28).
  test('saveVditorOptions posts only the current edit mode (allow-list)', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).vditor = { vditor: { currentMode: 'ir' } }
      ;(window as any).__toolbarActions.saveVditorOptions()
    })
    expect(await posted(page)).toContainEqual({
      command: 'save-options',
      options: { mode: 'ir' },
    })
  })

  test('handleToolbarClick saves the mode after a panel button click', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).vditor = { vditor: { currentMode: 'wysiwyg' } }
      document.body.innerHTML =
        '<div class="vditor-toolbar"><div class="vditor-panel">' +
        '<button id="panelBtn">B</button></div></div>'
      ;(window as any).__toolbarActions.handleToolbarClick()
      // Dispatch directly: the panel is display:none (vditor CSS), so a
      // Playwright actionable click would hang. The bubble-phase handler
      // delegates from .vditor-toolbar, so a bubbling synthetic click is what
      // it listens for.
      document
        .getElementById('panelBtn')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(600) // 500ms debounce inside handleToolbarClick
    expect(await posted(page)).toContainEqual({
      command: 'save-options',
      options: { mode: 'wysiwyg' },
    })
  })

  // The edit-mode buttons are special: Vditor's own button handler calls
  // event.stopPropagation() (in the bubble phase), so the bubble-phase toolbar
  // listener above never sees a mode switch — which is why the chosen mode used to
  // go unpersisted. handleToolbarClick installs a SECOND listener in the CAPTURE
  // phase (runs before Vditor's stopPropagation), so a [data-mode] click both
  // persists the mode (save-options) and reports it for the status bar (editorMode,
  // task 152/187). This is the real-browser proof that capture beats a REAL
  // stopPropagation — the exact event-ordering seam a jsdom unit test can't fully
  // exercise (Infra-1, task 191).
  test('a [data-mode] click persists + reports the mode despite Vditor stopPropagation', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).vditor = { vditor: { currentMode: 'sv' } }
      document.body.innerHTML =
        '<div class="vditor-toolbar"><button data-mode="sv" id="modeBtn">SV</button></div>'
      ;(window as any).__toolbarActions.handleToolbarClick()
      // Simulate Vditor's own bubble-phase handler swallowing the event — the
      // capture-phase document listener has already fired by the time this runs.
      const btn = document.getElementById('modeBtn')!
      btn.addEventListener('click', (e) => e.stopPropagation())
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(600) // 500ms debounce inside the capture listener
    const msgs = await posted(page)
    expect(msgs).toContainEqual({
      command: 'save-options',
      options: { mode: 'sv' },
    })
    expect(msgs).toContainEqual({ command: 'editorMode', mode: 'sv' })
  })
})

test.describe('createToolbar()', () => {
  test('edit-in-vscode button posts edit-in-vscode', async ({ page }) => {
    await gotoBehaviors(page)
    const sent = await page.evaluate(() => {
      const items = (window as any).__createToolbar()
      items.find((i: any) => i.name === 'edit-in-vscode').click()
      return (window as any).__posted
    })
    expect(sent).toContainEqual({ command: 'edit-in-vscode' })
  })

  test('omits wiki buttons by default, includes them when wikiEnabled', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const names = await page.evaluate(() => {
      const get = (opts: any) =>
        (window as any)
          .__createToolbar(opts)
          .map((i: any) => i.name)
          .filter(Boolean)
      return { off: get({}), on: get({ wikiEnabled: true }) }
    })
    expect(names.off).not.toContain('wiki-pages')
    expect(names.off).not.toContain('navigate-back')
    expect(names.on).toContain('wiki-pages')
    expect(names.on).toContain('navigate-back')
  })

  test('navigate-back button posts navigate-back', async ({ page }) => {
    await gotoBehaviors(page)
    const sent = await page.evaluate(() => {
      const items = (window as any).__createToolbar({ wikiEnabled: true })
      items.find((i: any) => i.name === 'navigate-back').click()
      return (window as any).__posted
    })
    expect(sent).toContainEqual({ command: 'navigate-back' })
  })

  // Task 505 — the bug that started this task: tooltips/menus kept showing Vditor's OLD hotkey
  // notation after a promoted item was remapped, because only package.json's keybindings had
  // changed, not toolbar.ts. Confirm the REMAPPED items' tips show the NEW key in VS Code
  // notation, not Vditor's own stale ⌘-symbol default.
  test("remapped items (ordered-list, check, indent, outdent) render the NEW tip, not Vditor's old ⌘ notation", async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const tips = await page.evaluate(() => {
      const items = (window as any).__createToolbar()
      const byName = (n: string) => items.find((i: any) => i.name === n)
      return {
        orderedList: byName('ordered-list').tip,
        check: byName('check').tip,
        indent: byName('indent').tip,
        outdent: byName('outdent').tip,
      }
    })
    expect(tips.orderedList).toBe('Numbered List (Ctrl+Shift+7)')
    expect(tips.check).toBe('Checklist (Ctrl+Shift+9)')
    expect(tips.indent).toBe('Indent (Ctrl+])')
    expect(tips.outdent).toBe('Outdent (Ctrl+[)')
    for (const tip of Object.values(tips)) {
      expect(tip).not.toMatch(/[⌘⇧]/)
    }
  })

  // Every FORMAT_HOTKEYS row disables Vditor's own hotkey — the actual root-cause fix (one owner
  // per key). A non-empty hotkey here would mean Vditor's bubble-phase handler is still live for
  // that key, racing the VS Code command.
  test('every promoted item has hotkey disabled ("") so Vditor cannot also react to it', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const hotkeys = await page.evaluate(() => {
      const items = (window as any).__createToolbar()
      const names = [
        'bold',
        'italic',
        'strike',
        'headings',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        'quote',
        'code',
        'inline-code',
      ]
      return Object.fromEntries(
        names.map((n) => [n, items.find((i: any) => i.name === n).hotkey]),
      )
    })
    for (const [name, hotkey] of Object.entries(hotkeys)) {
      expect(hotkey, name).toBe('')
    }
  })
})

test('fixCut() defers delete but passes other commands through', async ({
  page,
}) => {
  await gotoBehaviors(page)
  const result = await page.evaluate(async () => {
    const calls: string[] = []
    document.execCommand = ((cmd: string) => {
      calls.push(cmd)
      return true
    }) as any
    ;(window as any).__utils.fixCut()
    document.execCommand('bold') // passes through synchronously
    document.execCommand('delete') // deferred via setTimeout
    const immediate = [...calls]
    await new Promise((r) => setTimeout(r, 20))
    return { immediate, eventual: calls }
  })
  expect(result.immediate).toEqual(['bold'])
  expect(result.eventual).toEqual(['bold', 'delete'])
})

test.describe('live-config (tasks 12/26)', () => {
  test('applyBodyOptions sets the body attributes + outline-width var', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const res = await page.evaluate(() => {
      ;(window as any).__liveConfig.applyBodyOptions({
        useVscodeThemeColor: false,
        enableFullWidth: true,
        highlightHeadings: true,
        showHeadingMarkers: false,
        outlineWidth: 250,
        fontSize: 'vditor',
      })
      const b = document.body
      return {
        themeColor: b.getAttribute('data-use-vscode-theme-color'),
        fullWidth: b.getAttribute('data-full-width'),
        highlight: b.getAttribute('data-highlight-headings'),
        markers: b.getAttribute('data-heading-markers'),
        width: b.style.getPropertyValue('--me-outline-width'),
        fontSize: b.style.getPropertyValue('--me-font-size'),
      }
    })
    expect(res).toEqual({
      themeColor: '0',
      fullWidth: '1',
      highlight: '1',
      markers: '0',
      width: '250px',
      fontSize: '16px', // resolveFontSize('vditor')
    })
  })

  test('swapStyle creates then replaces an id-tagged style node in place', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const res = await page.evaluate(() => {
      const lc = (window as any).__liveConfig
      lc.swapStyle('custom-css', 'body{color:red}')
      const first = document.getElementById('custom-css')?.textContent
      lc.swapStyle('custom-css', 'body{color:blue}')
      const second = document.getElementById('custom-css')?.textContent
      const count = document.querySelectorAll('#custom-css').length
      return { first, second, count }
    })
    expect(res.first).toBe('body{color:red}')
    expect(res.second).toBe('body{color:blue}')
    expect(res.count).toBe(1) // swapped in place, not duplicated
  })

  // The swapped style node is a real, live stylesheet — the injected rule cascades
  // onto matching elements (this is how the `css.custom` / `css.external` settings
  // take effect), and re-swapping re-applies. Asserts computed style, not textContent.
  test('a swapped style is actually applied (cascades) and re-applies on swap', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const res = await page.evaluate(() => {
      const lc = (window as any).__liveConfig
      const probe = document.createElement('div')
      probe.id = 'probe'
      document.body.appendChild(probe)
      lc.swapStyle('external-css', '#probe{width:42px}')
      const first = getComputedStyle(probe).width
      lc.swapStyle('external-css', '#probe{width:84px}')
      const second = getComputedStyle(probe).width
      return { first, second }
    })
    expect(res.first).toBe('42px')
    expect(res.second).toBe('84px') // live re-apply, not stale
  })

  // task 82: --me-font-size (the `fontSize` setting) is theme-aware via applyBodyOptions
  // → resolveFontSize. A GitHub content theme defaults to GitHub's 16px reading size for
  // unset/"editor"; an explicit size still wins (so the setting scales it); non-GitHub
  // themes default to the VS Code editor font size.
  test('applyBodyOptions makes --me-font-size theme-aware (GitHub 16px default, explicit wins)', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const res = await page.evaluate(() => {
      const lc = (window as any).__liveConfig
      const read = () => document.body.style.getPropertyValue('--me-font-size')
      lc.applyBodyOptions({ contentTheme: 'github-light', fontSize: 'editor' })
      const githubDefault = read()
      lc.applyBodyOptions({ contentTheme: 'github-dark', fontSize: '20' })
      const githubExplicit = read()
      lc.applyBodyOptions({ contentTheme: 'auto', fontSize: 'editor' })
      const autoDefault = read()
      return { githubDefault, githubExplicit, autoDefault }
    })
    expect(res.githubDefault).toBe('16px') // GitHub reading size out of the box
    expect(res.githubExplicit).toBe('20px') // the fontSize setting still scales GitHub
    expect(res.autoDefault).toBe('var(--vscode-editor-font-size, 14px)') // editor size
  })
})

test.describe('createToolbar (task 44/wiki) — custom item click handlers', () => {
  async function buildToolbar(page: Page, wikiEnabled: boolean) {
    await gotoBehaviors(page)
    return page.evaluate((wiki) => {
      const calls: any = { insertValue: [], updateValue: [], clip: [] }
      ;(window as any).vditor = {
        getValue: () => 'MD',
        getHTML: () => '<p>H</p>',
        getCurrentMode: () => 'ir',
        focus: () => {
          /* mock vditor: this spec doesn't assert focus behaviour */
        },
        insertValue: (v: string) => calls.insertValue.push(v),
        updateValue: (v: string) => calls.updateValue.push(v),
        vditor: { ir: { element: document.body, range: undefined } },
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (t: string) => {
            calls.clip.push(t)
          },
        },
      })
      ;(window as any).__tbCalls = calls
      // flatten top-level + the 'more' submenu, keep items that have a click()
      const items = (window as any).__createToolbar({ wikiEnabled: wiki })
      const flat: any[] = []
      for (const it of items) {
        flat.push(it)
        if (Array.isArray(it.toolbar)) flat.push(...it.toolbar)
      }
      ;(window as any).__tbItems = flat
      return flat.map((i) => i.name).filter(Boolean)
    }, wikiEnabled)
  }

  async function click(page: Page, name: string) {
    await page.evaluate(async (n) => {
      const it = (window as any).__tbItems.find((i: any) => i.name === n)
      await it.click()
    }, name)
  }

  test('message-posting items post their command (+ wikiEnabled adds nav/wiki)', async ({
    page,
  }) => {
    const names = await buildToolbar(page, true)
    expect(names).toEqual(
      expect.arrayContaining(['navigate-back', 'wiki-pages']),
    )
    for (const n of [
      'settings',
      'edit-in-vscode',
      'navigate-back',
      'wiki-pages',
    ])
      await click(page, n)
    const msgs = await posted(page)
    const commands = msgs.map((m: any) => m.command)
    expect(commands).toEqual(
      expect.arrayContaining([
        'open-settings',
        'edit-in-vscode',
        'navigate-back',
        'list-wiki-pages',
      ]),
    )
  })

  test('wiki section has a trailing separator when enabled', async ({
    page,
  }) => {
    await buildToolbar(page, true)
    const items: string[] = await page.evaluate(() => {
      const tb = (window as any).__createToolbar({ wikiEnabled: true })
      return tb.map((i: any) => (typeof i === 'string' ? i : i.name))
    })
    const wikiIdx = items.indexOf('wiki-pages')
    expect(wikiIdx).toBeGreaterThan(-1)
    expect(items[wikiIdx + 1]).toBe('|')
  })

  test('no stray separator when wiki is disabled', async ({ page }) => {
    await buildToolbar(page, false)
    const items: string[] = await page.evaluate(() => {
      const tb = (window as any).__createToolbar({ wikiEnabled: false })
      return tb.map((i: any) => (typeof i === 'string' ? i : i.name))
    })
    expect(items).not.toContain('navigate-back')
    for (let i = 0; i < items.length - 1; i++) {
      if (items[i] === '|') expect(items[i + 1]).not.toBe('|')
    }
  })

  test('omits the wiki items when wiki is disabled', async ({ page }) => {
    const names = await buildToolbar(page, false)
    expect(names).not.toContain('navigate-back')
    expect(names).not.toContain('wiki-pages')
  })

  test('the link item inserts a markdown link skeleton', async ({ page }) => {
    await buildToolbar(page, false)
    await click(page, 'link')
    const calls = await page.evaluate(() => (window as any).__tbCalls)
    // no selection -> inserts an empty link
    expect(calls.insertValue).toContain('[]()')
  })
})
