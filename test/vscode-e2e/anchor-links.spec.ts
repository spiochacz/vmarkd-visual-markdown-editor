import type { EvaluateInVSCode } from './webview-helpers'
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'

// Task 243 — real-VS-Code coverage for both halves of the fix:
//   1. `{#custom-id}` heading ids: SetHeadingID(true) (esbuild-shared.mjs patchLuteHook) must
//      make it through Sanitize into the rendered DOM, AND the source must round-trip
//      byte-stable (the marker is neither dropped nor mangled by the extra Set* call).
//   2. Anchor-link navigation: same-doc `#fragment` clicks (custom id first, then GitHub slug)
//      resolve + scroll IN-PROCESS (no host round-trip — asserted via no error message and no
//      new tab), and cross-doc `file.md#frag` clicks open the target file then scroll it too,
//      via the SAME `scroll-to-heading` mechanism (src/commands.ts's outline-reveal command
//      already uses) — not a second one.
//
// ONE test() — every additional test() pays a full VS Code boot (AGENTS.md).

const MAIN = path.join(__dirname, 'fixtures', 'anchor-links-main.md')

// Cleared defensively at the start of every run (in case a prior spec left an override) — see the
// test body's own comment on why task 468 means no override value is actually needed here.
usePinnedSettings(test, { 'workbench.editorAssociations': undefined })

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview:visible')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

const settle = (frame: ReturnType<typeof wf>, ms: number): Promise<unknown> =>
  frame
    .locator('body')
    .evaluate((_e, d) => new Promise((r) => setTimeout(r, d as number)), ms)

/** Switch the active panel's editor from IR to WYSIWYG (real <a href>, real <h1-6>) — the
 *  surface link-click-fix.ts's document-level click handler covers (WYSIWYG/SV/preview). */
async function toWysiwyg(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(() => {
    const v = (
      window as unknown as {
        vditor: {
          vditor: { toolbar: { elements: Record<string, HTMLElement> } }
        }
      }
    ).vditor.vditor
    v.toolbar.elements['edit-mode']?.children[0]?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    document
      .querySelector('button[data-mode="wysiwyg"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await frame.locator('.vditor-wysiwyg').first().waitFor({ timeout: 30_000 })
}

/** Ctrl+click a real `<a href>` matching `hrefSubstring` (task-62 modifier policy: WYSIWYG/SV/
 *  preview links only follow on a modifier click). */
async function ctrlClickLink(
  frame: ReturnType<typeof wf>,
  hrefSubstring: string,
) {
  await frame.locator('body').evaluate((_el, needle) => {
    const a = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href]'),
    ).find((el) => (el.getAttribute('href') ?? '').includes(needle as string))
    if (!a) throw new Error(`link containing "${needle}" not found`)
    a.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    )
  }, hrefSubstring)
}

// Task 243, real-VS-Code investigation round 3 (lead review): a window-array diagnostic (since
// removed) proved `scrollToHeadingIndex` runs correctly — right index, DOM ready, right
// heading matched by text — for BOTH cross-doc legs, yet the flash assertion still failed. The
// class it applies (FLASH_CLASS, outline.ts) is TRANSIENT — added, then removed on a timer
// (FLASH_DURATION_MS) — so sampling `document.querySelectorAll('h1,h2')[i].classList` some
// fixed delay later is a coin flip on machine load, not a real assertion: "was it EVER
// flashed" is the actual contract; "is it flashed AT THIS EXACT MOMENT" is not, and no amount
// of settle-tuning fixes that.
//
// Round 4 (lead review): the round-3 fix installed the recorder via `workbox.addInitScript`,
// which measurably does NOT reach the vMarkd content realm — `hljs-colour-timing.spec.ts`
// already documented this exact limitation ("the same sampler installed via addInitScript
// lands in the outer, hidden webview iframe whose rAF never advances"): a page-level init
// script lands in the OUTER `iframe.webview` shell, not the INNER `iframe[title="vMarkd"]`
// content frame where Vditor actually runs and FLASH_CLASS actually lands. Confirmed by the
// same-doc leg (the calibration case — it flashes reliably, proven by the pre-recorder
// sampling assertion passing every run) coming back with an EMPTY log too, not just the
// cross-doc leg.
//
// Fix: install the observer via `frame.locator('body').evaluate(...)` — the SAME mechanism
// every other DOM read/write in this spec already uses successfully against the correct inner
// frame — called explicitly per-frame instead of once via addInitScript.
async function installFlashRecorderInFrame(
  frame: ReturnType<typeof wf>,
): Promise<void> {
  await frame.locator('body').evaluate(() => {
    const w = window as unknown as { __vmarkdFlashLog?: string[] }
    w.__vmarkdFlashLog = w.__vmarkdFlashLog ?? []
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== 'attributes' || m.attributeName !== 'class') continue
        const el = m.target as Element
        if (el.classList?.contains('heading-flash')) {
          w.__vmarkdFlashLog?.push((el.textContent ?? '').trim())
        }
      }
    }).observe(document, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    })
  })
}

/** Every heading TEXT that has ever been flashed in this frame's realm so far, or `null` if the
 *  recorder was never installed in THIS frame's realm at all. Distinct return shapes on
 *  purpose (round-4 lead review): `?? []` collapsed "never installed" and "installed, nothing
 *  recorded" into the same `[]`, which is exactly the "logged nothing" failure this diagnostic
 *  exists to distinguish from "genuinely didn't flash". A bare `[]` here would repeat that. */
async function readFlashedTexts(
  frame: ReturnType<typeof wf>,
): Promise<string[] | null> {
  return frame
    .locator('body')
    .evaluate(
      () =>
        (window as unknown as { __vmarkdFlashLog?: string[] })
          .__vmarkdFlashLog ?? null,
    )
}

// Cross-doc legs only (round 5, lead review): a flash-recorder installed via `frame.evaluate`
// can only be armed once Playwright can resolve the sibling's frame/body, and by then Vditor has
// already built the heading DOM (round-3 diagnostic) — measured in round 4, the flash had
// already happened and cleared by the time a sample could run. The flash is a 1.4s CSS class;
// SCROLL POSITION is durable state — once `scrollIntoView` lands, it stays landed — so there is
// no window to lose by polling for it, unlike the flash. This is what the test's own title
// promises anyway ("clicks scroll"), not "clicks flash". Same-doc legs still cover "a flash
// happens at all" via the recorder, which is proven reliable for that leg.
//
// `getBoundingClientRect()` is relative to the FRAME'S OWN viewport regardless of which element
// inside it actually scrolls, so this doesn't need to know Vditor's scroll-container DOM shape
// the way a `scrollTop`-based check would. The heading-lookup body below is duplicated in
// waitForHeadingInView (can't import a shared helper into a `page.evaluate` browser context —
// only its serializable closure travels) — both are tiny, kept in sync by eye.
async function isHeadingInView(
  frame: ReturnType<typeof wf>,
  headingText: string,
): Promise<boolean> {
  return frame.locator('body').evaluate((_el, text) => {
    const inner = (window as any).vditor?.vditor
    const mode = inner?.currentMode as string | undefined
    const root: HTMLElement | undefined = mode
      ? inner?.[mode]?.element
      : undefined
    if (!root) return false
    const heading = Array.from(
      root.querySelectorAll('h1, h2, h3, h4, h5, h6'),
    ).find((h) => (h.textContent ?? '').trim() === text) as
      | HTMLElement
      | undefined
    if (!heading) return false
    const r = heading.getBoundingClientRect()
    return r.top >= 0 && r.top < window.innerHeight
  }, headingText)
}

/** Poll from OUTSIDE the frame (same proven pattern as hljs-colour-timing.spec.ts's colour-
 *  timeline poll: "Round-trip polling gives ~10ms resolution — ample for a window a human
 *  sees") until `headingText` is scrolled into view within its own frame's viewport. Throws
 *  with the last-seen rect if it never lands within `timeoutMs`. */
async function waitForHeadingInView(
  frame: ReturnType<typeof wf>,
  headingText: string,
  timeoutMs = 10_000,
): Promise<void> {
  const t0 = Date.now()
  let last: { found: boolean; top: number; viewportHeight: number } | null =
    null
  while (Date.now() - t0 < timeoutMs) {
    last = await frame.locator('body').evaluate((_el, text) => {
      const inner = (window as any).vditor?.vditor
      const mode = inner?.currentMode as string | undefined
      const root: HTMLElement | undefined = mode
        ? inner?.[mode]?.element
        : undefined
      const heading = root
        ? (Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6')).find(
            (h) => (h.textContent ?? '').trim() === text,
          ) as HTMLElement | undefined)
        : undefined
      if (!heading) {
        return {
          found: false,
          top: Number.NaN,
          viewportHeight: window.innerHeight,
        }
      }
      return {
        found: true,
        top: heading.getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
      }
    }, headingText)
    if (last.found && last.top >= 0 && last.top < last.viewportHeight) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(
    `"${headingText}" never scrolled into view within ${timeoutMs}ms (last sample: ${JSON.stringify(last)})`,
  )
}

/** Deliberately reset scroll to the top of whatever container(s) are actually scrollable in
 *  this frame, without needing to know which element that is — used ONLY between the two
 *  cross-doc legs (task 243, lead review round 5's "prove it moved, not that it was already
 *  there" trap): the sibling panel is REUSED (same webview, no reload) for the shared-name leg,
 *  so without this its scroll position would still be wherever the first leg left it, and a
 *  passing "Shared Name is in view" after the second click could mean nothing moved at all. */
async function resetScrollToTop(frame: ReturnType<typeof wf>): Promise<void> {
  await frame.locator('body').evaluate(() => {
    window.scrollTo(0, 0)
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const e = el as HTMLElement
      if (e.scrollHeight > e.clientHeight) e.scrollTop = 0
    }
  })
}

// Diagnostic for the cross-doc leg (task 243 step 4 debugging, per lead review): the FIRST
// version of this spec waited straight for a webview iframe after the click and got either a
// bare 30s timeout or "context closed" — both consistent with EITHER (a) the selector chain
// resolving to the wrong/no iframe, or (b) `vscode.open` never landing on a vmarkd webview at
// all for the sibling — which, before task 468, was a real gap: `onOpenLink`'s cross-doc open
// called generic `vscode.commands.executeCommand('vscode.open', …)`, and vmarkd's customEditor
// `priority` in package.json is `"option"`, not `"default"`, so a FRESH profile with no
// `workbench.editorAssociations` entry landed the sibling in the built-in text editor instead —
// a tab existed (fsPath matched) but it wasn't a vmarkd webview, and `iframe.webview` never
// appeared. Task 468 fixed this at the product level: onOpenLink now forces `vscode.openWith(…,
// 'vmarkd.editor')` for a markdown target whenever the SOURCE panel (the one the link was
// clicked in) is itself vMarkd — which every click in THIS test always is — so no
// `editorAssociations` workaround is needed here anymore (task 243 review; task 468 removed it).
// This helper still asserts on `viewType` (vscode.TabInputCustom vs vscode.TabInputText) BEFORE
// waiting on any webview locator, so a regression reads as "not a vmarkd editor" instead of an
// opaque iframe timeout — now proving 468 stays fixed, not working around 468 being broken.
async function expectTabOpenedAsVmarkd(
  evaluateInVSCode: EvaluateInVSCode,
  fsPathSuffix: string,
): Promise<void> {
  const info = (await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      const [suffix] = args
      const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)
      const match = tabs.find((t) => {
        const uri = (t.input as { uri?: { fsPath?: string } } | undefined)?.uri
        return uri?.fsPath?.endsWith(suffix)
      })
      return {
        allTabs: tabs.map((t) => {
          const input = t.input as
            | { uri?: { fsPath?: string }; viewType?: string }
            | undefined
          return { fsPath: input?.uri?.fsPath, viewType: input?.viewType }
        }),
        matchFound: !!match,
        matchViewType: (match?.input as { viewType?: string } | undefined)
          ?.viewType,
      }
    },
    [fsPathSuffix] as unknown as [string],
  )) as {
    allTabs: Array<{ fsPath?: string; viewType?: string }>
    matchFound: boolean
    matchViewType: string | undefined
  }
  expect(
    info.matchFound,
    `no tab at all for *${fsPathSuffix}. All tabs: ${JSON.stringify(info.allTabs)}`,
  ).toBe(true)
  expect(
    info.matchViewType,
    `tab for *${fsPathSuffix} exists but is NOT a vmarkd editor (viewType=${info.matchViewType ?? 'undefined → plain text editor'}). All tabs: ${JSON.stringify(info.allTabs)}`,
  ).toBe('vmarkd.editor')
}

test('anchor links: {#custom-id} carries the id + round-trips, same-doc and cross-doc #fragment clicks scroll (task 243)', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)

  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      // Task 468 fix in production means this test needs NO `workbench.editorAssociations`
      // override — onOpenLink now forces `vscode.openWith(…, 'vmarkd.editor')` for a markdown
      // target whenever the SOURCE panel is itself vMarkd, regardless of the user's own
      // association. The override is cleared defensively before this test (usePinnedSettings
      // above), so a prior run in this worker's shared test profile can't leave a false "it
      // works without one" result unverified — this run is the actual proof 468 works, not just
      // that the workaround was removed.
    },
    [] as unknown as [string],
  )
  // Host-side instrumentation: a same-doc anchor MUST NOT reach onOpenLink's old
  // file-literally-named-"#frag" failure path — if it ever regressed to double-classifying,
  // this is what would fire.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode')) => {
      const g = globalThis as unknown as { __anchorSpecErrors?: string[] }
      g.__anchorSpecErrors = []
      const origErr = vscode.window.showErrorMessage.bind(vscode.window)
      vscode.window.showErrorMessage = ((msg: string, ...rest: unknown[]) => {
        g.__anchorSpecErrors!.push(msg)
        return (origErr as any)(msg, ...rest)
      }) as typeof vscode.window.showErrorMessage
    },
    [] as unknown as [string],
  )
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [MAIN] as [string],
  )

  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await settle(frame, 1500)
  // Installed BEFORE any click, on the already-open, already-resolvable main frame — the
  // calibration case (per lead review): this leg flashes reliably, so if the recorder can't
  // see it here, the recorder itself is broken, not the product.
  await installFlashRecorderInFrame(frame)
  await toWysiwyg(frame)
  await settle(frame, 500)

  // --- {#custom-id} reaches the DOM (SetHeadingID(true) + Sanitize keeps it) ---
  const customIdAttr = await frame
    .locator('body')
    .evaluate(() => document.querySelector('h2')?.getAttribute('data-id'))
  expect(customIdAttr).toBe('#custom-id')
  // The marker text itself must NOT leak into the display (pre-existing behaviour, still true).
  expect(
    await frame
      .locator('body')
      .evaluate(() => document.querySelector('h2')?.textContent),
  ).toBe('Custom Section')

  // --- byte-stable round-trip: {#custom-id} survives Md2VditorDOM -> VditorDOM2Md unchanged ---
  const roundTripped = await frame
    .locator('body')
    .evaluate(() =>
      (
        window as unknown as { vditor: { getValue(): string } }
      ).vditor.getValue(),
    )
  const fs = await import('node:fs')
  const original = fs.readFileSync(MAIN, 'utf8')
  expect(roundTripped.trim()).toBe(original.trim())

  // --- same-doc anchor: plain-text slug ---
  await ctrlClickLink(frame, '#the-heading')
  await settle(frame, 300)
  const flashAfterFirst = await readFlashedTexts(frame)
  expect(
    flashAfterFirst,
    'flash recorder never installed in this frame',
  ).not.toBeNull()
  expect(flashAfterFirst).toContain('The Heading')
  expect(flashAfterFirst).not.toContain('Custom Section')

  // --- same-doc anchor: {#custom-id} ---
  await ctrlClickLink(frame, '#custom-id')
  await settle(frame, 300)
  const flashAfterSecond = await readFlashedTexts(frame)
  expect(flashAfterSecond).toContain('Custom Section')

  // Neither same-doc click should have opened a new tab or shown a host error (no host
  // round-trip at all for a same-doc anchor — the old "#frag" no-op stub, and before that
  // task 359, the literal-filename-open bug, must never fire).
  const errorsSoFar = await evaluateInVSCode(
    async () =>
      (globalThis as unknown as { __anchorSpecErrors?: string[] })
        .__anchorSpecErrors ?? [],
    [] as unknown as [string],
  )
  expect(errorsSoFar).toEqual([])
  const tabsAfterSameDoc = await evaluateInVSCode(
    async (vscode: typeof import('vscode')) =>
      vscode.window.tabGroups.all.flatMap((g) => g.tabs).length,
    [] as unknown as [string],
  )
  expect(tabsAfterSameDoc).toBe(1)

  // --- cross-doc: file.md#frag opens the sibling and scrolls IT to the target heading ---
  await ctrlClickLink(frame, 'anchor-links-sibling.md#sibling-target')
  // NOT `settle(frame, …)` here — the click just switched the active tab away from `frame`'s
  // panel, so `frame` (built with `iframe.webview:visible`) no longer resolves to anything and
  // any `.evaluate()` on it hangs until timeout. Wait on the top-level page instead; the fresh
  // `wf(workbox)` call below re-resolves against whichever panel is now visible.
  await workbox.waitForTimeout(2500) // new panel boot + host-side scroll-to-heading round-trip

  // Distinguishes "no tab opened at all" / "opened but not as a vmarkd webview" / "opened as
  // vmarkd" BEFORE waiting on any webview locator — see the function's own comment.
  await expectTabOpenedAsVmarkd(evaluateInVSCode, 'anchor-links-sibling.md')

  const siblingFrame = wf(workbox)
  await siblingFrame.locator('.vditor-ir, .vditor-wysiwyg').first().waitFor({
    timeout: 30_000,
  })
  // Scroll position, not the flash — see the helpers' own comment for why. "Already in view"
  // is structurally impossible here: the fixture (anchor-links-sibling.md) pads ~30 filler
  // paragraphs before "Sibling Target", well past any plausible single viewport, and a freshly
  // opened document starts scrolled to the top — so a poll finding it in view is genuine proof
  // `scrollIntoView` ran, not a coincidence of it already being visible.
  await waitForHeadingInView(siblingFrame, 'Sibling Target')
  // Deliberately reset + verify BEFORE the shared-name leg below, WHILE this panel is still the
  // active/resolvable frame — it's the SAME webview (no reload) for that leg, so without this
  // its scroll position would still be wherever this leg left it, and "Shared Name is in view"
  // after the next click could mean nothing moved (the "already there" trap, lead review).
  await resetScrollToTop(siblingFrame)
  expect(
    await isHeadingInView(siblingFrame, 'Shared Name'),
    'reset-to-top left "Shared Name" in view — the shared-name leg below would not prove anything',
  ).toBe(false)

  // --- the case that would silently look right while being wrong: BOTH files have a
  // "Shared Name" heading, at a DIFFERENT ordinal index in each (main.md: index 2, sibling.md:
  // index 1 — see the fixture's own comment). If the host ever resolved `#shared-name` against
  // the SOURCE document's headings (main.md, where the link lives) instead of the TARGET's
  // (sibling.md, where it navigates to), it would compute index 2 and post THAT to the
  // sibling's webview — which would scroll to sibling.md's 3rd heading, "Sibling Target", not
  // "Shared Name". Asserting the CORRECT heading (not just "something scrolled") is what makes
  // this distinguish the two documents' resolution.
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: string[]) => {
      // Explicit openWith, not plain vscode.open — see the DEBUG note above the loop below for
      // why: plain vscode.open on an already-open custom-editor document was observed opening a
      // SECOND, duplicate tab instead of reactivating the existing one.
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [MAIN] as [string],
  )
  await expectTabOpenedAsVmarkd(evaluateInVSCode, 'anchor-links-main.md')
  const mainFrameAgain = wf(workbox)
  await mainFrameAgain.locator('.vditor-ir, .vditor-wysiwyg').first().waitFor({
    timeout: 30_000,
  })
  await settle(mainFrameAgain, 500)
  await ctrlClickLink(mainFrameAgain, 'anchor-links-sibling.md#shared-name')
  await workbox.waitForTimeout(2500)
  await expectTabOpenedAsVmarkd(evaluateInVSCode, 'anchor-links-sibling.md')

  const siblingFrameAgain = wf(workbox)
  await siblingFrameAgain
    .locator('.vditor-ir, .vditor-wysiwyg')
    .first()
    .waitFor({ timeout: 30_000 })
  // "Already in view" is ruled out deliberately (not incidentally) here: resetScrollToTop +
  // the isHeadingInView(..., false) check above proved "Shared Name" was OUT of view right
  // before this click, on this SAME reused webview realm — so a poll finding it in view now is
  // genuine proof of THIS click's scroll, not a leftover from the sibling-target leg. The
  // negative check mirrors that: the two headings are ~30 filler paragraphs apart (well over
  // one viewport), so landing on one puts the other out of view — a stale "Sibling Target" from
  // the earlier leg can't smuggle a false positive past this scroll-position check the way it
  // could have past a sampled flash class.
  await waitForHeadingInView(siblingFrameAgain, 'Shared Name')
  expect(await isHeadingInView(siblingFrameAgain, 'Sibling Target')).toBe(false)
})
