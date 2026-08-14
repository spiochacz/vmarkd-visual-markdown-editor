import { wf } from './webview-helpers'
// Opt-in ELK layout for mermaid graph diagrams (vmarkd.diagram.mermaid.layout=elk, task 112) —
// real-VS-Code only.
//
// mermaid ≥10.3 makes layout pluggable; we register the official @mermaid-js/layout-elk adapter (lazy
// bundle mermaid-elk-main.js) whose `elkjs` is aliased to the ONE shared main-thread ELK we ship for D2
// (window.__vmarkdElk). The stock elkjs blob Worker is REJECTED by the VS Code webview, so this MUST be
// proven in real VS Code (the Playwright harness can't reproduce the resource-URI/CSP pipeline). We
// prove: (a) the adapter loads + registers only when ELK is active (dagre docs stay lazy), (b) the
// shared ELK boots and elk.layout() RESOLVES in the webview, (c) the ELK render's geometry differs from
// dagre (so it is NOT a silent dagre fallback), (d) a live setting flip re-renders, and (e) a
// per-diagram directive pulls the adapter even under a dagre global.
import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'
import { useSettingsRestore } from './settings-helpers'

const FIXTURE = path.join(__dirname, 'fixtures', 'mermaid-elk.md')
const DIRECTIVE = path.join(__dirname, 'fixtures', 'mermaid-elk-directive.md')

// Both tests flip diagram.mermaid.layout live (dagre↔elk) — the behaviour under test — and to
// different values across tests, so it can't be pinned.
useSettingsRestore(test, ['vmarkd.diagram.mermaid.layout'])

// Close any prior editor (workers:1 → same VS Code instance; reopening the same custom-editor URI would
// reveal the previous webview instead of a fresh one), set the layout setting, then open the fixture.
// `layout` is a plain string ('dagre' | 'elk') — vscode-test-playwright's arg serializer rejects a null
// element, and setting 'dagre' explicitly is behaviourally the default (no ELK). collectConfigOptions
// reads the setting at OPEN.
async function openFresh(
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
  uri: string,
  layout: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [string, string]) => {
      const [u, lay] = args
      await vscode.commands.executeCommand('workbench.action.closeAllEditors')
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('diagram.mermaid.layout', lay, true)
      await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
      await vscode.commands.executeCommand(
        'vscode.openWith',
        vscode.Uri.file(u),
        'vmarkd.editor',
      )
    },
    [uri, layout] as [string, string],
  )
}

// Update the live setting WITHOUT reopening — exercises the onDidChangeConfiguration → config-changed →
// rethemeDiagrams live re-render path.
async function updateLayout(
  evaluateInVSCode: (fn: unknown, args: unknown) => Promise<unknown>,
  layout: string,
) {
  await evaluateInVSCode(
    async (vscode: typeof import('vscode'), args: [string]) => {
      await vscode.workspace
        .getConfiguration('vmarkd')
        .update('diagram.mermaid.layout', args[0], true)
    },
    [layout] as [string],
  )
}

// A layout signature of the rendered mermaid SVG: overall dimensions + sorted element transforms +
// total edge-path length. Standalone (only touches `document`) so Playwright can serialize it to the
// webview. dagre and ELK produce different values for the branching fixture.
function mermaidGeom() {
  const svg = document.querySelector('.language-mermaid svg')
  if (!svg) return null
  const transforms = [...svg.querySelectorAll('[transform]')]
    .map((e) => e.getAttribute('transform'))
    .filter(Boolean)
    .sort()
    .join('|')
  const pathLen = [...svg.querySelectorAll('path')]
    .map((p) => (p.getAttribute('d') || '').length)
    .reduce((a, b) => a + b, 0)
  return {
    box:
      svg.getAttribute('viewBox') ||
      `${svg.getAttribute('width')}x${svg.getAttribute('height')}`,
    transforms,
    pathLen,
  }
}

async function waitForMermaid(frame: ReturnType<typeof wf>) {
  await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
  await frame
    .locator('.language-mermaid svg')
    .first()
    .waitFor({ timeout: 60_000 })
}

test('dagre and ELK differ, and a live layout flip re-renders the same diagram', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(300_000)

  // ── Baseline: dagre (default). Two fresh opens (below) make the elk≠dagre proof DETERMINISTIC — no
  // reliance on a live config-change round-trip. This open also proves the lazy-load saving: a dagre
  // doc must NOT fetch the ELK adapter. ──
  await openFresh(evaluateInVSCode, FIXTURE, 'dagre')
  let frame = wf(workbox)
  await waitForMermaid(frame)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 2000)))
  const dagreBundle = await frame
    .locator('body')
    .evaluate(() => !!document.getElementById('vditorMermaidElkScript'))
  expect
    .soft(dagreBundle, 'a dagre doc must NOT fetch mermaid-elk-main.js')
    .toBe(false)
  const dagreGeom = await frame.locator('body').evaluate(mermaidGeom)
  expect.soft(dagreGeom, 'dagre render produced a mermaid SVG').not.toBeNull()

  // ── ELK: fresh open. Adapter registers, the shared main-thread ELK boots + resolves, and the render
  // geometry differs from dagre. ──
  await openFresh(evaluateInVSCode, FIXTURE, 'elk')
  frame = wf(workbox)
  await waitForMermaid(frame)
  // Deterministic "elk path is wired" signal: the adapter finished loading + registered.
  await expect.soft
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(
            () => (window as any).__vmarkdMermaidElkRegistered === true,
          ),
      { timeout: 30_000 },
    )
    .toBe(true)
  await frame
    .locator('body')
    .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

  const boot = await frame.locator('body').evaluate(() => ({
    layout: (window as any).__vmarkdMermaidLayout,
    bundle: !!document.getElementById('vditorMermaidElkScript'),
    registered: (window as any).__vmarkdMermaidElkRegistered === true,
    hasElk: typeof (window as any).__vmarkdElk?.layout === 'function',
  }))
  // eslint-disable-next-line no-console
  console.log(`[mermaid-elk] boot: ${JSON.stringify(boot)}`)
  expect.soft(boot.layout).toBe('elk')
  expect.soft(boot.bundle).toBe(true)
  expect.soft(boot.registered).toBe(true)
  expect.soft(boot.hasElk).toBe(true)

  // The blob-worker mandate: elk.layout() RESOLVES in the real webview (the exact call that rejects with
  // the stock blob Worker) — here via the shared window.__vmarkdElk instance.
  const layout = await frame.locator('body').evaluate(async () => {
    try {
      const res: any = await (window as any).__vmarkdElk.layout({
        id: 'root',
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN' },
        children: [
          { id: 'a', width: 60, height: 30 },
          { id: 'b', width: 60, height: 30 },
        ],
        edges: [{ id: 'e1', sources: ['a'], targets: ['b'] }],
      })
      return {
        ok: true,
        positioned: (res.children || []).every(
          (n: any) => typeof n.x === 'number' && typeof n.y === 'number',
        ),
      }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })
  // eslint-disable-next-line no-console
  console.log(`[mermaid-elk] layout: ${JSON.stringify(layout)}`)
  expect
    .soft(
      layout.ok,
      `elk.layout must resolve in the webview: ${(layout as any).error ?? ''}`,
    )
    .toBe(true)
  expect.soft(layout.positioned).toBe(true)

  const elkGeom = await frame.locator('body').evaluate(mermaidGeom)
  expect.soft(elkGeom, 'elk render produced a mermaid SVG').not.toBeNull()
  // eslint-disable-next-line no-console
  console.log(
    `[mermaid-elk] elk.box=${elkGeom?.box} dagre.box=${dagreGeom?.box} elk.pathLen=${elkGeom?.pathLen} dagre.pathLen=${dagreGeom?.pathLen}`,
  )
  // The core proof: same graph, different engine ⟹ different geometry. If ELK had silently fallen back
  // to dagre, these would be identical.
  expect.soft(elkGeom?.transforms).not.toBe(dagreGeom?.transforms)

  // Flip to dagre LIVE (no reopen) → onDidChangeConfiguration → config-changed → rethemeDiagrams
  // re-renders mermaid offscreen. Wait (generously — the config round-trip can be slow on a cold host)
  // for the swap to land, i.e. the geometry to change away from the ELK layout.
  await updateLayout(evaluateInVSCode, 'dagre')
  await expect.soft
    .poll(
      async () =>
        (await frame.locator('body').evaluate(mermaidGeom))?.transforms,
      { timeout: 60_000 },
    )
    .not.toBe(elkGeom?.transforms)
})

test('a per-diagram %%{init:{layout:elk}}%% directive pulls the adapter even under a dagre global', async ({
  workbox,
  evaluateInVSCode,
}) => {
  test.setTimeout(120_000)
  await openFresh(evaluateInVSCode, DIRECTIVE, 'dagre') // global setting stays dagre
  const frame = wf(workbox)
  await waitForMermaid(frame)
  await expect
    .poll(
      () =>
        frame
          .locator('body')
          .evaluate(
            () => (window as any).__vmarkdMermaidElkRegistered === true,
          ),
      { timeout: 30_000 },
    )
    .toBe(true)
  const state = await frame.locator('body').evaluate(() => ({
    globalLayout: (window as any).__vmarkdMermaidLayout ?? 'dagre',
    bundle: !!document.getElementById('vditorMermaidElkScript'),
    registered: (window as any).__vmarkdMermaidElkRegistered === true,
  }))
  // eslint-disable-next-line no-console
  console.log(`[mermaid-elk] directive: ${JSON.stringify(state)}`)
  expect(state.globalLayout).not.toBe('elk') // the GLOBAL setting never became elk…
  expect(state.bundle).toBe(true) // …yet docRequestsMermaidElk pulled the adapter for the directive
  expect(state.registered).toBe(true)
})
