function isPlainObject(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge(...objects: any[]): any {
  const result: Record<string, any> = {}
  for (const obj of objects) {
    if (!isPlainObject(obj)) continue
    for (const key of Object.keys(obj)) {
      const sourceVal = obj[key]
      if (sourceVal === undefined) continue
      const targetVal = result[key]
      if (isPlainObject(sourceVal)) {
        result[key] = isPlainObject(targetVal)
          ? deepMerge(targetVal, sourceVal)
          : deepMerge(sourceVal)
      } else {
        // primitives and arrays replace the previous value
        result[key] = sourceVal
      }
    }
  }
  return result
}
