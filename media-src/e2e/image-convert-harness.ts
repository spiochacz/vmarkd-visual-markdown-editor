import {
  convertForUpload,
  type ImageConvertOptions,
} from '../src/image-convert'

// Runs the REAL canvas path of task 74's image conversion in Chromium — the
// OffscreenCanvas WebP encode + createImageBitmap decode that the Node unit
// tests can only mock. The spec drives `__run` with real PNG bytes and asserts
// the output is genuine WebP (magic bytes) at the expected dimensions.

async function makePngFile(width: number, height: number, name: string) {
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  // Some detail so the encode isn't a degenerate flat image.
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      ctx.fillStyle = `rgb(${x % 256}, ${y % 256}, ${(x + y) % 256})`
      ctx.fillRect(x, y, 8, 8)
    }
  }
  const blob: Blob = await new Promise((res) =>
    c.toBlob((b) => res(b as Blob), 'image/png'),
  )
  return new File([blob], name, { type: 'image/png' })
}

async function describeBlob(blob: Blob, name: string) {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
  const isWebp =
    head[0] === 0x52 && // R
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x46 && // F
    head[8] === 0x57 && // W
    head[9] === 0x45 && // E
    head[10] === 0x42 && // B
    head[11] === 0x50 // P
  const isPng = head[0] === 0x89 && head[1] === 0x50
  const bmp = await createImageBitmap(blob)
  const out = {
    name,
    type: blob.type,
    size: blob.size,
    isWebp,
    isPng,
    width: bmp.width,
    height: bmp.height,
  }
  bmp.close?.()
  return out
}

;(window as any).__run = async (
  opts: ImageConvertOptions,
  src: { width: number; height: number; name: string },
) => {
  const file = await makePngFile(src.width, src.height, src.name)
  const { blob, name } = await convertForUpload(file, opts)
  return describeBlob(blob, name)
}

// SVG can't be decoded by createImageBitmap reliably; assert passthrough only.
;(window as any).__runSvg = async (opts: ImageConvertOptions) => {
  const file = new File(
    ['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'],
    'icon.svg',
    { type: 'image/svg+xml' },
  )
  const { blob, name } = await convertForUpload(file, opts)
  return { name, type: blob.type, size: blob.size, passthrough: blob === file }
}
;(window as any).__ready = true
