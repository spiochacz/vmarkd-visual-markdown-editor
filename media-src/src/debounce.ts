export function debounce(fn: (...args: any[]) => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: any[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, wait)
  }
}
