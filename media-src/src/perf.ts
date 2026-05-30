// Webview-side singleton for the rendering profiling harness (tasks/42).
// Wires the pure PerfAggregator to performance.now() and postMessage, owns the
// flush timer, and exposes window.__perfFlush()/__perfReset() for manual dumps.
//
// Inert when disabled: every method short-circuits on `enabled`, so the shipped
// path cost with profiling off is ~one branch per instrumentation point.

import { PerfAggregator } from './perf-aggregator'

const FLUSH_INTERVAL_MS = 2000

class Profiler {
  enabled = false
  private agg = new PerfAggregator()
  private timer: ReturnType<typeof setInterval> | null = null

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) {
      this.startTimer()
    } else {
      this.stopTimer()
    }
  }

  /** Begin a span; returns a token to pass to end(). Cheap no-op when disabled. */
  start(): number {
    return this.enabled ? performance.now() : 0
  }

  end(op: string, token: number, docSize?: number): void {
    if (!this.enabled) {
      return
    }
    this.agg.recordSpan(op, performance.now() - token, docSize)
  }

  /** Record an already-measured duration (vs end(), which derives it). */
  record(op: string, ms: number, docSize?: number): void {
    if (!this.enabled) {
      return
    }
    this.agg.recordSpan(op, ms, docSize)
  }

  recordRenderText(sample: {
    selfMs: number
    hadBrackets: boolean
    matched: boolean
  }): void {
    if (!this.enabled) {
      return
    }
    this.agg.recordRenderText(sample)
  }

  flush(): void {
    if (!this.enabled || !this.agg.hasData()) {
      return
    }
    try {
      window.vscode?.postMessage({
        command: 'perf',
        payload: this.agg.snapshot(),
      })
    } catch {
      // a flush failure must never break rendering
    }
    this.agg.reset()
  }

  /** Drop accumulated samples without flushing them. */
  reset(): void {
    this.agg.reset()
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

export const profiler = new Profiler()

// Manual controls for the devtools console.
;(window as any).__perfFlush = () => profiler.flush()
;(window as any).__perfReset = () => profiler.reset()
