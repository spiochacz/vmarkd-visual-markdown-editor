// Harness for tasks 89 (bump) + 90 (theming). Real Vditor (IR) with an `echarts` block; the
// chart loads our vendored 6.1.0 from /vditor/dist/js/echarts. We install the ECharts theme
// resolver BEFORE constructing Vditor (as main.ts does), so the FIRST render is already paired
// to the content theme. The spec asserts: the bumped version renders, the chart adopts the
// paired palette background, and a live theme flip re-themes it (reRenderEcharts).
import '../src/preload'
import Vditor from 'vditor/src/index'
import { resolveEchartsTheme } from '../../src/echarts-theme'
import { applyEchartsTheme, readVscodePalette } from '../src/echarts-apply'
import { reRenderEcharts } from '../src/echarts-retheme'
import { setVditorTheme } from '../src/vditor-theme'

// Simulate VS Code's injected editor + chart colours so the `auto` (no content pairing) path can
// be exercised — readVscodePalette reads these off the document root.
const setVar = (k: string, val: string) =>
  document.documentElement.style.setProperty(k, val)
setVar('--vscode-editor-background', '#1e1e1e')
setVar('--vscode-editor-foreground', '#d4d4d4')
setVar('--vscode-textLink-foreground', '#4daafc')
setVar('--vscode-charts-blue', '#3794ff')
setVar('--vscode-charts-green', '#89d185')
setVar('--vscode-charts-orange', '#d18616')
setVar('--vscode-charts-purple', '#b180d7')
setVar('--vscode-charts-red', '#f14c4c')
setVar('--vscode-charts-yellow', '#cca700')

const cdn = `${location.origin}/vditor`
const option = {
  xAxis: { type: 'category', data: ['A', 'B', 'C', 'D', 'E'] },
  yAxis: { type: 'value' },
  series: [{ type: 'bar', data: [5, 20, 36, 10, 12] }],
}
const value = `# echarts\n\n\`\`\`echarts\n${JSON.stringify(option)}\n\`\`\`\n`

// Pair to github-dark before the first render (mirrors main.ts initVditor ordering).
applyEchartsTheme(window, resolveEchartsTheme('auto', 'github-dark', 'dark'))

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  height: 500,
  cdn,
  value,
  after() {
    ;(window as any).vditor = editor
    const el = () => (editor as any).vditor.ir.element as HTMLElement
    ;(window as any).__el = el
    ;(window as any).__scriptSrc = () =>
      (document.getElementById('vditorEchartsScript') as HTMLScriptElement)
        ?.src ?? ''
    // The chart's effective background = the applied theme's backgroundColor.
    ;(window as any).__bg = () => {
      const chart = el().querySelector(
        '.vditor-ir__preview .language-echarts',
      ) as HTMLElement | null
      const inst = chart && (window as any).echarts?.getInstanceByDom?.(chart)
      return inst ? inst.getOption()?.backgroundColor : undefined
    }
    // Live re-theme to a different content theme (mirrors handleConfigChanged).
    ;(window as any).__applyTheme = (
      contentTheme: string,
      mode: 'dark' | 'light',
      setting = 'auto',
    ) => {
      // Mirror handleConfigChanged's order: Vditor setTheme (CSS swap) THEN echarts re-theme.
      setVditorTheme(
        editor as any,
        mode,
        mode === 'dark' ? 'github-dark' : 'github',
        cdn,
      )
      applyEchartsTheme(
        window,
        resolveEchartsTheme(
          setting,
          contentTheme,
          mode,
          readVscodePalette(window),
        ),
      )
      reRenderEcharts(window, el(), mode)
    }
    // The chart's series colour palette = the applied theme's `color`.
    ;(window as any).__colors = () => {
      const chart = el().querySelector(
        '.vditor-ir__preview .language-echarts',
      ) as HTMLElement | null
      const inst = chart && (window as any).echarts?.getInstanceByDom?.(chart)
      return inst ? inst.getOption()?.color : undefined
    }
    ;(window as any).__ready = true
  },
})
