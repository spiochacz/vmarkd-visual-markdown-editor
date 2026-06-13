// e2e harness for the Marp deck (task 107). Builds a panel element and exposes the render +
// inject path so the spec can assert slide count, CSS scoping, and re-render — in a REAL browser
// (the only place marp-core actually runs). Sets __vmarkdMarpSrc to the harness-served chunk.
import { loadMarp, injectDeck } from '../src/marp-preview'

;(window as any).__vmarkdMarpSrc = '/marp-chunk.js'

const panel = document.getElementById('panel') as HTMLElement

;(window as any).__renderDeck = async (source: string): Promise<number> => {
  const marp = await loadMarp()
  return injectDeck(panel, source, marp)
}

// True once the chunk global exists — lets the spec assert "non-Marp doc never loads marp.js".
;(window as any).__marpLoaded = () => !!(window as any).__vmarkdMarp

;(window as any).__ready = true
