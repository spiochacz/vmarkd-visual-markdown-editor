// Task 532 step 4 — the ONE list of content decorators. Lives in boot/ (the composition root, like
// finish-init.ts) because it wires editing/, links/ and diagrams/ observers together.
//
// A decorator paints something the plain Lute output lacks (callout chrome, syntax colours, typeset
// math, visible comments, code-ref chips, soft-break marks, wiki chips). The same document is drawn
// by several stages, so the list is iterated by every stage instead of each stage hand-wiring its own
// subset:
//   - `edit` / `preview`: runFinishInit loops the registry and installs each entry's `observe` on the
//     live surface (the editor's `#app`, or the full-Preview pane). The `observers.set` keys are the
//     registry name, `preview-<name>` for the Preview instance — what finish-init registered by hand.
//   - `overlay`: main.ts runs `decorateOverlay` over the host's instant-paint `#vmarkd-prerender`
//     BEFORE `new Vditor()` (the overlay report measured main.js running ~9 ms after the overlay paints
//     with no frame between, so decorating here covers every frame the user can see). Only the entries
//     with a synchronous `decorate` pass take part; host-side string transforms (soft breaks, wiki
//     chips) are registered with no `decorate` — they exist so the parity gate and the registry test
//     still know the stage shows their marker.
//
// `parityMarkers` are NAMES in test/parity/elements.ts PARITY_MARKERS (the selector lives there, next
// to the comparator); the registry test pins every name to a real marker and every decorator observer
// in finish-init to a registry entry.

import type { WebviewMessage } from '../../../src/shared/protocol'
import { observeDiagramZoom } from '../diagrams/diagram-zoom'
import { observeCodeRefs } from '../links/code-ref-decorate'
import { applyCallouts, observeCallouts } from '../editing/callouts'
import { observeCodeSource, tagCodeSource } from '../editing/code-source'
import {
  applyCommentPreviews,
  observeHtmlComments,
  observePreviewComments,
} from '../editing/html-comment'
import {
  type HljsLike,
  type KatexLike,
  highlightPreviewCode,
  renderPreviewMath,
} from '../editing/overlay-render'
import { applyDiagramPlaceholders } from '../editing/diagram-placeholder'
import { observeSoftBreaks } from '../editing/soft-break-observer'
import { observeWysiwygCodeHighlight } from '../editing/wysiwyg-code-highlight'

type DecoratorStage = 'overlay' | 'edit' | 'preview'
export type ObserveStage = Exclude<DecoratorStage, 'overlay'>

/** What a live-surface `observe` may need from the running editor (built by runFinishInit). */
export interface ObserveContext {
  /** The stable `#app` mount (IR and WYSIWYG both live under it). */
  app: HTMLElement | null
  /** The full-Preview pane's element. */
  previewEl: HTMLElement | undefined
  /** The currently active mode's editable element (IR / WYSIWYG / SV). */
  activeMode: HTMLElement | null | undefined
  /** The IR/WYSIWYG block surface, or null in SV (read lazily: the mode can change). */
  blockMode: () => HTMLElement | null
  post: (message: WebviewMessage) => void
  getHljs: () => HljsLike | undefined
}

type Disposer = () => void

export interface ContentDecorator {
  name: string
  stages: ReadonlySet<DecoratorStage>
  /** One synchronous, idempotent pass over a rendered root (the overlay's entry point). */
  decorate?(root: ParentNode): void
  /** The MutationObserver form for a live surface; returns its disposer. */
  observe?(stage: ObserveStage, ctx: ObserveContext): Disposer
  /** PARITY_MARKERS names (test/parity/elements.ts) this decorator produces. */
  parityMarkers: readonly string[]
}

const stagesOf = (...s: DecoratorStage[]): ReadonlySet<DecoratorStage> =>
  new Set(s)

const globals = (): { hljs?: HljsLike; katex?: KatexLike } =>
  window as unknown as { hljs?: HljsLike; katex?: KatexLike }

export const CONTENT_DECORATORS: readonly ContentDecorator[] = [
  {
    name: 'callouts',
    stages: stagesOf('overlay', 'edit', 'preview'),
    decorate: (root) => applyCallouts(root),
    observe: (stage, ctx) =>
      observeCallouts(stage === 'preview' ? ctx.previewEl : ctx.app),
    parityMarkers: ['callout-title', 'callout-type'],
  },
  {
    // Task 83: bound to #app for the same mode-switch reason as callouts. The overlay's soft-break
    // spans are already in the host HTML (soft-break-html.ts, parity-pinned by
    // soft-break-html-parity.test.ts), so there is no overlay pass.
    name: 'soft-breaks',
    stages: stagesOf('overlay', 'edit'),
    observe: (_stage, ctx) => observeSoftBreaks(ctx.app, ctx.blockMode),
    parityMarkers: ['softbreak'],
  },
  {
    // Task 229. The overlay is not decorated: resolving a ref needs the host round trip.
    name: 'code-refs',
    stages: stagesOf('edit', 'preview'),
    observe: (stage, ctx) =>
      observeCodeRefs(stage === 'preview' ? ctx.previewEl : ctx.app, ctx.post),
    parityMarkers: ['code-ref-chip'],
  },
  {
    name: 'diagram-zoom',
    stages: stagesOf('edit'),
    observe: (_stage, ctx) => observeDiagramZoom(ctx.app),
    parityMarkers: [],
  },
  {
    // The Preview pane walks Comment nodes (a different mechanism, html-comment.ts), the editors and
    // the overlay decorate the `html-block` wrappers.
    name: 'html-comments',
    stages: stagesOf('overlay', 'edit', 'preview'),
    decorate: (root) => applyCommentPreviews(root),
    observe: (stage, ctx) =>
      stage === 'preview'
        ? observePreviewComments(ctx.previewEl)
        : observeHtmlComments(ctx.app),
    parityMarkers: ['html-comment'],
  },
  {
    // Edit surface: `.hljs` on the editable source so it is styled like the render (code-source.ts).
    // Overlay: that tagging PLUS the token colours Vditor's highlightRender gives the rendered fence.
    name: 'code-source',
    stages: stagesOf('overlay', 'edit'),
    decorate: (root) => {
      tagCodeSource(root)
      highlightPreviewCode(root, globals().hljs)
    },
    observe: (_stage, ctx) => observeCodeSource(ctx.activeMode),
    parityMarkers: ['hljs', 'hljs-token'],
  },
  {
    name: 'wysiwyg-highlight',
    stages: stagesOf('edit'),
    observe: (_stage, ctx) => observeWysiwygCodeHighlight(ctx.app, ctx.getHljs),
    parityMarkers: ['hljs-token'],
  },
  {
    // The live editor typesets through Vditor's lazy mathRender. The overlay renders with the KaTeX
    // the host preloads whenever the document has math (html-builder.ts docHasMath) — a synchronous
    // call, so the formula never shows as raw TeX and the block never changes height at the swap.
    name: 'math',
    stages: stagesOf('overlay'),
    decorate: (root) => renderPreviewMath(root, globals().katex),
    parityMarkers: ['katex'],
  },
  {
    // Task 532 step 5c: the live editor draws the rendered diagram; the overlay reserves its space
    // (the host's recorded size, else a fixed minimum) instead of showing the fence source.
    name: 'diagram-placeholder',
    stages: stagesOf('overlay'),
    decorate: (root) => applyDiagramPlaceholders(root),
    parityMarkers: [],
  },
  {
    // Host-side string transform (lute-host.ts renderWikiChipsInHtml, pinned to the webview renderer
    // by wiki-chip-parity.test.ts): no pass of its own, registered so every stage's chip is counted.
    name: 'wiki-chips',
    stages: stagesOf('overlay', 'edit', 'preview'),
    parityMarkers: ['wiki-chip'],
  },
]

/** Install every decorator's observer for `stage`; `register` receives the observer-registry key. */
export function observeDecorators(
  stage: ObserveStage,
  ctx: ObserveContext,
  register: (key: string, dispose: Disposer) => void,
): void {
  for (const d of CONTENT_DECORATORS) {
    if (!d.observe || !d.stages.has(stage)) continue
    register(
      stage === 'preview' ? `preview-${d.name}` : d.name,
      d.observe(stage, ctx),
    )
  }
}

/**
 * The overlay is not scrollable before the swap (the prepaint bridge only captures the scroll intent),
 * so only the first viewport plus one more is ever seen; decorating the rest costs boot time (33-42 ms
 * for a big document, over the 30 ms budget) for nothing. Returns how many leading top-level blocks
 * start within two viewports of the root's top (the one straddling the line included); all of them
 * when there is no layout (jsdom, display:none).
 */
function visibleBlockCount(root: HTMLElement): number {
  const blocks = root.children
  const limit = 2 * window.innerHeight
  // Parity-gate hook only (html-builder.ts testHoldScript): the gate compares the whole canon.
  const all = (window as { __vmarkdOverlayDecorateAll?: boolean })
    .__vmarkdOverlayDecorateAll
  if (all || !limit || !blocks.length) return blocks.length
  const top = root.getBoundingClientRect().top
  for (let i = 0; i < blocks.length; i++)
    if (blocks[i].getBoundingClientRect().top - top > limit) return i
  return blocks.length
}

/**
 * Decorate the instant-paint overlay's rendered content in place, one decorator at a time, for the
 * blocks within two viewports (see visibleBlockCount; the rest stays plain and is replaced at the
 * swap). The head blocks are moved into a fragment for the pass so every decorator's
 * descendant-only `querySelectorAll` also sees a top-level callout / comment / math block, then put
 * back. Never throws: the overlay is a nicety, the editor boot behind it is not (a decorator that
 * fails leaves that decorator's content plain, like before this registry). Returns the elapsed ms.
 */
export function decorateOverlay(root: HTMLElement | null): number {
  if (!root) return 0
  const t0 = performance.now()
  const head = document.createDocumentFragment()
  try {
    // reads first, writes after: one layout, not one per block
    const count = visibleBlockCount(root)
    for (const block of Array.from(root.children).slice(0, count))
      head.append(block)
    for (const d of CONTENT_DECORATORS) {
      if (!d.decorate || !d.stages.has('overlay')) continue
      try {
        d.decorate(head)
      } catch {
        // see the doc comment: a failed paint-only pass must not block new Vditor()
      }
    }
  } catch {
    // layout read failed: fall through, the blocks go back below
  } finally {
    root.prepend(head)
  }
  return performance.now() - t0
}
