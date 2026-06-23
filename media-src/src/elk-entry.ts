// Separate, lazily-loaded bundle entry for the optional ELK (Eclipse Layout Kernel) D2 layout
// engine — selected via the `vmarkd.diagram.d2Layout` setting. esbuild bundles this (with the
// vendored elk-api.js + elk-worker.min.js) into media/vditor/dist/js/elk/elk-main.js
// (media-src/build.mjs). elk-layout.ts loads that file on demand and reads `window.__vmarkdElk`.
//
// WHY a custom entry instead of the stock elk.bundled.js: the bundled build's default
// `workerFactory` spawns a *real* blob Web Worker, which `elk.layout()` rejects under the VS Code
// webview. elkjs ships a "fake worker" (elk-worker.min.js → `{ Worker }`) that runs the GWT layout
// engine ON THE MAIN THREAD while presenting the same postMessage/onmessage contract — exactly the
// node entry's (lib/main.js) fallback path, minus its node-only `web-worker` probe. No Worker, no
// blob, no `worker-src` CSP dependency. D2 graphs are small, so main-thread layout is sub-frame.

// elk-api.js is a UMD/CJS bundle whose `module.exports` is the ELK class (with `.default` self-ref).
import ELKMod from '../vendor/elk/elk-api.js'
// elk-worker.min.js does `module.exports = { default: <FakeWorker>, Worker: <FakeWorker> }` when a
// CommonJS module context exists (esbuild provides one); the in-worker branch is skipped because
// `document` is defined on the main thread.
import workerMod from '../vendor/elk/elk-worker.min.js'

const ELK = (ELKMod as { default?: unknown }).default ?? ELKMod
const FakeWorker =
  (workerMod as { Worker?: unknown; default?: unknown }).Worker ??
  (workerMod as { default?: unknown }).default ??
  workerMod

try {
  const elk = new (ELK as new (opts: unknown) => unknown)({
    // Main-thread fake worker — the `url` arg is ignored by the in-process Worker.
    workerFactory: (url: string) =>
      new (FakeWorker as new (u: string) => unknown)(url),
  })
  ;(window as unknown as { __vmarkdElk?: unknown }).__vmarkdElk = elk
} catch {
  // Leave __vmarkdElk undefined — elk-layout.ts treats that as "ELK unavailable" and the D2
  // renderer falls back to the dagre engine. Never let ELK boot break the webview.
}
