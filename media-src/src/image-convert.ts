// Client-side image conversion for uploads/pastes (task 74).
//
// Final scope: an uploaded image is written either as its ORIGINAL bytes or
// re-encoded to WebP — decided by the `vmarkd.image.*` settings. Everything
// happens here in the webview on an OffscreenCanvas (Chromium encodes WebP
// natively), so the host stays format-agnostic and the .vsix needs no codecs.
//
// `convertForUpload` is the only DOM-touching entry point; the decision logic
// (`planUpload`, `targetSize`, …) is pure and unit-tested. Any failure falls
// back to the original bytes — an upload is never lost.

export interface ImageConvertOptions {
  format?: 'original' | 'webp'
  quality?: number // 1..100 (WebP / re-encode quality)
  maxWidth?: number // 0 = no scaling
}

export interface ConvertResult {
  blob: Blob
  name: string
}

// Rasters we can decode+encode on a canvas. SVG (vector) and GIF (animation)
// are deliberately excluded — converting them would lose vector scalability /
// animation, so they always pass through untouched.
const CONVERTIBLE_RASTER = /^image\/(png|jpeg|jpg|bmp|webp)$/i

export function isConvertibleRaster(mime: string | undefined): boolean {
  return !!mime && CONVERTIBLE_RASTER.test(mime)
}

export function clampQuality(quality: number | undefined): number {
  const q =
    typeof quality === 'number' && Number.isFinite(quality) ? quality : 80
  return Math.min(100, Math.max(1, Math.round(q)))
}

// Cap width to maxWidth (aspect ratio preserved, never upscaled). maxWidth <= 0
// or an image already within bounds → unchanged.
export function targetSize(
  width: number,
  height: number,
  maxWidth: number | undefined,
): { width: number; height: number; scaled: boolean } {
  if (!maxWidth || maxWidth <= 0 || width <= maxWidth) {
    return { width, height, scaled: false }
  }
  const w = Math.round(maxWidth)
  const h = Math.max(1, Math.round((height * w) / width))
  return { width: w, height: h, scaled: true }
}

export function webpName(name: string): string {
  return `${name.replace(/\.[^./\\]+$/, '')}.webp`
}

export interface UploadPlan {
  convert: boolean
  width: number
  height: number
  mime: string
  name: string
}

// Decide what to do with a source image — pure, no canvas. `convert: false`
// means write the original bytes verbatim under the original name.
export function planUpload(
  srcMime: string | undefined,
  srcName: string,
  srcWidth: number,
  srcHeight: number,
  opts: ImageConvertOptions,
): UploadPlan {
  const passthrough = (): UploadPlan => ({
    convert: false,
    width: srcWidth,
    height: srcHeight,
    mime: srcMime ?? '',
    name: srcName,
  })

  // SVG / GIF / unknown → never touched, regardless of settings.
  if (!isConvertibleRaster(srcMime)) return passthrough()

  const toWebp = opts.format === 'webp'
  const { width, height, scaled } = targetSize(
    srcWidth,
    srcHeight,
    opts.maxWidth,
  )

  // original format + no downscale → nothing to do.
  if (!toWebp && !scaled) return passthrough()

  const mime = toWebp ? 'image/webp' : (srcMime as string)
  const name = toWebp ? webpName(srcName) : srcName
  return { convert: true, width, height, mime, name }
}

// Re-encode / downscale a file per the settings, on an OffscreenCanvas. Returns
// the original file untouched on passthrough or on ANY failure (decode/encode),
// so a problematic upload still lands verbatim instead of being dropped.
export async function convertForUpload(
  file: File,
  opts: ImageConvertOptions,
): Promise<ConvertResult> {
  try {
    // Quick pure check before paying for createImageBitmap.
    if (
      !isConvertibleRaster(file.type) ||
      (opts.format !== 'webp' && !(opts.maxWidth && opts.maxWidth > 0))
    ) {
      return { blob: file, name: file.name }
    }

    const bitmap = await createImageBitmap(file)
    const plan = planUpload(
      file.type,
      file.name,
      bitmap.width,
      bitmap.height,
      opts,
    )
    if (!plan.convert) {
      bitmap.close?.()
      return { blob: file, name: file.name }
    }

    const canvas = new OffscreenCanvas(plan.width, plan.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return { blob: file, name: file.name }
    }
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height)
    bitmap.close?.()

    const blob = await canvas.convertToBlob({
      type: plan.mime,
      quality: clampQuality(opts.quality) / 100,
    })
    // A 0-byte / wrong-type encode result → fall back rather than save garbage.
    if (!blob || blob.size === 0) return { blob: file, name: file.name }
    return { blob, name: plan.name }
  } catch {
    return { blob: file, name: file.name }
  }
}
