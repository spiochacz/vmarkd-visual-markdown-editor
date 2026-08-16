// Quality-metrics suite (task 469 item 6). Runs every quality tool and reports ALL of them —
// unlike a plain `&&` chain, one red stage does not hide the rest. Run at the end of a task's
// implementation, alongside the existing "simplify pass at the end of every task" convention (see
// AGENTS.md "Quality-metrics toolchain").
//
// Exit code is non-zero iff any stage failed — same "gate" semantics a `&&` chain would give you,
// without the "stops at the first thing that's red" blind spot: a stage failing for reasons
// unrelated to the task at hand (e.g. a newly-deferred complexity site) would otherwise hide every
// stage after it in a plain `&&` chain.
//
// This whole script is NOT wired into CI as one step (task 469 item 6, reaffirmed by ADR-0005's
// Philosophy) — jscpd/dependency-cruiser stay local-only tools; knip/lint/coverage each already
// have their own dedicated CI step instead (see .github/workflows/ci.yml). Stages present as of
// 2026-08-07 (task 498-503's cleanup pass, task 482's audit fix) were clean on `main` as of that
// date; the two typecheck stages added below are clean on `test/516-qa-journeys` as of 2026-08-16.
import { spawnSync } from 'node:child_process'

const STAGES = [
  // Neither typecheck script was in this suite, and typecheck:vscode-e2e isn't in CI either
  // (ci.yml runs typecheck and typecheck:strict, not this one) — so a green `npm run quality`
  // was never actual evidence the tree typechecks. Task 516 (2026-08-16) found two defects sitting
  // behind exactly that gap on the same day: media-src/src/chrome/diff-markers.ts had an
  // `'innerText' in child` narrowing whose else branch the DOM lib types make `never`, so tsc
  // rejected the `textContent` fallback that makes the function work under jsdom — red on this
  // branch, clean on `main`, unnoticed because nothing in the routine end-of-task commands ran it.
  ['typecheck', 'npm', ['run', 'typecheck']],
  // Same gap, the harness's own spec tree: 12 errors, 9 of which predated this branch, i.e. it had
  // been red long enough to fall out of anyone's workflow. Clean here as of 2026-08-16 on
  // test/516-qa-journeys, but was red on `main` (9 errors) before that branch lands — a checkout
  // that reports FAIL on just this stage is the gate working, not a regression in this script.
  ['typecheck:vscode-e2e', 'npm', ['run', 'typecheck:vscode-e2e']],
  ['lint:ci', 'npm', ['run', 'lint:ci']],
  ['knip', 'npm', ['run', 'knip']],
  ['jscpd', 'npm', ['run', 'jscpd']],
  ['depcruise', 'npm', ['run', 'depcruise']],
  // root + media-src, --audit-level=low (task 482 Phase 5). test/vscode-e2e is NOT included: its
  // one finding (playwright, GHSA-7mvr-c777-76hp) needs `audit fix --force` — a version bump
  // outside the declared range — which is a real upgrade decision, not something this ratchet
  // should silently force. Tracked in tasks/481-dependency-audit-triage.md, not fixed here.
  ['audit', 'npm', ['run', 'audit']],
  ['test:coverage', 'npm', ['run', 'test:coverage']],
  // Separate from test:coverage itself (ci.yml runs them as two steps): this ratchet reads the
  // coverage-summary.json the run above just wrote, so it must come after, not instead of, it.
  ['check:coverage-modules', 'npm', ['run', 'check:coverage-modules']],
]

const results = []
for (const [name, cmd, args] of STAGES) {
  console.log(`\n─── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}\n`)
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  results.push({ name, code: res.status ?? 1 })
}

console.log('\n─── quality summary ───────────────────────────────────────\n')
let failed = false
for (const { name, code } of results) {
  const ok = code === 0
  failed ||= !ok
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
process.exit(failed ? 1 : 0)
