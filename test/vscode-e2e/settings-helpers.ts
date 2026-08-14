// Pin-and-restore for VS Code settings in the real-VS-Code suite (task 524).
//
// WHY THIS EXISTS. The suite runs in ONE worker-scoped VS Code profile whose user-data dir persists
// across boots, and `ConfigurationTarget.Global` writes go straight into it. A spec that writes a
// setting and does not put it back silently decides the configuration of every spec that runs after
// it — and the resulting failures surface far from their cause and look like races. Five separate
// failures in task 516's triage were exactly this, and every one of them was first misread as a
// timing bug or a product bug:
//
//   caret-empty-typing  → d2-render-sweep      (theme.code pinned ⇒ later content-theme flips are
//                                               permanent no-ops for token colour)
//   echarts-theme       → flip-skip            (an explicit theme.content ⇒ a workbench flip changes
//                                               nothing, so the spec's own CONTROL fails)
//   plantuml-theme-flip → preview-spacing      (colorTheme left on a VS Code default ⇒ 'auto'
//                                               resolves to a real theme ⇒ the edit surface inherits
//                                               markdown-body's line-height)
//   (defaultMode: 'remember') → outline-explorer (opened into a Preview overlay left by an earlier
//                                               spec, so the editor element stayed hidden for 60 s)
//
// TWO RULES, both learned the expensive way:
//   1. Restore in an `afterEach`, never a `finally` inside the test body. A RED run must not leave
//      the profile poisoned for everything after it — otherwise one failure cascades into a dozen.
//   2. Restore by writing `undefined`, which removes the key so the package.json default applies
//      again. Writing back "what it was before" re-pins a value the next spec then inherits.
//
// A spec should ALSO pin what it depends on, not just clean up after itself: cleaning up only helps
// the specs after you, while pinning is what makes YOUR assertions independent of what ran before.

type Evaluate = (fn: unknown, args: [string]) => Promise<unknown>

/** `{ 'vmarkd.theme.content': 'auto', 'workbench.colorTheme': 'Monokai' }` — fully-qualified keys. */
export type SettingValues = Record<string, unknown>

function splitKey(key: string): { section: string; leaf: string } {
  const dot = key.indexOf('.')
  if (dot < 0) throw new Error(`settings key needs a section prefix: ${key}`)
  return { section: key.slice(0, dot), leaf: key.slice(dot + 1) }
}

/** Write settings at Global scope. Prefer `usePinnedSettings`, which also restores them. */
export async function applySettings(
  evaluateInVSCode: Evaluate,
  values: SettingValues,
): Promise<void> {
  const pairs = Object.entries(values).map(([key, value]) => {
    const { section, leaf } = splitKey(key)
    return { section, leaf, value }
  })
  await evaluateInVSCode(
    async (
      vscode: typeof import('vscode'),
      args: [{ section: string; leaf: string; value: unknown }[]],
    ) => {
      for (const { section, leaf, value } of args[0]) {
        await vscode.workspace
          .getConfiguration(section)
          .update(leaf, value, vscode.ConfigurationTarget.Global)
      }
    },
    [pairs] as unknown as [string],
  )
}

/** Remove the keys again (back to the package.json defaults) — see rule 2 in this file's header. */
export async function clearSettings(
  evaluateInVSCode: Evaluate,
  keys: string[],
): Promise<void> {
  const pairs = keys.map(splitKey)
  await evaluateInVSCode(
    async (
      vscode: typeof import('vscode'),
      args: [{ section: string; leaf: string }[]],
    ) => {
      for (const { section, leaf } of args[0]) {
        await vscode.workspace
          .getConfiguration(section)
          .update(leaf, undefined, vscode.ConfigurationTarget.Global)
      }
    },
    [pairs] as unknown as [string],
  )
}

/**
 * Call at the TOP LEVEL of a spec file. Applies `values` before each test and removes them after —
 * including after a failing one, which is the whole point (rule 1 above).
 *
 * ```ts
 * usePinnedSettings(test, {
 *   'vmarkd.theme.content': 'auto',
 *   'workbench.colorTheme': 'Monokai', // keeps 'auto' UNPAIRED, see resolveAutoContentTheme
 * })
 * ```
 *
 * Takes `test` as a parameter rather than importing it: the suite's specs import `test` from
 * `vscode-test-playwright`, and a second import of Playwright's own `test` in this file would be a
 * different runner instance.
 */
export function usePinnedSettings(
  // biome-ignore lint/suspicious/noExplicitAny: the harness's TestType, whose fixtures vary per spec
  test: any,
  values: SettingValues,
): void {
  const keys = Object.keys(values)
  test.beforeEach(
    async ({ evaluateInVSCode }: { evaluateInVSCode: Evaluate }) => {
      await applySettings(evaluateInVSCode, values)
    },
  )
  useSettingsRestore(test, keys)
}

/**
 * For specs that must write settings DURING the test — a theme-flip spec cannot pin its way out of
 * flipping the theme, which is the behaviour under test. Declare the keys it touches and they are
 * removed after each test, pass or fail.
 *
 * These specs are the suite's worst polluters precisely because their writes are load-bearing:
 * `plantuml-theme-flip` leaves `workbench.colorTheme` on a VS Code default, and `echarts-theme`
 * rewrites `theme.content` four times. Neither can stop writing; both can stop LEAKING.
 *
 * ```ts
 * useSettingsRestore(test, ['workbench.colorTheme', 'vmarkd.theme.content'])
 * ```
 */
export function useSettingsRestore(
  // biome-ignore lint/suspicious/noExplicitAny: the harness's TestType, whose fixtures vary per spec
  test: any,
  keys: string[],
): void {
  test.afterEach(
    async ({ evaluateInVSCode }: { evaluateInVSCode: Evaluate }) => {
      await clearSettings(evaluateInVSCode, keys)
    },
  )
}
