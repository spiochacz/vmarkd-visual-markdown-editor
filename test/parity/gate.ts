// Task 532 §D — the verdict step both layers end with: load the allow-list, judge every captured
// configuration, print the whole listing (never just the first failure), optionally write it as JSON.
//
//   VMARKD_PARITY_ALLOW=none        judge against an EMPTY allow-list (the RED proof / baseline run)
//   VMARKD_PARITY_REPORT=<file>     write {diffs, unexplained, stale, problems} as JSON

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  type AllowedDifference,
  evaluateRuns,
  formatVerdict,
  type ParityRun,
  type ParityVerdict,
  registryProblems,
  validateAllowList,
} from './compare'

const ALLOW_LIST_PATH = path.join(__dirname, 'allowed-differences.json')

function loadAllowList(): AllowedDifference[] {
  if (process.env.VMARKD_PARITY_ALLOW === 'none') return []
  const raw: unknown = JSON.parse(readFileSync(ALLOW_LIST_PATH, 'utf8'))
  const errors = validateAllowList(raw)
  if (errors.length)
    throw new Error(
      `allowed-differences.json is invalid:\n${errors.join('\n')}`,
    )
  return raw as AllowedDifference[]
}

export interface GateResult {
  verdict: ParityVerdict
  problems: string[]
  report: string
  ok: boolean
}

export function judgeRuns(runs: ParityRun[], layer: string): GateResult {
  const verdict = evaluateRuns(runs, loadAllowList())
  const problems = runs.flatMap((r) =>
    r.stages.ir
      ? registryProblems(r.stages.ir).map((p) => `[${r.theme}] ${p}`)
      : [`[${r.theme}] no IR stage captured`],
  )
  const report = [
    ...problems.map((p) => `REGISTRY: ${p}`),
    formatVerdict(verdict),
  ].join('\n')
  const out = process.env.VMARKD_PARITY_REPORT
  if (out) {
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(
      out,
      `${JSON.stringify({ layer, configs: runs.map((r) => r.theme), problems, ...verdict }, null, 2)}\n`,
    )
  }
  return {
    verdict,
    problems,
    report,
    ok:
      problems.length === 0 &&
      verdict.unexplained.length === 0 &&
      verdict.stale.length === 0,
  }
}
