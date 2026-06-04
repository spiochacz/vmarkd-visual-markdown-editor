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
  // Post the CURRENT value now and cancel any armed timer (so it's not posted
  // twice). Always posts — even when nothing is "pending": the editor's live
  // value (getValue) is always current, but the upstream `schedule()` may not
  // have run yet (Vditor only calls its input hook after its own ~800ms throttle),
  // so on Ctrl/Cmd+S we must persist the live value unconditionally, not rely on a
  // pending debounce. The host dedupes a no-op write, so a redundant post is safe.
  flush(): void
  // Whether a debounced edit is currently waiting to fire.
  readonly pending: boolean
}

export function createPendingEdit(opts: PendingEditOptions): PendingEdit {
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    schedule() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        opts.post(opts.getValue())
      }, opts.wait)
    },
    flush() {
      if (timer) clearTimeout(timer)
      timer = undefined
      opts.post(opts.getValue())
    },
    get pending() {
      return timer !== undefined
    },
  }
}
