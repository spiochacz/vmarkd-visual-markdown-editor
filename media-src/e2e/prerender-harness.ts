/**
 * Harness for the instant-paint overlay e2e (task 50).
 *
 * Loads the REAL webview entry (main.ts) so the test drives the actual init flow
 * end to end: main.ts posts `ready` -> the spec's stubbed `acquireVsCodeApi`
 * (installed via page.addInitScript BEFORE this bundle runs) replies with an
 * `init` message -> initVditor builds the live Vditor -> after() clones the real
 * toolbar into the overlay and removes the overlay (the swap). The page HTML
 * (prerender.html) ships the host-style overlay so we can assert it is swapped
 * out — the anti-hang guarantee — and that the live editor takes over.
 */
import '../src/main'
