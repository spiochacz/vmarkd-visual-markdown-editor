import path from 'node:path'
import { expect, test } from 'vscode-test-playwright'

// VISUAL check (task 161 step 1): while typing in a diagram's source, the deferred preview must keep
// showing the LAST rendered SVG (the .vmarkd-stale-overlay) — NOT flicker to raw source — because
// Vditor leaves the preview visible during edit. Functional asserts + screenshots to tmp/t161-shots.
const FIXTURE = path.join(__dirname, 'fixtures', 'diagram-edit.md')
const SHOTS = path.join(__dirname, '..', '..', 'tmp', 't161-shots')

function wf(workbox: import('@playwright/test').Page) {
  return workbox
    .frameLocator('iframe.webview')
    .frameLocator('iframe[title="vMarkd"], #active-frame')
}

for (const lang of ['d2', 'mermaid']) {
  test(`overlay keeps ${lang} visible while typing`, async ({
    workbox,
    evaluateInVSCode,
  }) => {
    await evaluateInVSCode(
      async (vscode, args) => {
        const [uri] = args as [string]
        await vscode.extensions.getExtension('spiochacz.vmarkd')?.activate()
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(uri),
          'vmarkd.editor',
        )
      },
      [FIXTURE] as [string],
    )
    const frame = wf(workbox)
    await frame.locator('.vditor-ir').first().waitFor({ timeout: 60_000 })
    await frame
      .locator(`.language-${lang} svg, .language-${lang} canvas`)
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => {})
    await frame
      .locator('body')
      .evaluate(() => new Promise((r) => setTimeout(r, 1500)))

    const placed = await frame.locator('body').evaluate((_b, l) => {
      const wrapper = document.querySelector(`.language-${l}`)
      const node = wrapper?.closest('.vditor-ir__node') as HTMLElement | null
      if (!node) return false
      node.classList.add('vditor-ir__node--expand')
      const source = node.querySelector(
        '.vditor-ir__marker--pre',
      ) as HTMLElement | null
      if (!source) return false
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT)
      let target: Text | null = null
      let n = walker.nextNode() as Text | null
      while (n) {
        if (n.textContent?.includes('zzz')) {
          target = n
          break
        }
        n = walker.nextNode() as Text | null
      }
      if (!target) return false
      const idx = (target.textContent ?? '').lastIndexOf('zzz') + 3
      const r = document.createRange()
      r.setStart(target, idx)
      r.collapse(true)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(r)
      source.focus()
      return true
    }, lang)
    expect(placed, `could not place caret in ${lang} source`).toBe(true)

    await frame
      .locator('.vditor-ir')
      .screenshot({ path: path.join(SHOTS, `${lang}-1-before.png`) })

    // Type a few chars; the quiet-timer (220 ms) keeps isTyping true ~after the last keystroke.
    await workbox.keyboard.type('xxxxxx', { delay: 30 })

    // Immediately (within the quiet window) inspect the deferred preview's state.
    const mid = await frame.locator('body').evaluate((_b, l) => {
      const wrapper = document.querySelector(`.language-${l}`)
      const node = wrapper?.closest('.vditor-ir__node')
      const preview = node?.querySelector(
        '.vditor-ir__preview',
      ) as HTMLElement | null
      const overlay = preview?.querySelector('.vmarkd-stale-overlay')
      const overlayRender = overlay?.querySelector('svg, canvas') as
        | HTMLElement
        | undefined
      const rawChild = preview
        ? (Array.from(preview.children).find(
            (c) => !c.classList.contains('vmarkd-stale-overlay'),
          ) as HTMLElement | undefined)
        : undefined
      // The overlay must show the DIAGRAM (not a Vditor UI icon) AND be centred like the real render,
      // so swapping doesn't shift it left. Compare the overlay render's centre to the preview's centre.
      let centredOffset = 999
      if (overlayRender && preview) {
        const o = overlayRender.getBoundingClientRect()
        const p = preview.getBoundingClientRect()
        centredOffset = Math.abs(o.left + o.width / 2 - (p.left + p.width / 2))
      }
      return {
        deferredClass: !!preview?.classList.contains('vmarkd-deferred'),
        hasOverlayRender: !!overlayRender,
        rawChildHidden: rawChild
          ? getComputedStyle(rawChild).display === 'none'
          : null,
        overlayIsUiIcon: /vditor-icon/.test(overlay?.innerHTML ?? ''),
        centredOffset,
      }
    }, lang)
    await frame
      .locator('.vditor-ir')
      .screenshot({ path: path.join(SHOTS, `${lang}-2-typing.png`) })

    // Swap-when-ready: sample every frame through the settle (quiet timer fires + the async re-render
    // runs) and count any "bare" frame — preview showing NEITHER the overlay NOR a fresh render, i.e.
    // the raw-source flash ("przeskok przez białe tło z napisami"). It must be ZERO, and the new render
    // must land by the end.
    const settle = await frame.locator('body').evaluate(
      (_b, l) =>
        new Promise<{ bare: number; frames: number; rendered: boolean }>(
          (resolve) => {
            const start = performance.now()
            let bare = 0
            let frames = 0
            let rendered = false
            const tick = () => {
              const wrapper = document.querySelector(`.language-${l}`)
              const node = wrapper?.closest('.vditor-ir__node')
              const preview = node?.querySelector('.vditor-ir__preview')
              if (preview) {
                const hasOverlay = !!preview.querySelector(
                  '.vmarkd-stale-overlay',
                )
                const freshRender = Array.from(
                  preview.querySelectorAll('svg, canvas'),
                ).some((e) => !e.closest('.vmarkd-stale-overlay'))
                frames++
                if (!hasOverlay && !freshRender) bare++
                if (freshRender && !hasOverlay) rendered = true
              }
              if (performance.now() - start < 2500) requestAnimationFrame(tick)
              else resolve({ bare, frames, rendered })
            }
            requestAnimationFrame(tick)
          },
        ),
      lang,
    )
    await frame
      .locator('.vditor-ir')
      .screenshot({ path: path.join(SHOTS, `${lang}-3-after.png`) })

    // eslint-disable-next-line no-console
    console.log(
      `[t161-visual] ${lang} mid-typing=${JSON.stringify(mid)} settle=${JSON.stringify(settle)}`,
    )
    // The overlay must be present AND showing a render, and the raw source hidden — i.e. the diagram
    // stayed visible (no flicker to raw text) while typing.
    expect(
      mid.deferredClass,
      `${lang}: preview not marked deferred while typing`,
    ).toBe(true)
    expect(
      mid.hasOverlayRender,
      `${lang}: overlay has no cached render while typing`,
    ).toBe(true)
    expect(
      mid.rawChildHidden,
      `${lang}: raw source not hidden under overlay`,
    ).toBe(true)
    // The overlay must be the DIAGRAM, not a Vditor UI icon (the copy-button `#vditor-icon-copy` bug),
    // and centred like the real render so the diagram doesn't jump left↔centre on the swap.
    expect(
      mid.overlayIsUiIcon,
      `${lang}: overlay snapshot is a Vditor UI icon, not the diagram`,
    ).toBe(false)
    expect(
      mid.centredOffset,
      `${lang}: overlay not horizontally centred (off by ${mid.centredOffset}px → jumps to the edge)`,
    ).toBeLessThan(8)
    // swap-when-ready: no raw-source flash through the settle, and the new render landed.
    expect(
      settle.bare,
      `${lang}: ${settle.bare} bare frame(s) — raw source flashed during settle`,
    ).toBe(0)
    expect(settle.rendered, `${lang}: new render never landed`).toBe(true)
  })
}
