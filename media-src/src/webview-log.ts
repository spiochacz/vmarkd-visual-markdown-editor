// Webview→host observability pipe (task 151 item 3). The host registers `log` →
// Output channel, `error` → showError, `info` → showInformationMessage
// (extension.ts), but the webview historically fell back to console.* — invisible
// unless the user opens the webview devtools. Route diagnostics through the host so
// they land in the vMarkd Output channel (memory: debug-metrics-to-Output-channel).
//
// These post via the typed `vscode` handle, so a protocol drift is a compile error.

/** Append a line to the vMarkd Output channel (host `log` handler). */
export function logToHost(text: string): void {
  try {
    vscode.postMessage({ command: 'log', text })
  } catch {
    // The acquireVsCodeApi handle isn't available (e.g. the e2e harness) — fall
    // back to the console so a missing host never throws inside a catch site.
    console.log(text)
  }
}

/** Log an error to the Output channel; optionally surface it to the user (host
 *  `error` handler → showError). Use at catch sites instead of console.error. */
export function reportError(
  error: unknown,
  context: string,
  userFacing = false,
): void {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  logToHost(`[${context}] ${detail}`)
  if (userFacing) {
    try {
      vscode.postMessage({ command: 'error', content: `${context}: ${detail}` })
    } catch {
      console.error(context, error)
    }
  }
}
