// Task 532 — (re)writes the PINS (`delta` / `values`) of test/parity/allowed-differences.json from a
// measured report: run the gate against an EMPTY allow-list with a JSON report, then pin.
//
//   VMARKD_PARITY_ALLOW=none VMARKD_PARITY_REPORT=tmp/532/red.json xvfb-run -a npm --prefix media-src run test:e2e -- parity.spec.ts
//   (same with test/vscode-e2e for the real-VS-Code layer)
//   node scripts/pin-parity-allowlist.mjs tmp/532/red.json tmp/532/red-vs.json
//
// Entries keep their hand-written reason/task; only the pins are replaced. Exits 1 if an entry has no
// measured difference in the report (stale) — fix the list instead of pinning nothing.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/parity/allowed-differences.json',
)
// One report per layer: the chromium harness and the real VS Code measure slightly different
// absolute values (injected CSS, real fonts, window size) and the allow-list serves both, so the pins
// are the UNION of every report given.
const reports = process.argv
  .slice(2)
  .map((f) => JSON.parse(readFileSync(path.resolve(f), 'utf8')))
const unexplained = reports.flatMap((r) => r.unexplained)
const entries = JSON.parse(readFileSync(file, 'utf8'))
const valueKey = (d) =>
  `${JSON.stringify(d.expected)} -> ${JSON.stringify(d.actual)}`

let stale = 0
const out = entries.map((e) => {
  const themes = [e.theme].flat()
  const hits = unexplained.filter(
    (d) =>
      (themes.includes('*') || themes.includes(d.theme)) &&
      d.stagePair === e.stagePair &&
      d.kind === e.kind &&
      d.property === e.property,
  )
  if (!hits.length) {
    stale++
    console.error(`no measured difference: ${e.stagePair} ${e.kind} ${e.property}`)
    return e
  }
  const deltas = hits.map((d) => d.delta).filter((n) => n !== null)
  const values = [...new Set(hits.filter((d) => d.delta === null).map(valueKey))]
  const { delta: _d, values: _v, maxDelta: _m, ...rest } = e
  return {
    ...rest,
    ...(deltas.length ? { delta: [Math.min(...deltas), Math.max(...deltas)] } : {}),
    ...(values.length ? { values: values.sort() } : {}),
  }
})
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
console.log(`pinned ${out.length - stale} of ${out.length} entries`)
process.exit(stale ? 1 : 0)
