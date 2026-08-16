import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { usePinnedSettings } from './settings-helpers'
import { wf } from './webview-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'prerender-style-parity.md')

const probes = {
  heading: ':scope > h1',
  paragraph: ':scope > p',
  list: ':scope > ul',
  quote: ':scope > blockquote',
  table: ':scope > table',
  code: ':scope > div[data-type="code-block"]',
} as const

type Metrics = Record<string, string | number>
type Snapshot = Record<keyof typeof probes, Metrics>

function readSnapshot(
  frame: ReturnType<typeof wf>,
  rootSelector: string,
): Promise<Snapshot> {
  // Built with a typed `reduce` (keyed by the actual `probes` names) rather than
  // `Object.fromEntries`, whose lib.es2019 typing always widens to a `{ [k: string]: V }` index
  // signature — that shape can never satisfy `Snapshot`'s named keys, which is what made the old
  // `as Promise<Snapshot>` on the whole call an unsound cast (TS2352). Typing the builder itself
  // makes `evaluate`'s return type infer as `Snapshot` directly, so no cast is needed here at all.
  return frame.locator('body').evaluate(
    (_body, { rootSelector, probes }) => {
      const root = document.querySelector(rootSelector)
      if (!root) throw new Error(`missing parity root: ${rootSelector}`)
      return (Object.keys(probes) as (keyof typeof probes)[]).reduce(
        (acc, name) => {
          const element = root.querySelector(probes[name]) as HTMLElement | null
          if (!element) throw new Error(`missing parity probe: ${name}`)
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          acc[name] = {
            backgroundColor: style.backgroundColor,
            color: style.color,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            marginBottom: style.marginBottom,
            marginTop: style.marginTop,
            paddingBottom: style.paddingBottom,
            paddingLeft: style.paddingLeft,
            paddingRight: style.paddingRight,
            paddingTop: style.paddingTop,
            height: Math.round(rect.height * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            x: Math.round(rect.x * 100) / 100,
            y: Math.round(rect.y * 100) / 100,
          }
          return acc
        },
        {} as Snapshot,
      )
    },
    { rootSelector, probes },
  )
}

// The overlay is ephemeral: `removePrerenderOverlay` deletes it the moment the live editor is
// themed, and the hold that keeps it around for this comparison is gated on
// VMARKD_PRERENDER_PARITY_HOLD (html-builder.ts) — which nothing set. So the spec waited 45 s for an
// element that had already been removed and failed on a clean `main` too; the product was fine
// (task 516 full-suite triage).
//
// Set it here rather than in playwright.config: `vscode-test-playwright` copies `process.env` into
// VS Code at LAUNCH, and each test boots its own instance, so a file-scoped beforeAll/afterAll gives
// exactly this file's tests the hold. A config-level export would hold the overlay for every spec in
// the suite — the overlay covers the editor, so that would break unrelated tests. Files share a
// worker sequentially, never concurrently, so the window really is bounded.
test.beforeAll(() => {
  process.env.VMARKD_PRERENDER_PARITY_HOLD = '1'
})
test.afterAll(() => {
  // `delete`, NOT `= undefined`: assigning undefined to process.env stores the STRING "undefined",
  // which is truthy, so html-builder would keep emitting the hold for every spec that runs later in
  // this worker. That shipped once and made preview-widgets.spec.ts flaky — it waits for
  // `#vmarkd-prerender` to detach and the overlay was being held forever.
  delete process.env.VMARKD_PRERENDER_PARITY_HOLD
})

// Pin the content theme instead of inheriting one. ~40 specs write `vmarkd.theme.content` at
// ConfigurationTarget.Global and most never reset it, and the whole suite shares one profile — so
// whatever ran before decides the metrics here. That matters for THIS spec specifically: the host
// overlay picks its stylesheet at HTML-build time while the settled editor uses the live content
// theme, so an inherited theme can make the two disagree and the parity assert fails on a height
// that is nobody's bug (measured: 47 vs 56.39, only ever in a full-suite run, 12/12 green solo).
usePinnedSettings(test, {
  'vmarkd.theme.content': 'auto',
})

test('host prerender and settled IR keep static Markdown styles identical', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(args[0]),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )

  const frame = wf(workbox)
  const overlay = frame.locator('#vmarkd-prerender')
  await overlay.waitFor({ timeout: 45_000 })
  const before = await readSnapshot(frame, '#vmarkd-prerender .vditor-reset')

  await expect
    .poll(() =>
      frame.locator('body').evaluate(
        () =>
          typeof (
            window as typeof window & {
              __vmarkdReleasePrerender?: () => void
            }
          ).__vmarkdReleasePrerender,
      ),
    )
    .toBe('function')
  await frame.locator('body').evaluate(() => {
    const release = (
      window as typeof window & {
        __vmarkdReleasePrerender?: () => void
      }
    ).__vmarkdReleasePrerender
    if (!release) throw new Error('prerender parity hold is unavailable')
    release()
  })
  await overlay.waitFor({ state: 'detached', timeout: 45_000 })

  const after = await readSnapshot(frame, '.vditor-ir .vditor-reset')
  // Both snapshots in full, always. Playwright's deep-equal diff prints only the differing hunk
  // WITHOUT naming which probe it belongs to, which made an intermittent height mismatch (47 vs
  // 56.39, task 516 triage) impossible to attribute from a CI log alone.
  // eslint-disable-next-line no-console
  console.log(
    `[parity] before=${JSON.stringify(before)}\n[parity] after=${JSON.stringify(after)}`,
  )
  expect(after).toEqual(before)
})
