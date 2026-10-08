// Task 532 §D — compares the stage snapshots of ONE configuration under the policy, then applies the
// checked-in allow-list of INTENDED differences. Shared by both layers so the harness and the real
// VS Code produce the same report from the same rules.

import { PARITY_ELEMENTS, type ParityStage } from './elements'
import type { FlatCell, FlatSnapshot } from './snapshot'
import {
  isRectProp,
  NUMERIC_EPSILON,
  PAIR_POLICY,
  STAGE_PAIRS,
  type StagePair,
} from './policy'

export interface ParityDiff {
  theme: string
  stagePair: StagePair
  kind: string
  property: string
  expected: string | number
  actual: string | number
  /** actual − expected for numbers, null for strings. */
  delta: number | null
}

export interface AllowedDifference {
  /** A configuration id, a list of ids, or `*` = every configuration of the run. */
  theme: string | string[]
  stagePair: StagePair
  kind: string
  /** An exact property name. No wildcards — an entry suppresses ONE cell. */
  property: string
  reason: string
  /**
   * The step that removes the difference (`532 step 3`), or `532 follow-up` for a drift the gate
   * found that no step of task 532 owns yet — those need a decision, not just a deletion.
   */
  task: string
  /**
   * PINS — an entry accepts the difference it was written for, not "any difference in this cell", so
   * a CHANGE of an allowed difference (list padding 40 -> 44px) is red too.
   * `delta`: [min, max] of the measured `actual - expected` over the entry's configurations, for
   * numeric cells (accepted within DELTA_SLACK of it). `values`: the exact `"expected -> actual"`
   * strings measured, for string cells. At least one is required.
   */
  delta?: [number, number]
  values?: string[]
}

export type RunSnapshots = Partial<Record<ParityStage, FlatSnapshot>>

export interface ParityRun {
  theme: string
  stages: RunSnapshots
}

/** Layout noise allowed around a pinned numeric delta: 1px, or 2% of a large one. */
const deltaSlack = (bound: number): number =>
  Math.max(1, Math.abs(bound) * 0.02)

/** The string an entry's `values` pin carries for one difference. */
const valueKey = (d: ParityDiff): string =>
  `${JSON.stringify(d.expected)} -> ${JSON.stringify(d.actual)}`

/** Does this entry accept exactly this difference (not just this cell)? */
function pinAccepts(e: AllowedDifference, d: ParityDiff): boolean {
  if (d.delta !== null && e.delta) {
    const [lo, hi] = e.delta
    if (d.delta >= lo - deltaSlack(lo) && d.delta <= hi + deltaSlack(hi))
      return true
  }
  return !!e.values?.includes(valueKey(d))
}

const PROPERTY_ORDER = (a: string, b: string): number => a.localeCompare(b)

function differs(
  property: string,
  a: string | number,
  b: string | number,
  tolerance: number | null,
): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = isRectProp(property) ? (tolerance ?? 0) : 0
    return Math.abs(a - b) > Math.max(tol, NUMERIC_EPSILON)
  }
  return a !== b
}

const diffOf = (
  run: ParityRun,
  stagePair: StagePair,
  kind: string,
  property: string,
  expected: string | number,
  actual: string | number,
): ParityDiff => ({
  theme: run.theme,
  stagePair,
  kind,
  property,
  expected,
  actual,
  delta:
    typeof expected === 'number' && typeof actual === 'number'
      ? Math.round((actual - expected) * 100) / 100
      : null,
})

/** The differing properties of one kind that exists in both stages of a pair. */
function diffProps(
  run: ParityRun,
  stagePair: StagePair,
  kind: string,
  a: FlatCell,
  b: FlatCell,
): ParityDiff[] {
  const policy = PAIR_POLICY[stagePair]
  const out: ParityDiff[] = []
  const props = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const property of [...props].sort(PROPERTY_ORDER)) {
    if (property === 'present') continue
    if (policy.rectTolerance === null && isRectProp(property)) continue
    if (policy.skipProps.some((re) => re.test(property))) continue
    const av = a[property]
    const bv = b[property]
    // A property only one side measured (e.g. firstGlyphX of a block with no painted text in just one
    // stage) is itself a difference.
    if (av === undefined || bv === undefined)
      out.push(
        diffOf(run, stagePair, kind, property, av ?? '(none)', bv ?? '(none)'),
      )
    else if (differs(property, av, bv, policy.rectTolerance))
      out.push(diffOf(run, stagePair, kind, property, av, bv))
  }
  return out
}

function diffPair(run: ParityRun, stagePair: StagePair): ParityDiff[] {
  const policy = PAIR_POLICY[stagePair]
  const ref = run.stages[policy.reference]
  const cand = run.stages[policy.candidate]
  if (!ref || !cand) return []
  const out: ParityDiff[] = []
  for (const kind of ['root', ...PARITY_ELEMENTS.map((e) => e.kind)]) {
    const a = ref[kind]
    const b = cand[kind]
    if (!a && !b) continue
    if (!a || !b || a.present !== b.present) {
      out.push(
        diffOf(
          run,
          stagePair,
          kind,
          'present',
          a?.present ?? 'no',
          b?.present ?? 'no',
        ),
      )
    } else if (a.present === 'yes') {
      out.push(...diffProps(run, stagePair, kind, a, b))
    }
  }
  return out
}

/** Every difference between the stage pairs of one configuration (unfiltered by the allow-list). */
export function diffRun(run: ParityRun): ParityDiff[] {
  return STAGE_PAIRS.flatMap((pair) => diffPair(run, pair))
}

const appliesTo = (e: AllowedDifference, theme: string): boolean =>
  e.theme === '*' ||
  (Array.isArray(e.theme) ? e.theme.includes(theme) : e.theme === theme)

const sameCell = (e: AllowedDifference, d: ParityDiff): boolean =>
  appliesTo(e, d.theme) &&
  e.stagePair === d.stagePair &&
  e.kind === d.kind &&
  e.property === d.property

export interface ParityVerdict {
  diffs: ParityDiff[]
  /** Differences no entry explains (or whose value moved off its entry's pin). */
  unexplained: ParityDiff[]
  suppressed: number
  /** Entries that apply to this run's configurations but suppress nothing — delete them. */
  stale: AllowedDifference[]
}

export function evaluateRuns(
  runs: ParityRun[],
  allow: readonly AllowedDifference[],
): ParityVerdict {
  const diffs = runs.flatMap(diffRun)
  const used = new Set<AllowedDifference>()
  const unexplained: ParityDiff[] = []
  let suppressed = 0
  for (const d of diffs) {
    const matches = allow.filter((e) => sameCell(e, d))
    if (!matches.length) {
      unexplained.push(d)
      continue
    }
    for (const m of matches) used.add(m)
    if (matches.some((m) => pinAccepts(m, d))) suppressed++
    else unexplained.push(d)
  }
  const themes = new Set(runs.map((r) => r.theme))
  const stale = allow.filter(
    (e) => [...themes].some((t) => appliesTo(e, t)) && !used.has(e),
  )
  return { diffs, unexplained, suppressed, stale }
}

/** One line per cell: `(theme, stagePair, kind, property, expected, actual)`. */
function formatDiff(d: ParityDiff): string {
  const delta =
    d.delta === null ? '' : `  (Δ ${d.delta > 0 ? '+' : ''}${d.delta})`
  return `[${d.theme}] ${d.stagePair} ${d.kind} ${d.property}: expected ${JSON.stringify(d.expected)} actual ${JSON.stringify(d.actual)}${delta}`
}

export function formatVerdict(v: ParityVerdict): string {
  const lines: string[] = []
  if (v.unexplained.length) {
    lines.push(`${v.unexplained.length} UNEXPLAINED difference(s):`)
    for (const d of v.unexplained) lines.push(`  ${formatDiff(d)}`)
  }
  if (v.stale.length) {
    lines.push(
      `${v.stale.length} STALE allow-list entr${v.stale.length === 1 ? 'y' : 'ies'} (suppress nothing — delete them):`,
    )
    for (const e of v.stale)
      lines.push(
        `  [${[e.theme].flat().join(',')}] ${e.stagePair} ${e.kind} ${e.property} (${e.task})`,
      )
  }
  lines.push(
    `${v.diffs.length} difference(s) measured, ${v.suppressed} allowed, ${v.unexplained.length} unexplained, ${v.stale.length} stale.`,
  )
  return lines.join('\n')
}

/**
 * Registry sanity, checked against the live IR stage: every kind must exist there and carry the
 * markers the registry promises. Returns problems (empty = fine). A registry that drifts from what
 * the product draws would otherwise make the whole gate vacuous for that kind.
 */
export function registryProblems(ir: FlatSnapshot): string[] {
  const problems: string[] = []
  for (const e of PARITY_ELEMENTS) {
    const cell = ir[e.kind]
    if (cell?.present !== 'yes') {
      problems.push(`kind "${e.kind}" has no element in the live IR stage`)
      continue
    }
    for (const m of e.expectMarkers) {
      const n = cell[`marker.${m}`]
      if (typeof n !== 'number' || n < 1)
        problems.push(
          `kind "${e.kind}" expects marker "${m}" in IR but counted ${String(n)}`,
        )
    }
  }
  return problems
}

const ENTRY_STRINGS = ['stagePair', 'kind', 'property', 'reason', 'task']

/** Field-level errors of an entry's pins (`delta` / `values`). */
function pinErrors(r: Record<string, unknown>, where: string): string[] {
  const errors: string[] = []
  const d = r.delta
  const deltaOk =
    Array.isArray(d) &&
    d.length === 2 &&
    d.every((n) => typeof n === 'number') &&
    d[0] <= d[1]
  const valuesOk =
    Array.isArray(r.values) &&
    r.values.length > 0 &&
    r.values.every((v) => typeof v === 'string')
  if (d !== undefined && !deltaOk)
    errors.push(`${where}: delta must be [min, max] numbers`)
  if (r.values !== undefined && !valuesOk)
    errors.push(`${where}: values must be a non-empty string list`)
  if (d === undefined && r.values === undefined)
    errors.push(`${where}: an entry must pin its value (delta and/or values)`)
  return errors
}

/** Field-level errors of one allow-list entry. */
function entryErrors(
  r: Record<string, unknown>,
  where: string,
  kinds: ReadonlySet<string>,
): string[] {
  const errors: string[] = []
  for (const k of ENTRY_STRINGS)
    if (typeof r[k] !== 'string' || !(r[k] as string).trim())
      errors.push(`${where}: "${k}" must be a non-empty string`)
  const themes = [r.theme].flat()
  if (!themes.length || themes.some((t) => typeof t !== 'string' || !t))
    errors.push(`${where}: "theme" must be a config id, a list of ids or "*"`)
  if (!STAGE_PAIRS.includes(r.stagePair as StagePair))
    errors.push(`${where}: unknown stagePair ${String(r.stagePair)}`)
  if (!kinds.has(r.kind as string))
    errors.push(`${where}: unknown kind ${String(r.kind)}`)
  if (typeof r.property === 'string' && /[*?]/.test(r.property))
    errors.push(`${where}: property must be exact (no wildcard)`)
  // "accepted (user, YYYY-MM-DD)" = an intended difference the user chose to keep.
  if (
    typeof r.task === 'string' &&
    !/^(532 (step \d+|follow-up)|accepted \(user, \d{4}-\d{2}-\d{2}\))$/.test(
      r.task,
    )
  )
    errors.push(
      `${where}: task must be "532 step N", "532 follow-up" or "accepted (user, YYYY-MM-DD)", got "${r.task}"`,
    )
  errors.push(...pinErrors(r, where))
  return errors
}

/** Schema check for allowed-differences.json; returns human-readable errors. */
export function validateAllowList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['allowed-differences.json must be an array']
  const errors: string[] = []
  const kinds = new Set(['root', ...PARITY_ELEMENTS.map((e) => e.kind)])
  const seen = new Set<string>()
  raw.forEach((e, i) => {
    const where = `entry ${i}`
    if (typeof e !== 'object' || e === null) {
      errors.push(`${where}: not an object`)
      return
    }
    const r = e as Record<string, unknown>
    errors.push(...entryErrors(r, where, kinds))
    for (const t of [r.theme].flat()) {
      const key = [t, r.stagePair, r.kind, r.property].join('|')
      if (seen.has(key)) errors.push(`${where}: duplicate entry ${key}`)
      seen.add(key)
    }
  })
  return errors
}
