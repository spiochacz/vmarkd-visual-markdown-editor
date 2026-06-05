import { expect, test } from './coverage-fixture'

/**
 * E2e for task 74 image conversion — exercises the REAL OffscreenCanvas WebP
 * encode in Chromium (the path unit tests mock). Generates real PNG bytes,
 * runs convertForUpload, and checks the output's magic bytes + dimensions.
 */

async function goto(page: any) {
  await page.goto('/image-convert.html')
  await page.waitForFunction(() => (window as any).__ready === true)
}

test('PNG → WebP, renamed, dimensions preserved', async ({ page }) => {
  await goto(page)
  const r = await page.evaluate(() =>
    (window as any).__run(
      { format: 'webp', quality: 80 },
      { width: 120, height: 80, name: 'shot.png' },
    ),
  )
  expect(r.isWebp).toBe(true)
  expect(r.name).toBe('shot.webp')
  expect(r.width).toBe(120)
  expect(r.height).toBe(80)
})

test('maxWidth downscales WebP, aspect ratio preserved', async ({ page }) => {
  await goto(page)
  const r = await page.evaluate(() =>
    (window as any).__run(
      { format: 'webp', maxWidth: 60 },
      { width: 240, height: 120, name: 'big.png' },
    ),
  )
  expect(r.isWebp).toBe(true)
  expect(r.width).toBe(60)
  expect(r.height).toBe(30)
})

test('maxWidth downscales an ORIGINAL raster (re-encoded to its own format)', async ({
  page,
}) => {
  await goto(page)
  const r = await page.evaluate(() =>
    (window as any).__run(
      { format: 'original', maxWidth: 50 },
      { width: 200, height: 100, name: 'a.png' },
    ),
  )
  expect(r.isPng).toBe(true)
  expect(r.name).toBe('a.png')
  expect(r.width).toBe(50)
  expect(r.height).toBe(25)
})

test('original + no maxWidth passes the PNG through unchanged', async ({
  page,
}) => {
  await goto(page)
  const r = await page.evaluate(() =>
    (window as any).__run(
      { format: 'original', maxWidth: 0 },
      { width: 100, height: 100, name: 'a.png' },
    ),
  )
  expect(r.isPng).toBe(true)
  expect(r.name).toBe('a.png')
})

test('SVG is never converted, even with format webp', async ({ page }) => {
  await goto(page)
  const r = await page.evaluate(() =>
    (window as any).__runSvg({ format: 'webp', quality: 80 }),
  )
  expect(r.passthrough).toBe(true)
  expect(r.name).toBe('icon.svg')
  expect(r.type).toBe('image/svg+xml')
})
