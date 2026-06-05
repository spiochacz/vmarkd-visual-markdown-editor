export interface Debounced {
  (...args: any[]): void
  /** Cancel a pending invocation (no-op if none is scheduled). */
  cancel(): void
}

export function debounce(
  fn: (...args: any[]) => void,
  wait: number,
): Debounced {
  let timer: ReturnType<typeof setTimeout> | undefined
  const debounced = (...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, wait)
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  }
  return debounced
}
