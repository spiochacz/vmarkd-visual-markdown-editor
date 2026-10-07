// Task 528 harness — Vditor 3.11.3 neutralisations (native callout off, HR toolbar `---`, native
// WaveDrom no-op). `?mode=ir|wysiwyg|sv|preview` and `?md=<markdown>` pick the surface and document.
// Deliberately constructs Vditor with NO callout option: the patchLuteHook seam alone must keep
// native callouts off (the buildVditorOptions half is covered by vditor-options.test.ts).
import '../src/boot/preload'
import Vditor from 'vditor/src/index'
import { installDiagramRuntime } from '../src/diagrams/diagram-runtime'
import { observeCallouts } from '../src/editing/callouts'
import { Disposables } from '../src/util/disposables'

const params = new URLSearchParams(location.search)
const mode = (params.get('mode') || 'ir') as 'ir' | 'wysiwyg' | 'sv' | 'preview'
const md = params.get('md') || ''
const cdn = `${location.origin}/vditor`
const app = document.getElementById('app')!
const w = window as any

if (mode === 'preview') {
  Vditor.preview(app, md, {
    cdn,
    after() {
      w.__ready = true
    },
  })
} else {
  const observers = new Disposables()
  const editor = new Vditor(app, {
    cdn,
    mode,
    height: 500,
    cache: { enable: false },
    value: md,
    after() {
      const el = () =>
        document.querySelector(
          { ir: '.vditor-ir', wysiwyg: '.vditor-wysiwyg', sv: '.vditor-sv' }[
            mode
          ],
        ) as HTMLElement
      w.__el = el
      w.__getValue = () => editor.getValue()
      observeCallouts(el())
      installDiagramRuntime(
        {
          app,
          win: window,
          observers,
          postCacheMessage: () => {
            /* no extension host in the harness */
          },
        },
        { installCache: () => () => undefined },
      )
      w.__ready = true
    },
  })
  w.vditor = editor
}
