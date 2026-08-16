import { type EvaluateInVSCode, settle, wf } from './webview-helpers'
// PROBE for task 445, round 6 — pins the exact CALL SITE of the DOM mutation identified in round
// 5 (caret-click-during-init-probe.spec.ts): a real click within ~0-300ms of the editable first
// appearing places a caret whose anchor text node then gets mutated (characterData write, plus a
// childList add/remove on its parent) by something that is NOT Vditor's `expandMarker` (read the
// source — pure synchronous classList toggle, no text/node mutation, no async path on the
// collapsed-click branch). `caretHeight` reads 0 from the very next sample and never recovers
// until the second click.
//
// `console.trace`/a MutationObserver callback CANNOT name the culprit: MutationObserver callbacks
// run as a microtask, well after the mutating code's own call stack has unwound — the trace would
// only ever show our own observer. Instead this probe intercepts the DOM-mutating APIs
// SYNCHRONOUSLY, via `page.addInitScript` (installed before ANY app code runs, in every frame
// including the nested webview iframes — Playwright applies init scripts page-wide, iframes
// included): the `CharacterData.prototype.data` setter, `replaceData`/`appendData`/`insertData`/
// `deleteData`, and `Node.prototype.insertBefore`/`appendChild`/`removeChild`/`replaceChild`. Each
// wrapper captures `new Error().stack` at call time — a real, synchronous stack frame chain,
// unlike a MutationObserver's.
//
// Filtered tightly to the round-5 fingerprint to keep the log readable: a characterData op is
// logged only when `this` (the CharacterData node) IS the live selection's current
// `startContainer`; a childList op is logged only when `this` (the parent being mutated) IS that
// startContainer's direct parentNode. Vditor's initial synchronous construction render (which
// happens before `.vditor-ir` becomes queryable) is skipped structurally — we only start caring
// once a Range exists to compare against, i.e. after the click.
//
// Pure measurement: no fix lives here, nothing is asserted pass/fail — the console output (the
// captured call stacks) IS the deliverable.
// @probe — excluded from the default run; run with `npm --prefix test/vscode-e2e run test:probes`.
import path from 'node:path'
import { test } from 'vscode-test-playwright'

const EMPTY_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-empty.md')
const TEXT_FIXTURE = path.join(__dirname, 'fixtures', 'caret-on-open-text.md')

// Installed BEFORE any app code runs, in every frame (including the nested webview iframes).
// Patches the DOM-mutating primitives to capture a synchronous call stack whenever they touch the
// live selection's anchor text node (characterData ops) or its direct parent (childList ops) —
// see the file header for why this beats a MutationObserver.
async function installStackTraceHooks(
  workbox: import('@playwright/test').Page,
) {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: instruments caret-set calls with a captured stack trace across multiple patched entry points; pre-existing (task 469 baseline)
  await workbox.addInitScript(() => {
    const w = window as unknown as {
      __stackLog: unknown[]
      __armed: boolean
      __hooksInstalled: boolean
      __callCounts: Record<string, number>
    }
    w.__stackLog = []
    w.__armed = false // the probe arms this after the editable exists — see armCapture() below
    w.__hooksInstalled = true // proves this init script ran in THIS frame at all
    // Diagnostic (round-6 first pass came back with 0 matches everywhere — this distinguishes
    // "hooks never installed/never called" from "hooks called but the anchor-identity match
    // never true", without changing what's logged into __stackLog).
    w.__callCounts = {}
    const bump = (k: string) => {
      w.__callCounts[k] = (w.__callCounts[k] ?? 0) + 1
    }

    const anchorNode = (): Node | null => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return null
      return sel.getRangeAt(0).startContainer
    }

    const push = (kind: string, extra: Record<string, unknown>) => {
      if (!w.__armed) return
      w.__stackLog.push({
        t: Math.round(performance.now()),
        kind,
        ...extra,
        stack: new Error().stack,
      })
    }

    const describe = (n: Node | null) =>
      n
        ? n.nodeName +
          (n.nodeType === Node.TEXT_NODE
            ? `("${(n.textContent ?? '').slice(0, 20)}")`
            : (n as HTMLElement).className
              ? `.${String((n as HTMLElement).className)
                  .trim()
                  .replace(/\s+/g, '.')}`
              : '')
        : 'null'

    // --- CharacterData: data setter + replaceData/appendData/insertData/deleteData ---
    const cdProto = CharacterData.prototype
    const dataDesc = Object.getOwnPropertyDescriptor(cdProto, 'data')
    if (dataDesc?.set && dataDesc.get) {
      Object.defineProperty(cdProto, 'data', {
        configurable: true,
        enumerable: dataDesc.enumerable,
        get: dataDesc.get,
        set(this: CharacterData, v: string) {
          if (w.__armed) bump('CharacterData.data= (calls)')
          const isAnchor = this === anchorNode()
          if (isAnchor) {
            bump('CharacterData.data= (anchor match)')
            push('CharacterData.data=', {
              target: describe(this),
              newValue: v.length > 30 ? `${v.slice(0, 30)}…` : v,
            })
          }
          return dataDesc.set!.call(this, v)
        },
      })
    }
    for (const method of [
      'replaceData',
      'appendData',
      'insertData',
      'deleteData',
    ] as const) {
      const orig = cdProto[method] as (...args: unknown[]) => unknown
      cdProto[method] = function (this: CharacterData, ...args: unknown[]) {
        if (w.__armed) bump(`CharacterData.${method} (calls)`)
        const isAnchor = this === anchorNode()
        if (isAnchor) {
          bump(`CharacterData.${method} (anchor match)`)
          push(`CharacterData.${method}`, { target: describe(this), args })
        }
        return orig.apply(this, args)
      } as never
    }

    // --- Node: insertBefore/appendChild/removeChild/replaceChild ---
    const nodeProto = Node.prototype
    for (const method of [
      'insertBefore',
      'appendChild',
      'removeChild',
      'replaceChild',
    ] as const) {
      const orig = nodeProto[method] as (...args: unknown[]) => unknown
      nodeProto[method] = function (this: Node, ...args: unknown[]) {
        if (w.__armed) bump(`Node.${method} (calls)`)
        const a = anchorNode()
        const isAnchorParent = !!a && this === a.parentNode
        if (isAnchorParent) {
          bump(`Node.${method} (parent match)`)
          push(`Node.${method}`, {
            target: describe(this),
            arg0: describe(args[0] as Node | null),
          })
        }
        return orig.apply(this, args)
      } as never
    }
    // --- Round 6 first pass came back with near-ZERO Node.prototype calls (see the task-445
    // write-up) — Lute/Vditor almost certainly mutate via innerHTML/textContent/
    // insertAdjacentHTML, which bypass the IDL insertBefore/appendChild/removeChild/replaceChild
    // methods entirely at the engine level (they operate on the internal tree directly). Cover
    // those too. Match is broadened here (parent OR any ancestor containing the anchor) since an
    // innerHTML/textContent write on an ANCESTOR further up also destroys a descendant anchor.
    const isRelevant = (target: Node) => {
      const a = anchorNode()
      return (
        !!a && (target === a.parentNode || (target as Element).contains?.(a))
      )
    }
    const elProto = Element.prototype
    const innerHtmlDesc = Object.getOwnPropertyDescriptor(elProto, 'innerHTML')
    if (innerHtmlDesc?.set) {
      Object.defineProperty(elProto, 'innerHTML', {
        configurable: true,
        enumerable: innerHtmlDesc.enumerable,
        get: innerHtmlDesc.get,
        set(this: Element, v: string) {
          if (w.__armed) bump('Element.innerHTML= (calls)')
          if (isRelevant(this)) {
            bump('Element.innerHTML= (match)')
            push('Element.innerHTML=', {
              target: describe(this),
              newValue: v.length > 60 ? `${v.slice(0, 60)}…` : v,
            })
          }
          return innerHtmlDesc.set!.call(this, v)
        },
      })
    }
    const outerHtmlDesc = Object.getOwnPropertyDescriptor(elProto, 'outerHTML')
    if (outerHtmlDesc?.set) {
      Object.defineProperty(elProto, 'outerHTML', {
        configurable: true,
        enumerable: outerHtmlDesc.enumerable,
        get: outerHtmlDesc.get,
        set(this: Element, v: string) {
          if (w.__armed) bump('Element.outerHTML= (calls)')
          // outerHTML replaces `this` itself, so the relevant check is the anchor being INSIDE
          // `this` (this can't be the anchor's parent — it's being replaced wholesale).
          const a = anchorNode()
          if (a && this.contains?.(a)) {
            bump('Element.outerHTML= (match)')
            push('Element.outerHTML=', {
              target: describe(this),
              newValue: v.length > 60 ? `${v.slice(0, 60)}…` : v,
            })
          }
          return outerHtmlDesc.set!.call(this, v)
        },
      })
    }
    const origInsertAdjacentHTML = elProto.insertAdjacentHTML
    elProto.insertAdjacentHTML = function (
      this: Element,
      position: InsertPosition,
      text: string,
    ) {
      if (w.__armed) bump('Element.insertAdjacentHTML (calls)')
      if (isRelevant(this)) {
        bump('Element.insertAdjacentHTML (match)')
        push('Element.insertAdjacentHTML', {
          target: describe(this),
          position,
          text: text.length > 60 ? `${text.slice(0, 60)}…` : text,
        })
      }
      return origInsertAdjacentHTML.call(this, position, text)
    }
    const textContentDesc = Object.getOwnPropertyDescriptor(
      Node.prototype,
      'textContent',
    )
    if (textContentDesc?.set) {
      Object.defineProperty(Node.prototype, 'textContent', {
        configurable: true,
        enumerable: textContentDesc.enumerable,
        get: textContentDesc.get,
        set(this: Node, v: string | null) {
          if (w.__armed) bump('Node.textContent= (calls)')
          if (isRelevant(this)) {
            bump('Node.textContent= (match)')
            push('Node.textContent=', {
              target: describe(this),
              newValue:
                (v ?? '').length > 60 ? `${(v ?? '').slice(0, 60)}…` : v,
            })
          }
          return textContentDesc.set!.call(this, v)
        },
      })
    }

    // Round 6 second pass STILL came back with 0 matches despite confirming (via a caretHeight
    // readback) the symptom DID occur in the same run — meaning the mutation isn't going through
    // ANY of the JS-exposed IDL methods above either. The remaining candidate: `Range`/
    // `Selection` methods and `document.execCommand` are frequently implemented NATIVELY (engine
    // internals manipulate the DOM tree directly), and do not necessarily call back through the
    // patchable Node/CharacterData/Element prototype methods at all — a JS-level patch of
    // `appendChild` etc. cannot observe what a native `Range.deleteContents()`/`insertNode()`
    // does internally. Cover those too, logging every call while armed (no relevance filter —
    // these are rare enough not to flood the log, and we don't have a cheap "does this range
    // touch the anchor" check before the fact).
    const rangeProto = Range.prototype
    for (const method of [
      'deleteContents',
      'insertNode',
      'extractContents',
      'surroundContents',
    ] as const) {
      const orig = rangeProto[method] as (...args: unknown[]) => unknown
      rangeProto[method] = function (this: Range, ...args: unknown[]) {
        if (w.__armed) {
          bump(`Range.${method} (calls)`)
          push(`Range.${method}`, {
            startContainer: describe(this.startContainer),
            startOffset: this.startOffset,
            collapsed: this.collapsed,
          })
        }
        return orig.apply(this, args)
      } as never
    }
    const selProto = Selection.prototype
    for (const method of ['deleteFromDocument', 'extend'] as const) {
      const orig = selProto[method] as (...args: unknown[]) => unknown
      selProto[method] = function (this: Selection, ...args: unknown[]) {
        if (w.__armed) {
          bump(`Selection.${method} (calls)`)
          push(`Selection.${method}`, { args })
        }
        return orig.apply(this, args)
      } as never
    }
    const origExecCommand = Document.prototype.execCommand
    Document.prototype.execCommand = function (
      this: Document,
      cmd: string,
      ...rest: unknown[]
    ) {
      if (w.__armed) {
        bump(`document.execCommand(${cmd}) (calls)`)
        push('document.execCommand', { cmd, rest })
      }
      return origExecCommand.apply(this, [cmd, ...rest] as never)
    }
    const origNormalize = Node.prototype.normalize
    Node.prototype.normalize = function (this: Node) {
      if (w.__armed && isRelevant(this)) {
        bump('Node.normalize (match)')
        push('Node.normalize', { target: describe(this) })
      }
      return origNormalize.call(this)
    }

    ;(w as unknown as { __armCapture: () => void }).__armCapture = () => {
      w.__armed = true
    }
  })
}

async function readDiagnostics(frame: ReturnType<typeof wf>) {
  return frame.locator('body').evaluate(() => {
    const w = window as unknown as {
      __hooksInstalled?: boolean
      __callCounts?: Record<string, number>
    }
    return {
      hooksInstalled: !!w.__hooksInstalled,
      callCounts: w.__callCounts ?? {},
    }
  })
}

async function armCapture(frame: ReturnType<typeof wf>) {
  await frame.locator('body').evaluate(() => {
    ;(window as unknown as { __armCapture: () => void }).__armCapture()
  })
}

async function dumpStackLog(frame: ReturnType<typeof wf>): Promise<unknown[]> {
  return frame
    .locator('body')
    .evaluate(
      () => (window as unknown as { __stackLog: unknown[] }).__stackLog ?? [],
    )
}

function logStacks(label: string, log: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(
    `[stacktrace-probe] ${label} CAPTURED MUTATIONS (${log.length} entries):`,
  )
  for (const e of log) {
    // eslint-disable-next-line no-console
    console.log(`[stacktrace-probe]   ${JSON.stringify(e)}`)
  }
}

async function openFixture(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
) {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [fixture] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  return frame
}

async function probeStackTrace(
  workbox: import('@playwright/test').Page,
  evaluateInVSCode: EvaluateInVSCode,
  fixture: string,
  fixtureLabel: string,
  delayMs: number,
) {
  // MUST run before openFixture: addInitScript only affects frames navigated AFTER it's
  // registered.
  await installStackTraceHooks(workbox)

  const frame = await openFixture(workbox, evaluateInVSCode, fixture)
  await armCapture(frame)

  if (delayMs > 0) {
    await settle(frame, delayMs)
  }
  await frame
    .locator('.vditor-ir')
    .first()
    .click({ position: { x: 20, y: 12 } })
  // The round-5 probe showed the drop lands within ~0-300ms of the click — 1s is generous
  // margin, then dump.
  await settle(frame, 1000)

  // Sanity check: did the round-5 SYMPTOM (caretHeight -> 0) actually occur in THIS run? The
  // prototype patches here are much heavier than round 5's plain MutationObserver (every
  // innerHTML/textContent/appendChild/etc. call on the WHOLE page now runs through an extra JS
  // layer) — if that overhead shifts Vditor's own internal timing enough, the race window could
  // move and 0 captured entries would mean "didn't reproduce this run", not "hooks missed it".
  const caretHeight = await frame.locator('body').evaluate(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return -1
    return Math.round(sel.getRangeAt(0).getBoundingClientRect().height)
  })
  // eslint-disable-next-line no-console
  console.log(
    `[stacktrace-probe] ${fixtureLabel} delay=+${delayMs}ms caretHeight at +1000ms: ${caretHeight}`,
  )

  const log = await dumpStackLog(frame)
  logStacks(`${fixtureLabel} delay=+${delayMs}ms`, log)
  const diag = await readDiagnostics(frame)
  // eslint-disable-next-line no-console
  console.log(
    `[stacktrace-probe] ${fixtureLabel} delay=+${delayMs}ms DIAGNOSTICS: ${JSON.stringify(diag)}`,
  )
}

test('probe: call-stack trace, with-text doc, click at +0ms @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probeStackTrace(workbox, evaluateInVSCode, TEXT_FIXTURE, 'with-text', 0)
})

test('probe: call-stack trace, with-text doc, click at +150ms @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probeStackTrace(
    workbox,
    evaluateInVSCode,
    TEXT_FIXTURE,
    'with-text',
    150,
  )
})

test('probe: call-stack trace, empty doc, click at +0ms @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probeStackTrace(workbox, evaluateInVSCode, EMPTY_FIXTURE, 'empty', 0)
})

test('probe: call-stack trace, empty doc, click at +300ms @probe', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(90_000)
  await probeStackTrace(workbox, evaluateInVSCode, EMPTY_FIXTURE, 'empty', 300)
})
