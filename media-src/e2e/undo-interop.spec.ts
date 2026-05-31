import { test, expect } from './coverage-fixture'

// Regression guard for the task-20 source-import build. Vditor's undo engine
// constructs `new DiffMatchPatch()` in the Vditor constructor (index.ts:504 →
// undo/index.ts). diff-match-patch is a CommonJS module whose export IS the
// constructor; bundling Vditor from source re-exposes the esModuleInterop pitfall
// where `import * as` yields a non-callable namespace. esbuild-shared.mjs rewrites
// that import to a default import — assert the engine's dmp is actually functional
// (a broken interop would either throw at init or leave dmp without patch_make).
test('undo engine has a working DiffMatchPatch (task 20 interop)', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => (window as any).__ready === true)
  const result = await page.evaluate(() => {
    const dmp = (window as any).vditor?.vditor?.undo?.dmp
    if (!dmp || typeof dmp.patch_make !== 'function') return { ok: false }
    const patches = dmp.patch_make('hello', 'hello world')
    return { ok: Array.isArray(patches) && patches.length === 1 }
  })
  expect(result.ok).toBe(true)
})
