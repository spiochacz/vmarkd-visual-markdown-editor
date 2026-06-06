import { test, expect } from './coverage-fixture'
import type { Page } from '@playwright/test'

// E2e for wiki-link rendering via Lute custom renderers (setupCustomRenderer).
// The harness creates a real Vditor (IR) with wiki enabled and knownPages
// pre-populated. Tests verify: chip rendering, missing vs existing states,
// pipe syntax, knownPages live update, and multi-chip lines.

async function gotoWiki(page: Page) {
  await page.goto('/wiki.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

function chips(page: Page) {
  return page.locator('.wiki-link-chip')
}

function chip(page: Page, target: string) {
  return page.locator(`.wiki-link-chip[data-wiki-target="${target}"]`)
}

test('renders [[wiki]] syntax as chip spans in the IR editor', async ({
  page,
}) => {
  await gotoWiki(page)
  const count = await chips(page).count()
  // Home, Missing Page, Target (pipe), Alpha, Beta, Gamma, Page A, Bold Link
  expect(count).toBeGreaterThanOrEqual(8)
})

test('existing pages get blue chips (no data-wiki-missing)', async ({
  page,
}) => {
  await gotoWiki(page)
  const homeChip = chip(page, 'Home')
  await expect(homeChip).toBeVisible()
  expect(await homeChip.getAttribute('data-wiki-missing')).toBeNull()
})

test('missing pages get the missing attribute', async ({ page }) => {
  await gotoWiki(page)
  const missingChip = chip(page, 'Missing Page')
  await expect(missingChip).toBeVisible()
  expect(await missingChip.getAttribute('data-wiki-missing')).toBe('1')
})

test('pipe syntax: [[Target|Display Label]] shows the label, targets the key', async ({
  page,
}) => {
  await gotoWiki(page)
  const pipeChip = chip(page, 'Target')
  await expect(pipeChip).toBeVisible()
  await expect(pipeChip).toHaveText('Display Label')
  expect(await pipeChip.getAttribute('data-wiki-missing')).toBeNull()
})

test('chip has correct data attributes for round-trip', async ({ page }) => {
  await gotoWiki(page)
  const homeChip = chip(page, 'Home')
  expect(await homeChip.getAttribute('data-wiki-link')).toBe('1')
  expect(await homeChip.getAttribute('data-wiki-source')).toBe('[[Home]]')
})

test('updating knownPages and re-rendering flips missing to existing', async ({
  page,
}) => {
  await gotoWiki(page)
  expect(
    await chip(page, 'Missing Page').getAttribute('data-wiki-missing'),
  ).toBe('1')

  // Add "missing-page" to knownPages and re-render with original markdown.
  // setValue(getValue()) would lose [[wiki]] syntax (Lute 3.11 dropped
  // VditorIRDOM2Md reverse renderers), so the harness exposes __reRender.
  await page.evaluate(() => {
    ;(window as any).__setKnownPages([
      'home',
      'alpha',
      'beta',
      'target',
      'missing-page',
    ])
    ;(window as any).__reRender()
  })
  await page.waitForFunction(
    () => document.querySelector('[data-wiki-target="Missing Page"]') !== null,
  )
  expect(
    await chip(page, 'Missing Page').getAttribute('data-wiki-missing'),
  ).toBeNull()
})

test('removing from knownPages and re-rendering flips existing to missing', async ({
  page,
}) => {
  await gotoWiki(page)
  expect(await chip(page, 'Home').getAttribute('data-wiki-missing')).toBeNull()

  await page.evaluate(() => {
    ;(window as any).__setKnownPages(['alpha', 'beta', 'target'])
    ;(window as any).__reRender()
  })
  await page.waitForFunction(
    () => document.querySelector('[data-wiki-target="Home"]') !== null,
  )
  expect(await chip(page, 'Home').getAttribute('data-wiki-missing')).toBe('1')
})

test('getValue() round-trips wiki syntax without corruption', async ({
  page,
}) => {
  await gotoWiki(page)
  const md = await page.evaluate(() => (window as any).vditor.getValue())
  expect(md).toContain('[[Home]]')
  expect(md).toContain('[[Missing Page]]')
  expect(md).toContain('[[Target|Display Label]]')
  expect(md).toContain('[[Alpha]]')
  expect(md).toContain('[[Beta]]')
  expect(md).toContain('[[Gamma]]')
})

test('multiple chips on the same line all render', async ({ page }) => {
  await gotoWiki(page)
  const alpha = chip(page, 'Alpha')
  const beta = chip(page, 'Beta')
  const gamma = chip(page, 'Gamma')
  await expect(alpha).toBeVisible()
  await expect(beta).toBeVisible()
  await expect(gamma).toBeVisible()
  // Alpha and Beta are in knownPages, Gamma is not
  expect(await alpha.getAttribute('data-wiki-missing')).toBeNull()
  expect(await beta.getAttribute('data-wiki-missing')).toBeNull()
  expect(await gamma.getAttribute('data-wiki-missing')).toBe('1')
})
