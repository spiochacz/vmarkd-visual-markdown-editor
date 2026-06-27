// Per-instance observer registry (task 152 item 2). runFinishInit re-wires ~12
// MutationObservers on every (re-)init; each used to be a hand-written
// `disposeX?.(); disposeX = observeX(...)` module-global pair. This registry
// collapses them to `observers.set('x', observeX(...))` — setting a key disposes
// whatever was registered under it first, and disposeAll() tears everything down.
export class Disposables {
  private map = new Map<string, () => void>()

  /** Dispose any observer previously registered under `key`, then store the new
   *  disposer. A null/undefined disposer just disposes + clears the slot. */
  set(key: string, disposer: (() => void) | null | undefined): void {
    this.map.get(key)?.()
    if (disposer) this.map.set(key, disposer)
    else this.map.delete(key)
  }

  /** Dispose every registered observer (full teardown / re-init). */
  disposeAll(): void {
    for (const dispose of this.map.values()) dispose()
    this.map.clear()
  }
}
