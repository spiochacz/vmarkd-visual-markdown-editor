import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampQuality,
  convertForUpload,
  isConvertibleRaster,
  planUpload,
  targetSize,
  webpName,
} from './image-convert'

describe('isConvertibleRaster', () => {
  it('accepts the rasters a canvas can re-encode', () => {
    for (const m of [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/bmp',
      'image/webp',
    ]) {
      expect(isConvertibleRaster(m)).toBe(true)
    }
  })
  it('rejects vector / animation / unknown', () => {
    for (const m of [
      'image/svg+xml',
      'image/gif',
      'text/plain',
      '',
      undefined,
    ]) {
      expect(isConvertibleRaster(m)).toBe(false)
    }
  })
})

describe('clampQuality', () => {
  it('defaults to 80 for missing / non-finite', () => {
    expect(clampQuality(undefined)).toBe(80)
    expect(clampQuality(Number.NaN)).toBe(80)
  })
  it('clamps to 1..100 and rounds', () => {
    expect(clampQuality(0)).toBe(1)
    expect(clampQuality(150)).toBe(100)
    expect(clampQuality(82.6)).toBe(83)
  })
})

describe('targetSize', () => {
  it('leaves images within bounds unchanged', () => {
    expect(targetSize(800, 600, 1600)).toEqual({
      width: 800,
      height: 600,
      scaled: false,
    })
  })
  it('caps width and preserves aspect ratio', () => {
    expect(targetSize(2000, 1000, 1000)).toEqual({
      width: 1000,
      height: 500,
      scaled: true,
    })
  })
  it('never upscales and treats maxWidth<=0 as off', () => {
    expect(targetSize(400, 300, 0)).toEqual({
      width: 400,
      height: 300,
      scaled: false,
    })
    expect(targetSize(400, 300, 9999)).toEqual({
      width: 400,
      height: 300,
      scaled: false,
    })
  })
})

describe('webpName', () => {
  it('swaps the extension for .webp', () => {
    expect(webpName('photo.png')).toBe('photo.webp')
    expect(webpName('a.tar.PNG')).toBe('a.tar.webp')
  })
  it('appends .webp when there is no extension', () => {
    expect(webpName('photo')).toBe('photo.webp')
  })
})

describe('planUpload', () => {
  it('passes SVG and GIF through even when format is webp', () => {
    expect(
      planUpload('image/svg+xml', 'd.svg', 100, 100, { format: 'webp' })
        .convert,
    ).toBe(false)
    expect(
      planUpload('image/gif', 'a.gif', 100, 100, { format: 'webp' }).convert,
    ).toBe(false)
  })
  it('passes a raster through for format=original with no scaling', () => {
    const p = planUpload('image/png', 'a.png', 100, 100, { format: 'original' })
    expect(p).toMatchObject({ convert: false, name: 'a.png' })
  })
  it('converts a raster to webp', () => {
    const p = planUpload('image/png', 'a.png', 100, 80, {
      format: 'webp',
      quality: 80,
    })
    expect(p).toMatchObject({
      convert: true,
      mime: 'image/webp',
      name: 'a.webp',
      width: 100,
      height: 80,
    })
  })
  it('downscales an original raster, keeping its format and name', () => {
    const p = planUpload('image/jpeg', 'big.jpg', 2000, 1000, {
      format: 'original',
      maxWidth: 1000,
    })
    expect(p).toMatchObject({
      convert: true,
      mime: 'image/jpeg',
      name: 'big.jpg',
      width: 1000,
      height: 500,
    })
  })
  it('downscales AND converts to webp together', () => {
    const p = planUpload('image/png', 'big.png', 2000, 1000, {
      format: 'webp',
      maxWidth: 800,
    })
    expect(p).toMatchObject({
      convert: true,
      mime: 'image/webp',
      name: 'big.webp',
      width: 800,
      height: 400,
    })
  })
})

describe('convertForUpload (canvas)', () => {
  let bitmap = { width: 200, height: 100 }
  let blobBytes = new Uint8Array([1, 2, 3, 4])
  let lastConvertOpts: any
  let lastCanvas: any
  const origCIB = (globalThis as any).createImageBitmap
  const origOC = (globalThis as any).OffscreenCanvas

  beforeEach(() => {
    bitmap = { width: 200, height: 100 }
    blobBytes = new Uint8Array([1, 2, 3, 4])
    lastConvertOpts = undefined
    lastCanvas = undefined
    ;(globalThis as any).createImageBitmap = vi.fn(async () => ({
      ...bitmap,
      close: vi.fn(),
    }))
    ;(globalThis as any).OffscreenCanvas = class {
      width: number
      height: number
      _ctx = { drawImage: vi.fn() }
      constructor(w: number, h: number) {
        this.width = w
        this.height = h
        lastCanvas = this
      }
      getContext() {
        return this._ctx
      }
      async convertToBlob(opts: any) {
        lastConvertOpts = opts
        return new Blob([blobBytes], { type: opts.type })
      }
    }
  })
  afterEach(() => {
    ;(globalThis as any).createImageBitmap = origCIB
    ;(globalThis as any).OffscreenCanvas = origOC
  })

  const file = (name: string, type: string) =>
    new File([new Uint8Array([9, 9, 9])], name, { type })

  it('passes SVG through without decoding', async () => {
    const f = file('icon.svg', 'image/svg+xml')
    const r = await convertForUpload(f, { format: 'webp' })
    expect(r.blob).toBe(f)
    expect(r.name).toBe('icon.svg')
    expect((globalThis as any).createImageBitmap).not.toHaveBeenCalled()
  })

  it('passes a raster through for original + no maxWidth (no decode)', async () => {
    const f = file('a.png', 'image/png')
    const r = await convertForUpload(f, { format: 'original', maxWidth: 0 })
    expect(r.blob).toBe(f)
    expect((globalThis as any).createImageBitmap).not.toHaveBeenCalled()
  })

  it('encodes a PNG to WebP with the configured quality', async () => {
    const f = file('a.png', 'image/png')
    const r = await convertForUpload(f, { format: 'webp', quality: 70 })
    expect(r.name).toBe('a.webp')
    expect(r.blob.type).toBe('image/webp')
    expect(lastConvertOpts).toMatchObject({ type: 'image/webp', quality: 0.7 })
    // not downscaled → canvas keeps source dims
    expect(lastCanvas).toMatchObject({ width: 200, height: 100 })
  })

  it('downscales an original raster and re-encodes to its own format', async () => {
    bitmap = { width: 1000, height: 500 }
    const f = file('big.png', 'image/png')
    const r = await convertForUpload(f, { format: 'original', maxWidth: 500 })
    expect(r.name).toBe('big.png')
    expect(lastConvertOpts.type).toBe('image/png')
    expect(lastCanvas).toMatchObject({ width: 500, height: 250 })
  })

  it('falls back to the original bytes when decoding throws', async () => {
    ;(globalThis as any).createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed')
    })
    const f = file('a.png', 'image/png')
    const r = await convertForUpload(f, { format: 'webp' })
    expect(r.blob).toBe(f)
    expect(r.name).toBe('a.png')
  })

  it('falls back when the encoder yields an empty blob', async () => {
    blobBytes = new Uint8Array([])
    const f = file('a.png', 'image/png')
    const r = await convertForUpload(f, { format: 'webp' })
    expect(r.blob).toBe(f)
    expect(r.name).toBe('a.png')
  })
})
