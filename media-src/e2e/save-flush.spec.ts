import { test, expect } from './coverage-fixture'

/**
 * E2e for the Ctrl/Cmd+S flush (task 58). A save fired right after typing must
 * persist the just-typed content. This is the strict case the harness surfaced:
 * Vditor only calls its input hook after its own ~800ms throttle, so when we save
 * immediately NOTHING is pending yet — flush must still post the editor's live
 * value (not save stale content waiting on Vditor's/our debounce).
 */
test('Ctrl+S right after typing posts the live content (even before any debounce armed)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.goto('/save-flush.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  // Click into the IR editor at real coordinates (natural focus + selection so
  // Vditor's input handler fires), then type a unique marker.
  const box = await page.evaluate(() => {
    const el = (window as any).vditor.vditor.ir.element as HTMLElement
    const r = el.getBoundingClientRect()
    return { x: r.x + 8, y: r.y + 8 }
  })
  await page.mouse.click(box.x, box.y)
  await page.keyboard.type('ZZZ58')
  // Save immediately — far inside Vditor's ~800ms input throttle, so nothing is
  // pending. The flush must still post the live value.
  await page.keyboard.press('Control+s')

  const edits = await page.evaluate(() =>
    (window as any).__posted.filter((m: any) => m.command === 'edit'),
  )
  expect(edits.length).toBeGreaterThan(0)
  expect(edits[edits.length - 1].content).toContain('ZZZ58')
})

// IR-edit perf: the debounced (non-save) edit must post the markdown Vditor
// already serialised (passed to options.input → schedule), WITHOUT our debounce
// re-serialising via getValue() a second time.
test('the debounced edit posts the typed content without a second getValue() serialise', async ({
  page,
}) => {
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.goto('/save-flush.html')
  await page.waitForFunction(() => (window as any).__ready === true)

  // Count getValue() calls so we can prove the debounce path doesn't re-serialise.
  await page.evaluate(() => {
    const v = (window as any).vditor
    ;(window as any).__getValueCalls = 0
    const orig = v.getValue.bind(v)
    v.getValue = () => {
      ;(window as any).__getValueCalls++
      return orig()
    }
  })

  const box = await page.evaluate(() => {
    const el = (window as any).vditor.vditor.ir.element as HTMLElement
    const r = el.getBoundingClientRect()
    return { x: r.x + 8, y: r.y + 8 }
  })
  await page.mouse.click(box.x, box.y)
  await page.keyboard.type('DEB42')
  // Wait out Vditor's input throttle (~800ms) + our debounce (250ms).
  await page.waitForTimeout(1400)

  const state = await page.evaluate(() => ({
    edits: (window as any).__posted.filter((m: any) => m.command === 'edit'),
    getValueCalls: (window as any).__getValueCalls,
  }))
  expect(state.edits.length).toBeGreaterThan(0)
  expect(state.edits[state.edits.length - 1].content).toContain('DEB42')
  // The debounce reused Vditor's serialised text — no extra getValue() serialise.
  expect(state.getValueCalls).toBe(0)
})

// Perf C2: on large docs we widen Vditor's reserialise/undo idle window
// (undoDelay) so the multi-second full-doc serialise fires only after a real idle,
// not mid-edit. Here we set a wide window and assert the host edit is deferred past
// the active-typing moment, then still lands once idle.
test('a widened undoDelay defers the host edit out of the active-typing window', async ({
  page,
}) => {
  test.setTimeout(30000)
  await page.addInitScript(() => {
    ;(window as any).__posted = []
    ;(window as any).acquireVsCodeApi = () => ({
      postMessage: (m: any) => (window as any).__posted.push(m),
      getState: () => undefined,
      setState: () => {},
    })
  })
  await page.goto('/save-flush.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  // Simulate the large-doc tuning (undoDelay is read dynamically per input).
  await page.evaluate(() => {
    ;(window as any).vditor.vditor.options.undoDelay = 1500
  })

  const box = await page.evaluate(() => {
    const el = (window as any).vditor.vditor.ir.element as HTMLElement
    const r = el.getBoundingClientRect()
    return { x: r.x + 8, y: r.y + 8 }
  })
  await page.mouse.click(box.x, box.y)
  await page.keyboard.type('WIDE9')

  // Well within the widened window: no host edit yet (serialise deferred).
  await page.waitForTimeout(700)
  const editsEarly = await page.evaluate(
    () =>
      (window as any).__posted.filter((m: any) => m.command === 'edit').length,
  )
  expect(editsEarly).toBe(0)

  // After the window elapses, the edit lands.
  await page.waitForTimeout(1800)
  const state = await page.evaluate(() => ({
    edits: (window as any).__posted.filter((m: any) => m.command === 'edit'),
  }))
  expect(state.edits.length).toBeGreaterThan(0)
  expect(state.edits[state.edits.length - 1].content).toContain('WIDE9')
})
