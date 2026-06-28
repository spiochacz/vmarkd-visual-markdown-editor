import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// MEASUREMENT (not a gate): open the all-renderers fixture (2 code blocks at the top + ~15 diagrams)
// in the real VS Code webview and poll the DOM on a fixed cadence to see WHEN code-block colouring
// lands relative to diagram rendering — to diagnose "code colouring is delayed behind the diagrams"
// (task 145 follow-up). Prints a timeline to stdout; the assertion is trivial so it never blocks CI.
const FIXTURE = path.join(__dirname, 'fixtures', 'all-renderers.md')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

test('perf timeline: code colouring vs diagram render', async ({
  workbox,
  evaluateInVSCode,
}) => {
  await evaluateInVSCode(
    async (vscode, args) => {
      const [uri] = args as [string]
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(uri),
        'vmarkd.editor',
      )
    },
    [FIXTURE] as [string],
  )
  const frame = wf(workbox)
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })

  const t0 = Date.now()
  const timeline: Array<Record<string, number | boolean>> = []
  for (let i = 0; i < 60; i++) {
    const snap = await frame.locator('body').evaluate(() => {
      const q = (s: string) => document.querySelectorAll(s).length
      const codePreviews = Array.from(
        document.querySelectorAll('.vditor-ir__preview code.hljs'),
      )
      const codeColored = codePreviews.filter(
        (c) => c.querySelector('span[class^="hljs-"]') !== null,
      ).length
      return {
        hljs: !!(window as { hljs?: unknown }).hljs,
        codeHljs: codePreviews.length, // code blocks tagged .hljs
        codeColored, // …that actually have token spans (visibly coloured)
        d2: q('.language-d2 svg'),
        mermaid: q('.language-mermaid svg'),
        graphviz: q('.language-graphviz svg'),
        plantuml: q('.language-plantuml svg'),
        wavedrom: q('.language-wavedrom svg'),
      }
    })
    timeline.push({ t: Date.now() - t0, ...snap })
    // Stop early once code is coloured AND D2 (the heaviest) has rendered.
    if (snap.codeColored > 0 && snap.d2 > 0 && i > 3) break
    await new Promise((r) => setTimeout(r, 100))
  }

  const firstColored = timeline.find((e) => (e.codeColored as number) > 0)
  const firstD2 = timeline.find((e) => (e.d2 as number) > 0)
  const firstHljs = timeline.find((e) => e.hljs === true)
  // eslint-disable-next-line no-console
  console.log(`[perf] timeline: ${JSON.stringify(timeline)}`)
  // eslint-disable-next-line no-console
  console.log(
    `[perf] hljs loaded @${firstHljs?.t ?? 'never'}ms · code COLOURED @${firstColored?.t ?? 'never'}ms · D2 rendered @${firstD2?.t ?? 'never'}ms`,
  )
  expect(timeline.length).toBeGreaterThan(0)
})
