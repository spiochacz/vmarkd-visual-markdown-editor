// The webview debounces edits 250ms before posting them to the host (so we don't
// flood VS Code with an `edit` per keystroke). That debounce opens a correctness
// gap: a Ctrl/Cmd+S issued inside the window saves the host's *previous* content
// because the latest `edit` hasn't fired yet (task 58). This controller owns the
// debounce timer and exposes `flush()` so the save keybind can post the current
// value synchronously before VS Code's save runs.
//
// Kept free of any Vditor/VS Code reference (values come via `getValue`, delivery
// via `post`) so it can be unit-tested directly.
export interface PendingEditOptions {
  wait: number
  getValue: () => string
  post: (content: string) => void
}

export interface PendingEdit {
  // Arm (or re-arm) the debounce. Coalesces rapid calls into one post.
  schedule(): void
  // Post the current value immediately if (and only if) an edit is pending,
  // cancelling the armed timer so the edit is never posted twice.
  flush(): void
  // Whether a debounced edit is currently waiting to fire.
  readonly pending: boolean
}

export function createPendingEdit(opts: PendingEditOptions): PendingEdit {
  let timer: ReturnType<typeof setTimeout> | undefined

  const fire = () => {
    timer = undefined
    opts.post(opts.getValue())
  }

  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, opts.wait)
    },
    flush() {
      if (timer === undefined) return
      clearTimeout(timer)
      fire()
    },
    get pending() {
      return timer !== undefined
    },
  }
}
