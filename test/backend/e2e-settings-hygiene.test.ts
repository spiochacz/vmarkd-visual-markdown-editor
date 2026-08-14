// Ratchet for task 524: real-VS-Code specs must not GROW the number of files that write settings at
// `ConfigurationTarget.Global` by hand instead of going through `settings-helpers.ts`.
//
// A hard ban is not possible today — 77 spec files predate the helper, and converting them in one
// commit would be a huge, untestable diff. A ratchet is: the count may only go DOWN. New specs use
// the helper, and every conversion tightens the bound automatically.
//
// Why it matters (measured, task 516 triage): the suite shares ONE VS Code profile, so an unrestored
// Global write decides the configuration of every later spec. Five failures in one session traced
// back to that, each initially misread as a race or a product bug. See settings-helpers.ts's header
// for the individual polluter→victim pairs.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const E2E_DIR = path.join(__dirname, '..', 'vscode-e2e')

// The measured count on 2026-08-15, the day the helper landed. LOWER THIS as specs are converted;
// never raise it. If this fails on a spec you just wrote, use `usePinnedSettings` instead of writing
// the setting inline — that is the fix, not a bumped number.
const MAX_FILES_WITH_RAW_GLOBAL_WRITES = 67

function specFiles(): string[] {
  return readdirSync(E2E_DIR).filter((f) => f.endsWith('.spec.ts'))
}

function writesGlobalSettingDirectly(source: string): boolean {
  // `.update(<key>, <value>, vscode.ConfigurationTarget.Global)` and the `, true)` shorthand VS Code
  // accepts for the same scope — both land in the shared profile.
  return (
    /ConfigurationTarget\.Global/.test(source) ||
    /\.update\([^)]*,\s*true\s*\)/.test(source)
  )
}

// The metric counts files that write Global settings and DON'T use the helper at all. Writing
// settings mid-test is legitimate — a theme-flip spec cannot pin its way out of flipping the theme —
// so banning the write would be wrong. What must not happen is writing without declaring the keys
// for restore, which is what `useSettingsRestore` is for. A file that does both is compliant.
function usesHelper(source: string): boolean {
  return (
    /from '\.\/settings-helpers'/.test(source) &&
    /usePinnedSettings|useSettingsRestore/.test(source)
  )
}

describe('real-VS-Code spec settings hygiene (task 524)', () => {
  it('does not grow the number of specs writing Global settings by hand', () => {
    const offenders = specFiles().filter((file) => {
      const source = readFileSync(path.join(E2E_DIR, file), 'utf8')
      return writesGlobalSettingDirectly(source) && !usesHelper(source)
    })
    expect(
      offenders.length,
      `Specs writing ConfigurationTarget.Global directly: ${offenders.length} (max ${MAX_FILES_WITH_RAW_GLOBAL_WRITES}).\n` +
        'Use usePinnedSettings() from settings-helpers.ts — it restores in an afterEach, so a RED run\n' +
        'cannot poison every spec that follows. Lower the constant when you convert files; never raise it.\n' +
        `Files: ${offenders.join(', ')}`,
    ).toBeLessThanOrEqual(MAX_FILES_WITH_RAW_GLOBAL_WRITES)
  })

  it('keeps the helper importable under its documented name', () => {
    // Cheap guard against the ratchet silently pointing at a helper someone renamed or deleted —
    // the message above would then be advice nobody can follow.
    const helper = readFileSync(
      path.join(E2E_DIR, 'settings-helpers.ts'),
      'utf8',
    )
    expect(helper).toContain('export function usePinnedSettings')
    expect(helper).toContain('afterEach')
  })
})
