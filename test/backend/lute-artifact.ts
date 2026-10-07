import { existsSync } from 'node:fs'
import * as vm from 'node:vm'
import { didLuteFailToLoad, isLuteWarm } from '../../src/lute/lute-host'

// Shared by every backend test that boots the real Lute build artifact (task 476).
//
// `media/vditor/dist/js/lute/lute.min.js` is BUILD OUTPUT (`node build.mjs`), gitignored —
// confirmed via `git check-ignore`. The committed pin lives at
// `media-src/vendor/lute/lute.min.js` (see lute-pin.test.ts / wiki-renderer-walk.test.ts), but
// the backend host code reads the built copy at runtime, so these tests must too.
//
// A fresh clone before the first build genuinely lacks this file — that's a legitimate reason
// to skip, but it must be UNMISSABLE (a loud, named warning + tests reported as "skipped", not
// silently absent from the count). Anything else — the file exists but the boot throws, hangs,
// or times out — is a real failure and must fail loud, never degrade into a quiet skip.
export function luteArtifactPath(root: string): string {
  return `${root}/media/vditor/dist/js/lute/lute.min.js`
}

export function isLuteArtifactBuilt(root: string): boolean {
  return existsSync(luteArtifactPath(root))
}

export function warnLuteArtifactMissing(
  suiteLabel: string,
  root: string,
): void {
  // `process.stderr.write`, NOT `console.warn` — Vitest 4's default reporter captures console
  // output and drops it for a test FILE THAT ENDS UP PASSING (verified empirically: a
  // `console.warn` in a suite whose tests all pass-or-skip never reaches the terminal without
  // `--reporter=verbose`, i.e. never in a plain `npm test` run). Writing straight to the stream
  // bypasses that interception, so the warning survives the default run too — the whole point of
  // task 476's "unmissable" requirement.
  process.stderr.write(
    `\n⚠️  SKIPPING "${suiteLabel}" — ${luteArtifactPath(root)} not found.\n` +
      '   Expected on a fresh clone before the first build: run `node build.mjs`, then re-run\n' +
      '   the tests. (task 476 — a missing build artifact must skip loudly, not fail with a\n' +
      '   raw ENOENT deep in a hook, or a false assertion failure downstream.)\n',
  )
}

// `prewarmLute` defers the ~250 ms synchronous load via `setTimeout(0)`; three suites
// (lute-host, webview-overlay, vditor-fidelity-bugs) used to await a FIXED 1000ms sleep after
// calling it — a race that lost under machine load (task 476 measured `AssertionError: expected
// undefined to be defined` at load average 24, because the load hadn't finished when the fixed
// wait ended). Poll the real readiness signal instead, with a ceiling generous enough for a busy
// box, and turn a genuine boot failure into a loud thrown error instead of a silent `undefined`
// that downstream assertions misreport as a logic bug.
export async function waitForLuteWarm(timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (!isLuteWarm()) {
    if (didLuteFailToLoad()) {
      throw new Error(
        'Lute failed to load even though the build artifact exists — a real boot failure ' +
          '(task 476), not the fresh-clone skip.',
      )
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Lute did not warm up within ${timeoutMs}ms even though the build artifact exists — ` +
          'a real hang/regression (task 476), not the fresh-clone skip.',
      )
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * Run a Lute blob (a source string) in a fresh vm sandbox and return its `Lute` namespace — the same
 * isolation the host uses, so two blobs (stock vs patched) never share a global.
 */
export function bootLute(src: string): { New(): any } {
  const sandbox: Record<string, unknown> = {
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'lute.min.js' })
  return (sandbox as { Lute: { New(): any } }).Lute
}
