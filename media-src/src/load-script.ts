// Append a <script src> once (idempotent by id) and resolve when it loads — or on
// error, so a failed asset never hangs the caller (the caller treats a missing
// global as "engine unavailable" and falls back). Hoisted from the byte-identical
// copies in d2-wasm.ts and elk-layout.ts (task 152 item 5).
export function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById(id)) return resolve()
    const s = document.createElement('script')
    s.id = id
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => resolve()
    document.head.appendChild(s)
  })
}
