#!/usr/bin/env node
/*
 * fetch-lute — pin & vendor the Lute markdown engine (88250/lute) at an explicit commit.
 *
 * Lute is the GopherJS-compiled markdown parser Vditor loads as `lute.min.js`. We
 * vendor a prebuilt build from a chosen commit (committed to the repo) so the build
 * is reproducible and offline — see tasks/66.
 *
 * Usage:
 *   node media-src/scripts/fetch-lute.mjs --list [N]   list recent commits that rebuilt
 *                                                      javascript/lute.min.js (pin candidates)
 *   node media-src/scripts/fetch-lute.mjs <commit-sha> vendor lute.min.js+.map+LICENSE at that SHA
 *
 * Writes media-src/vendor/lute/{lute.min.js,lute.min.js.map,LICENSE,NOTICE,source.json}.
 * build.mjs verifies source.json.sha256 against the vendored file and copies it over
 * Vditor's bundled copy.
 *
 * Lute is MIT-compatible permissive (Mulan PSL v2). Distribution requires shipping the
 * license + retaining the copyright/disclaimer notice (Mulan PSL v2 §4) — handled here
 * (LICENSE + NOTICE) and propagated into the shipped media/ tree by build.mjs.
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const REPO = '88250/lute'
const VENDOR_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../vendor/lute',
)
const LUTE_PATH = 'javascript/lute.min.js'

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'vmarkd-fetch-lute' } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`)
  return res.text()
}

async function listCandidates(n = 15) {
  const url = `https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(LUTE_PATH)}&per_page=${n}`
  const res = await fetch(url, { headers: { 'User-Agent': 'vmarkd-fetch-lute' } })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  const commits = await res.json()
  console.log(`Recent commits that rebuilt ${LUTE_PATH} (= safe pin candidates):\n`)
  for (const c of commits) {
    const sha = c.sha
    const date = c.commit.committer.date.slice(0, 10)
    const msg = c.commit.message.split('\n')[0].slice(0, 80)
    console.log(`  ${date}  ${sha}  ${msg}`)
  }
  console.log(`\nPin one with:  node media-src/scripts/fetch-lute.mjs <sha>`)
}

async function vendor(sha) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`not a commit sha: ${sha}`)
  }
  const raw = (p) => `https://raw.githubusercontent.com/${REPO}/${sha}/${p}`
  console.log(`Fetching Lute @ ${sha} …`)

  const [js, map, license] = await Promise.all([
    getText(raw(LUTE_PATH)),
    getText(raw(`${LUTE_PATH}.map`)),
    getText(raw('LICENSE')),
  ])

  // sanity: this must be the GopherJS bundle that exposes the Lute global
  if (!js.includes('$goVersion') || !js.includes('Lute')) {
    throw new Error(
      'fetched lute.min.js does not look like a GopherJS Lute bundle — wrong commit/path?',
    )
  }
  const goVersion = (js.match(/\$goVersion\s*=\s*"([^"]+)"/) || [])[1] || 'unknown'

  // The pinned commit's date — surfaced in the editor's About/Info dialog so the
  // shown Lute build links to the exact commit + date (Lute.Version reports a stale
  // tag on master). Best-effort: a network/rate-limit failure must not break vendoring.
  let committedAt = ''
  try {
    const meta = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}`, {
      headers: { 'User-Agent': 'vmarkd-fetch-lute' },
    })
    if (meta.ok) {
      committedAt = ((await meta.json())?.commit?.committer?.date || '').slice(0, 10)
    }
  } catch {
    /* offline / rate-limited — leave committedAt empty */
  }

  await fs.mkdir(VENDOR_DIR, { recursive: true })
  await fs.writeFile(path.join(VENDOR_DIR, 'lute.min.js'), js)
  await fs.writeFile(path.join(VENDOR_DIR, 'lute.min.js.map'), map)
  await fs.writeFile(path.join(VENDOR_DIR, 'LICENSE'), license)

  const notice =
    `Lute — a structured markdown engine (${REPO})\n` +
    `Copyright (c) 2019-present, b3log.org\n` +
    `Licensed under Mulan PSL v2 (see LICENSE).\n` +
    `Vendored prebuilt: javascript/lute.min.js @ ${sha}\n`
  await fs.writeFile(path.join(VENDOR_DIR, 'NOTICE'), notice)

  const source = {
    repo: REPO,
    commit: sha,
    committedAt,
    fetchedFrom: raw(LUTE_PATH),
    goVersion,
    sha256: sha256(Buffer.from(js)),
    mapSha256: sha256(Buffer.from(map)),
    license: 'Mulan PSL v2',
    note: 'Run media-src/scripts/fetch-lute.mjs <sha> to re-pin; build.mjs verifies sha256.',
  }
  await fs.writeFile(
    path.join(VENDOR_DIR, 'source.json'),
    JSON.stringify(source, null, 2) + '\n',
  )

  console.log(`Vendored to ${path.relative(process.cwd(), VENDOR_DIR)}/`)
  console.log(`  commit:    ${sha}`)
  console.log(`  committed: ${committedAt || '(unknown)'}`)
  console.log(`  goVersion: ${goVersion}`)
  console.log(`  sha256:    ${source.sha256}`)
  console.log(`  files:     lute.min.js (${(js.length / 1e6).toFixed(2)} MB), .map, LICENSE, NOTICE, source.json`)
}

const arg = process.argv[2]
if (!arg) {
  console.error('usage: fetch-lute.mjs --list [N] | <commit-sha>')
  process.exit(2)
}
if (arg === '--list') {
  await listCandidates(parseInt(process.argv[3] || '15', 10))
} else {
  await vendor(arg)
}
