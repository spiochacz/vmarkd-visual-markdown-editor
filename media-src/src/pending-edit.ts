// The webview debounces edits before posting them to the host. Two correctness +
// performance points (tasks 58 + IR-edit perf):
//
//  - Vditor already serialises the document to markdown on every input and hands it
//    to `options.input(text)`. We pass that SAME `text` into `schedule(content)` so
//    the debounced post reuses it instead of calling `getValue()` again — on a large
//    document each serialise is multi-second, so avoiding the second one roughly
//    halves the per-edit cost.
//  - On Ctrl/Cmd+S we must persist the CURRENT content even if no input is pending
//    (Vditor only fires its input hook after its own ~800ms throttle), so `flush()`
//    serialises the live value via `getValue()` unconditionally.
//
// Kept free of any Vditor/VS Code reference (content comes in, delivery via `post`,
// the live value via `getValue`) so it can be unit-tested directly.
export interface PendingEditOptions {
  wait: number
  // Live serialise, used only by flush() (Ctrl/Cmd+S).
  getValue: () => string
  post: (content: string) => void
}

export interface PendingEdit {
  // Arm (or re-arm) the debounce to post `content` (already-serialised markdown
  // from Vditor's input hook). Coalesces rapid calls — the latest content wins.
  schedule(content: string): void
  // Post the live value now and cancel any armed timer (so it's not posted twice).
  // Always posts — even when nothing is pending (see note above).
  flush(): void
  // Whether a debounced edit is currently waiting to fire.
  readonly pending: boolean
}

export function createPendingEdit(opts: PendingEditOptions): PendingEdit {
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest: string | undefined

  return {
    schedule(content) {
      latest = content
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        const content = latest as string
        latest = undefined
        opts.post(content)
      }, opts.wait)
    },
    flush() {
      if (timer) clearTimeout(timer)
      timer = undefined
      latest = undefined
      opts.post(opts.getValue())
    },
    get pending() {
      return timer !== undefined
    },
  }
}
