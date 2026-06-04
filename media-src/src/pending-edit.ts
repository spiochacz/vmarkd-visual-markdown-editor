// Debounced host-sync trigger for editor edits (tasks 58 + 68).
//
// The webview owns when the document is serialised to markdown and posted to the
// host (Vditor no longer does it per input — see the fixIrInputSerialize patch).
// This just debounces:
//  - `schedule()` → run `onIdle` after `wait` ms of quiet. `onIdle` may be async
//    (it shows a busy cursor + yields a paint before the slow serialize on large
//    docs).
//  - `flush()` → run `onFlush` immediately and cancel any pending timer. `onFlush`
//    is synchronous and must post the live content BEFORE VS Code saves (task 58:
//    a Ctrl/Cmd+S inside the debounce window must not persist stale content).
//
// Free of any Vditor/VS Code reference so it can be unit-tested directly.
export interface PendingEditOptions {
  wait: number
  onIdle: () => void | Promise<void>
  onFlush: () => void
}

export interface PendingEdit {
  schedule(): void
  flush(): void
  readonly pending: boolean
}

export function createPendingEdit(opts: PendingEditOptions): PendingEdit {
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        opts.onIdle()
      }, opts.wait)
    },
    flush() {
      if (timer) clearTimeout(timer)
      timer = undefined
      opts.onFlush()
    },
    get pending() {
      return timer !== undefined
    },
  }
}
