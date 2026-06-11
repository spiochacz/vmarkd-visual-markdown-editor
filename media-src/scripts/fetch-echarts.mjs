#!/usr/bin/env node
/*
 * fetch-echarts — pin & vendor an Apache ECharts build at an explicit version.
 *
 * Vditor bundles ECharts 5.5.1; we vendor a newer build (the global UMD that exposes
 * `window.echarts`, the form Vditor loads via addScript) so charts get upstream fixes.
 * build.mjs (`syncEcharts`) verifies the sha256 and copies it over Vditor's copy;
 * esbuild-shared.mjs bumps the `?v=` cache-buster to this version. See tasks/89.
 *
 * NOTE: ECharts 6 is a MAJOR bump (new default theme/palette + option changes) — re-verify
 * render fidelity against a chart corpus before shipping (unlike the same-major Mermaid bump).
 *
 * Usage:
 *   node media-src/scripts/fetch-echarts.mjs <version>   e.g. 6.1.0
 *
 * Writes media-src/vendor/echarts/{echarts.min.js,LICENSE,source.json}. Verify the fetched
 * file still exposes the `echarts` global (the global UMD build Vditor loads via a <script>).
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const VENDOR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../vendor/echarts',
)

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function getBuf(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'vmarkd-fetch-echarts' },
  })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const version = process.argv[2]
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(
      'Usage: node media-src/scripts/fetch-echarts.mjs <version>  (e.g. 6.1.0)',
    )
    process.exit(1)
  }
  const jsUrl = `https://unpkg.com/echarts@${version}/dist/echarts.min.js`
  const licUrl = `https://unpkg.com/echarts@${version}/LICENSE`

  const js = await getBuf(jsUrl)
  const text = js.toString('utf8')
  // The global UMD build assigns `…global.echarts = {}` in its factory; the ESM/CJS-only
  // builds don't. Guard against accidentally vendoring a non-global build.
  if (!/\.echarts\s*=\s*\{\}/.test(text)) {
    throw new Error(
      'fetched echarts.min.js does not expose the `echarts` global — wrong build (Vditor loads the global UMD build).',
    )
  }
  if (!text.includes(`version="${version}"`)) {
    throw new Error(
      `fetched echarts.min.js does not self-report version="${version}" — version mismatch.`,
    )
  }
  const lic = await getBuf(licUrl)

  await fs.mkdir(VENDOR_DIR, { recursive: true })
  await fs.writeFile(path.join(VENDOR_DIR, 'echarts.min.js'), js)
  await fs.writeFile(path.join(VENDOR_DIR, 'LICENSE'), lic)
  const source = {
    package: 'echarts',
    version,
    fetchedFrom: jsUrl,
    sha256: sha256(js),
    license: 'Apache-2.0',
    note: 'Vditor bundles ECharts 5.5.1; we vendor a newer build (global UMD exposing window.echarts). build.mjs (syncEcharts) verifies sha256; esbuild-shared.mjs bumps the ?v= cache-buster. ECharts 6 is a MAJOR bump — re-verify render fidelity. Re-pin with: node media-src/scripts/fetch-echarts.mjs <version>.',
  }
  await fs.writeFile(
    path.join(VENDOR_DIR, 'source.json'),
    `${JSON.stringify(source, null, 2)}\n`,
  )
  console.log(
    `[fetch-echarts] pinned v${version} (sha256 ${source.sha256.slice(0, 12)}…)`,
  )
  console.log('Remember to update the NOTICE version + tasks/89 + CHANGELOG.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
