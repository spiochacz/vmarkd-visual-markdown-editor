// The shape-check MECHANISM for both directions of the host<->webview bridge (task 148 item 3).
//
// Each side owns its own required-field TABLE — they describe different protocols and must stay
// separate — but the type vocabulary and the check itself were written out twice, once in
// `webview-message-shape.ts` (host reading webview messages) and once in `message-router.ts`
// (webview reading host messages), for the exact same reason. Two copies of a validator that exist
// for one reason drift silently: widening `FieldType` or fixing the matcher on one side would
// simply not apply to the other. Imported by the webview through the same `../../src/…` path it
// already uses for `protocol.ts` / `echarts-theme.ts` — this module is pure, no vscode import.
type FieldType = 'string' | 'number' | 'boolean' | 'array'

/** One required field: the property name and the type its handler assumes. */
export type RequiredField = [string, FieldType]

function matchesFieldType(value: unknown, type: FieldType): boolean {
  if (type === 'array') return Array.isArray(value)
  return typeof value === type
}

/**
 * The name of the first missing/mistyped required field, or null when the shape is sound — which
 * includes a `command` the table does not list: an unknown command is the dispatcher's "no handler"
 * branch's problem, not this function's.
 */
export function firstShapeViolation(
  table: Partial<Record<string, RequiredField[]>>,
  msg: Record<string, unknown>,
  command: string,
): string | null {
  const fields = table[command]
  if (!fields) return null
  for (const [name, type] of fields) {
    if (!matchesFieldType(msg[name], type)) return name
  }
  return null
}
