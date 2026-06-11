import { test, expect } from './coverage-fixture'

// When a code block is expanded for editing in IR, only the editable SOURCE should show — Vditor
// otherwise leaves the rendered `.vditor-ir__preview` visible too, stacking the raw source over
// the render (the reported "weird background / overlap"). Uses the blockbg harness: real Vditor +
// a ```js block, with a content-theme code panel + inline-code var simulated.

const displays = () =>
  // returns {src, preview} computed display for the ```js code-block node
  (window as any).__dumpDisplays?.() ??
  (() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const d = (sel: string) => {
      const el = node.querySelector(sel)
      return el ? getComputedStyle(el).display : 'missing'
    }
    return {
      src: d('.vditor-ir__marker--pre'),
      preview: d('.vditor-ir__preview'),
    }
  })()

test.beforeEach(async ({ page }) => {
  await page.goto('/blockbg.html')
  await page.waitForFunction(() => (window as any).__ready === true)
  await page.waitForFunction(
    () =>
      !!(window as any).__el().querySelector('.vditor-ir__preview code.hljs'),
    undefined,
    { timeout: 10000 },
  )
})

test('collapsed code block shows the rendered preview', async ({ page }) => {
  const vis = await page.evaluate(displays)
  expect(vis.preview).not.toBe('none') // render visible when not editing
})

test('expanded code block source has no inline-code background (transparent over the panel)', async ({
  page,
}) => {
  const expanded = await page.evaluate(() => (window as any).__expandCode())
  expect(expanded).toBe(true)
  const bgs = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const srcCode = node.querySelector(
      '.vditor-ir__marker--pre > code',
    ) as HTMLElement
    return {
      // the raw source `code` must be transparent — no inline-code bg leaking over the panel
      code: getComputedStyle(srcCode).backgroundColor,
      codeImg: getComputedStyle(srcCode).backgroundImage,
    }
  })
  expect(bgs.code).toBe('rgba(0, 0, 0, 0)') // transparent (#2)
  expect(bgs.codeImg).toBe('none') // no diagonal hatch (#1)
})

test('expanded code block SOURCE code stays transparent on DARK themes (no lighter inner box)', async ({
  page,
}) => {
  // On dark themes `.vditor--dark .vditor-reset code:not(.hljs)` (0,4,1) paints inline code with
  // --vmarkd-code-bg; it ALSO hits the editable source code, drawing a lighter box inside the panel
  // (github-dark only — light themes lack `.vditor--dark`). Our (0,4,2) source rule must win.
  await page.evaluate(() => {
    document.querySelector('.vditor')?.classList.add('vditor--dark')
    ;(window as any).__expandCode()
  })
  const bg = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    return getComputedStyle(
      node.querySelector('.vditor-ir__marker--pre > code') as HTMLElement,
    ).backgroundColor
  })
  expect(bg).toBe('rgba(0, 0, 0, 0)') // source code transparent even on dark (panel is flat)
})

test('expanded CODE block hides the rendered preview (no stacked panels while editing)', async ({
  page,
}) => {
  const expanded = await page.evaluate(() => (window as any).__expandCode())
  expect(expanded).toBe(true)
  const vis = await page.evaluate(displays)
  expect(vis.src).not.toBe('none') // editable source shown
  expect(vis.preview).toBe('none') // render hidden while editing (#3, scoped to code.hljs)
})

test('expanded code block SOURCE pre matches the rendered preview pre (same panel)', async ({
  page,
}) => {
  // The source pre and preview pre are both `.markdown-body pre`, so the content theme paints them
  // the same panel colour automatically — the editing surface matches the render. (We only force the
  // source pre to `display:block` so its bg renders as a clean rectangle, not an inline bleed.)
  const bgs = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const preview = getComputedStyle(
      node.querySelector('.vditor-ir__preview') as HTMLElement,
    ).backgroundColor
    ;(window as any).__expandCode()
    const srcEl = node.querySelector('.vditor-ir__marker--pre') as HTMLElement
    const cs = getComputedStyle(srcEl)
    return { src: cs.backgroundColor, display: cs.display, preview }
  })
  expect(bgs.src).toBe('rgb(20, 27, 35)') // panel from --vmarkd-code-block-bg, not transparent
  expect(bgs.src).toBe(bgs.preview) // editing surface == rendered panel
  // block (not inline) so the panel is one clean rectangle — an inline pre bleeds its bg across
  // line-boxes (incl. the `js` marker line) and clashes with the code.
  expect(bgs.display).toBe('block')
})

test('expanded code block SOURCE code is block-level (fence + code stack, not run together)', async ({
  page,
}) => {
  // The harness injects GitHub's `.markdown-body pre code { display: inline }`. Without our override
  // the source `<code>` goes inline and the ` ```lang ` info runs into the first code line. The
  // editing surface must re-assert `display: block`.
  const expanded = await page.evaluate(() => (window as any).__expandCode())
  expect(expanded).toBe(true)
  const display = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    return getComputedStyle(
      node.querySelector('.vditor-ir__marker--pre > code') as HTMLElement,
    ).display
  })
  expect(display).toBe('block') // source code stacks; not inline
})

test('editable code source is tagged .hljs so the theme styles it like the render', async ({
  page,
}) => {
  // observeCodeSource adds `.hljs` to the source <code>, so the highlight.js theme owns its style
  // (size/padding/bg/base colour) for BOTH edit and render — the editing surface matches the preview.
  const tagged = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    return (
      node
        .querySelector('.vditor-ir__marker--pre > code')
        ?.classList.contains('hljs') ?? false
    )
  })
  expect(tagged).toBe(true)
})

test('editable code source matches the rendered code — same glyph, font-size, padding (no shift)', async ({
  page,
}) => {
  // The whole point: entering edit must not move the code text. Compare the rendered code's glyph
  // box + box-model to the source code's, with the source styled via its `.hljs` tag.
  const both = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const read = (el: HTMLElement) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      const g = r.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        glyphLeft: Math.round(g.left * 100) / 100,
        font: cs.fontSize,
        pad: cs.padding,
      }
    }
    const preview = read(
      node.querySelector('.vditor-ir__preview code.hljs') as HTMLElement,
    )
    ;(window as any).__expandCode()
    const source = read(
      node.querySelector('.vditor-ir__marker--pre > code') as HTMLElement,
    )
    return { preview, source }
  })
  expect(both.source.glyphLeft).toBeCloseTo(both.preview.glyphLeft, 0) // no horizontal shift
  expect(both.source.font).toBe(both.preview.font) // same size
  expect(both.source.pad).toBe(both.preview.pad) // same padding
})

test('on DARK themes the code panel does not resize edit⇄preview (source bottom padding matches)', async ({
  page,
}) => {
  // task-05 trims the RENDERED code's bottom padding to 9.9px on dark themes; the `.hljs`-tagged
  // source otherwise keeps the theme's full 1em bottom and the panel grows ~2px taller in edit.
  const r = await page.evaluate(() => {
    document.querySelector('.vditor')?.classList.add('vditor--dark')
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const preview = getComputedStyle(
      node.querySelector('.vditor-ir__preview code.hljs') as HTMLElement,
    ).paddingBottom
    ;(window as any).__expandCode()
    const source = getComputedStyle(
      node.querySelector('.vditor-ir__marker--pre > code') as HTMLElement,
    ).paddingBottom
    return { preview, source }
  })
  expect(r.source).toBe(r.preview) // same bottom padding → panel height unchanged on toggle
})

test('code-block fence markers have no expand/collapse transition (no ``` animation)', async ({
  page,
}) => {
  const dur = await page.evaluate(() => {
    const marker = (window as any)
      .__el()
      .querySelector(
        '.vditor-ir__node[data-type="code-block"] .vditor-ir__marker',
      ) as HTMLElement
    return getComputedStyle(marker).transitionDuration
  })
  expect(dur).toBe('0s') // transition: none → fence snaps, not animates
})

test('transient blur (in-editor click) keeps the code block expanded — no preview flash', async ({
  page,
}) => {
  // Vditor's blurEvent collapses --expand on every blur; in the webview a click causes a transient
  // blur→refocus, which flashed the rendered preview. Our patch defers the collapse + skips it if
  // focus returns. Simulate the transient blur→refocus and assert the block stays expanded.
  const r = await page.evaluate(async () => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    ;(window as any).__expandCode()
    const node = Array.from(el.querySelectorAll('.vditor-ir__node')).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const before = node.classList.contains('vditor-ir__node--expand')
    el.dispatchEvent(new FocusEvent('blur')) // transient blur (Vditor's handler runs)
    el.focus() // focus returns immediately (as in an in-editor click)
    const sync = node.classList.contains('vditor-ir__node--expand')
    await new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(res)),
    )
    const after = node.classList.contains('vditor-ir__node--expand')
    return { before, sync, after }
  })
  expect(r.before).toBe(true)
  expect(r.sync).toBe(true) // collapse is deferred, not synchronous
  expect(r.after).toBe(true) // focus returned → block stays expanded (no flash)
})

test('genuine blur (focus leaves the editor) still collapses the expanded code block', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const el = (window as any).__el() as HTMLElement
    el.focus()
    ;(window as any).__expandCode()
    const node = Array.from(el.querySelectorAll('.vditor-ir__node')).find(
      (n: any) =>
        n.getAttribute('data-type') === 'code-block' &&
        n.querySelector('code.language-js'),
    ) as HTMLElement
    const before = node.classList.contains('vditor-ir__node--expand')
    el.blur() // focus truly leaves the editor
    await new Promise((res) =>
      requestAnimationFrame(() => requestAnimationFrame(res)),
    )
    const after = node.classList.contains('vditor-ir__node--expand')
    return { before, after }
  })
  expect(r.before).toBe(true)
  expect(r.after).toBe(false) // collapses once focus has genuinely left
})

test('expanded CUSTOM block (mermaid) keeps its preview — the scoped rule does NOT touch it', async ({
  page,
}) => {
  // Regression guard: the earlier blanket rule hid EVERY expanded preview, breaking mermaid/echarts/
  // math editing. The scoped `:has(> code.hljs)` rule must leave the diagram preview visible.
  await page.waitForFunction(
    () =>
      !!(window as any)
        .__el()
        .querySelector('.vditor-ir__preview .language-mermaid svg'),
    undefined,
    { timeout: 10000 },
  )
  const expanded = await page.evaluate(() => (window as any).__expandMermaid())
  expect(expanded).toBe(true)
  const preview = await page.evaluate(() => {
    const node = Array.from(
      (window as any).__el().querySelectorAll('.vditor-ir__node'),
    ).find((n: any) =>
      n.querySelector('.vditor-ir__preview .language-mermaid'),
    ) as HTMLElement
    return getComputedStyle(
      node.querySelector('.vditor-ir__preview') as HTMLElement,
    ).display
  })
  expect(preview).not.toBe('none') // diagram render stays visible while editing its source
})
