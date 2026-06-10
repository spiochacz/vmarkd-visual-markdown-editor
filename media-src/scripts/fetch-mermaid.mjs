#!/usr/bin/env node
/*
 * fetch-mermaid — pin & vendor a Mermaid build at an explicit version.
 *
 * Vditor bundles Mermaid 11.6.0; we vendor a newer build (same major, API-compatible:
 * exposes globalThis.mermaid with initialize/render) so diagrams get upstream fixes.
 * build.mjs (`syncMermaid`) verifies the sha256 and copies it over Vditor's copy;
 * esbuild-shared.mjs bumps the `?v=` cache-buster to this version. See tasks/86.
 *
 * Usage:
 *   node media-src/scripts/fetch-mermaid.mjs <version>   e.g. 11.15.0
 *
 * Writes media-src/vendor/mermaid/{mermaid.min.js,LICENSE,source.json}. Verify the
 * fetched file still ends by exposing `globalThis.mermaid` (the global build Vditor loads).
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const VENDOR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../vendor/mermaid',
)

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function getBuf(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'vmarkd-fetch-mermaid' } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
  return Buffer.from(await res.arrayBuffer())
}

async function main() {
  const version = process.argv[2]
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('Usage: node media-src/scripts/fetch-mermaid.mjs <version>  (e.g. 11.15.0)')
    process.exit(1)
  }
  const jsUrl = `https://unpkg.com/mermaid@${version}/dist/mermaid.min.js`
  const licUrl = `https://unpkg.com/mermaid@${version}/LICENSE`

  const js = await getBuf(jsUrl)
  const text = js.toString('utf8')
  if (!/globalThis(\.|\[")mermaid/.test(text)) {
    throw new Error(
      'fetched mermaid.min.js does not expose globalThis.mermaid — wrong build (Vditor loads the global UMD build).',
    )
  }
  const lic = await getBuf(licUrl)

  await fs.mkdir(VENDOR_DIR, { recursive: true })
  await fs.writeFile(path.join(VENDOR_DIR, 'mermaid.min.js'), js)
  await fs.writeFile(path.join(VENDOR_DIR, 'LICENSE'), lic)
  const source = {
    package: 'mermaid',
    version,
    fetchedFrom: jsUrl,
    sha256: sha256(js),
    license: 'MIT',
    note: 'Vditor bundles Mermaid 11.6.0; we vendor a newer build (same major, API-compatible). build.mjs (syncMermaid) verifies sha256; esbuild-shared.mjs bumps the ?v= cache-buster.',
  }
  await fs.writeFile(
    path.join(VENDOR_DIR, 'source.json'),
    `${JSON.stringify(source, null, 2)}\n`,
  )
  console.log(`[fetch-mermaid] pinned v${version} (sha256 ${source.sha256.slice(0, 12)}…)`)
  console.log('Remember to update the NOTICE version + tasks/86 + CHANGELOG.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
