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
  // Installed before the bundle runs, so utils.ts's
  // `window.vscode = acquireVsCodeApi()` picks up the recording stub.
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.goto('/behaviors.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function posted(page: Page) {
  return page.evaluate(() => (window as any).__posted)
}

test.describe('confirm() dialog', () => {
  test('runs onOk and shows the message when confirmed', async ({ page }) => {
    await gotoBehaviors(page)
    const result = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; text: string | null }>((resolve) => {
          let ran = false
          ;(window as any).__utils.confirm('Reset everything?', () => {
            ran = true
          })
          const dialog = document.querySelector(
            'dialog.me-confirm',
          ) as HTMLDialogElement
          const text = dialog.querySelector('.me-confirm__content')!.textContent
          ;(
            dialog.querySelector('button[value="confirm"]') as HTMLButtonElement
          ).click()
          setTimeout(() => resolve({ ran, text }), 50)
        }),
    )
    expect(result.text).toBe('Reset everything?')
    expect(result.ran).toBe(true)
  })

  test('does not run onOk when cancelled, and removes the dialog', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    const result = await page.evaluate(
      () =>
        new Promise<{ ran: boolean; stillInDom: boolean }>((resolve) => {
          let ran = false
          ;(window as any).__utils.confirm('Sure?', () => {
            ran = true
          })
          const dialog = document.querySelector(
            'dialog.me-confirm',
          ) as HTMLDialogElement
          ;(
            dialog.querySelector('button[value="cancel"]') as HTMLButtonElement
          ).click()
          setTimeout(
            () =>
              resolve({
                ran,
                stillInDom: !!document.querySelector('dialog.me-confirm'),
              }),
            50,
          )
        }),
    )
    expect(result.ran).toBe(false)
    expect(result.stillInDom).toBe(false)
  })
})

test.describe('fixLinkClick()', () => {
  test('intercepts a normal link click and posts open-link', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
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
  test('saveVditorOptions posts the current theme/mode/preview', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).vditor = {
        vditor: {
          options: { theme: 'classic', preview: { mode: 'both' } },
          currentMode: 'ir',
        },
      }
      ;(window as any).__utils.saveVditorOptions()
    })
    expect(await posted(page)).toContainEqual({
      command: 'save-options',
      options: { theme: 'classic', mode: 'ir', preview: { mode: 'both' } },
    })
  })

  test('handleToolbarClick saves options after a panel button click', async ({
    page,
  }) => {
    await gotoBehaviors(page)
    await page.evaluate(() => {
      ;(window as any).vditor = {
        vditor: {
          options: { theme: 'dark', preview: {} },
          currentMode: 'wysiwyg',
        },
      }
      document.body.innerHTML =
        '<div class="vditor-toolbar"><div class="vditor-panel">' +
        '<button id="panelBtn">B</button></div></div>'
      ;(window as any).__utils.handleToolbarClick()
      // Dispatch directly: the panel is display:none (vditor CSS), so a
      // Playwright actionable click would hang. The handler delegates from
      // .vditor-toolbar, so a bubbling synthetic click is what it listens for.
      document
        .getElementById('panelBtn')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(600) // 500ms debounce inside handleToolbarClick
    expect(await posted(page)).toContainEqual({
      command: 'save-options',
      options: { theme: 'dark', mode: 'wysiwyg', preview: {} },
    })
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
})

test('fixPanelHover() adds the hover class on mouseenter', async ({ page }) => {
  await gotoBehaviors(page)
  const hasClass = await page.evaluate(() => {
    document.body.innerHTML =
      '<div id="fix-table-ir-wrapper"><div class="vditor-panel" id="panel"></div></div>'
    ;(window as any).__utils.fixPanelHover()
    const panel = document.getElementById('panel')!
    panel.dispatchEvent(new MouseEvent('mouseenter'))
    return panel.classList.contains('vditor-panel_hover')
  })
  expect(hasClass).toBe(true)
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
        focus: () => {},
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
