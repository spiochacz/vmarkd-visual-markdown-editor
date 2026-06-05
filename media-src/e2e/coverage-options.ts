/**
 * Shared monocart coverage options for the e2e (Playwright) suite.
 *
 * Used by the per-test fixture (worker process, `report.add`) and by the
 * global setup/teardown (main process, `cleanCache` / `generate`). They must
 * share `outputDir` so the on-disk cache written during tests is found when
 * the final report is generated.
 *
 * V8 coverage from Chromium is mapped back to the original TypeScript via the
 * inline source map esbuild embeds in the served harness bundle.
 */
const coverageOptions = {
  name: 'vMark webview — E2E coverage',
  // Resolved relative to the cwd Playwright runs in (media-src/).
  outputDir: './coverage/e2e',
  reports: [['v8'], ['html'], ['console-details']],

  // Keep only our harness bundles (drop separately-loaded vditor scripts like
  // lute.min.js / i18n that Chromium also reports).
  entryFilter: (entry: { url: string }) =>
    /\/(harness|behaviors|outline|link|list|math|save-flush|incremental-md|wysiwyg-input|tab|stream|keybugs|scrolljump|mermaid)\.js/.test(
      entry.url,
    ),

  // From the unpacked source map, keep only the webview source modules under
  // `src/`. Drops node_modules (vditor) and the e2e harness itself
  // (`e2e/harness.ts` has no `src/` segment). esbuild emits cwd-relative
  // source paths (`src/foo.ts`), so anchor on `(^|/)src/`.
  sourceFilter: (sourcePath: string) =>
    /(^|\/)src\//.test(sourcePath) && !sourcePath.includes('node_modules'),
}

export default coverageOptions
