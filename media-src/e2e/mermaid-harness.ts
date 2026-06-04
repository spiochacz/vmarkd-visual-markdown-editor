// Harness for task 59 (live mermaid re-theme). Real Vditor (IR) with a mermaid diagram;
// exposes the production reRenderMermaid so the spec can flip the theme and assert the
// diagram re-renders with the new colors.
import '../src/preload'
import Vditor from 'vditor/src/index'
import { reRenderMermaid } from '../src/mermaid-retheme'

const editor = new Vditor('app', {
  cache: { enable: false },
  mode: 'ir',
  cdn: `${location.origin}/vditor`,
  value:
    '# doc\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n\ntext after\n',
  after() {
    ;(window as any).vditor = editor
    ;(window as any).__el = () =>
      (editor as any).vditor.ir.element as HTMLElement
    ;(window as any).__reTheme = (theme: 'dark' | 'light') =>
      reRenderMermaid(
        (editor as any).vditor.ir.element as HTMLElement,
        `${location.origin}/vditor`,
        theme,
      )
    ;(window as any).__ready = true
  },
})
