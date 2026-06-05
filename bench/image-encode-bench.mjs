// Image-encode benchmark for task 74 (convert uploaded images to WebP/AVIF).
//
// Compares JPEG vs WebP vs AVIF on encode time AND output size at a matched
// quality, using the @jsquash WASM codecs — the exact library task 74 ships for
// host-side AVIF, so the AVIF numbers are production-faithful. WebP/JPEG via
// @jsquash (mozjpeg / libwebp) are a fair *format* comparison; in production
// WebP is encoded by the webview's Chromium canvas, which is faster than the
// libwebp-WASM time shown here (the SIZE comparison still holds).
//
// Run:  node bench/image-encode-bench.mjs
//
// Two synthetic contents bracket real markdown assets:
//   • photo      — overlapping sine gradients + grain (hard to compress)
//   • screenshot — flat blocks + sharp high-contrast stripes (UI / diagrams)

import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

// jsquash codecs load their .wasm via fetch(new URL(...)). In Node there is no
// fetch for file: URLs — polyfill it to read the wasm off disk.
const realFetch = globalThis.fetch
globalThis.fetch = async (url, opts) => {
  const s = url instanceof URL ? url.href : String(url)
  if (s.startsWith('file:')) {
    const buf = await readFile(fileURLToPath(s))
    return new Response(buf, {
      status: 200,
      headers: { 'content-type': 'application/wasm' },
    })
  }
  return realFetch(url, opts)
}

const { encode: encodeJpeg, decode: decodeJpeg } = await import('@jsquash/jpeg')
const { encode: encodeWebp } = await import('@jsquash/webp')
const { encode: encodeAvif } = await import('@jsquash/avif')
const { decode: decodePng } = await import('@jsquash/png')

// Decode a real on-disk raster into ImageData (truthful size comparison —
// synthetic content distorts cross-codec ratios). Sniff the format from the
// magic bytes, not the extension — uploaded files are sometimes mislabelled
// (e.g. media/hero.png is actually a JPEG).
async function loadImage(path) {
  const buf = await readFile(new URL(`../${path}`, import.meta.url))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e
  if (isJpeg) return decodeJpeg(ab)
  if (isPng) return decodePng(ab)
  throw new Error(`unsupported source format: ${path}`)
}

const QUALITY = 80
const RUNS = 3

// Deterministic PRNG so runs are comparable (no Math.random drift).
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function makePhoto(w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  const rand = rng(1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = 128 + 90 * Math.sin(x / 23) + 30 * Math.sin(y / 7)
      const g = 128 + 80 * Math.sin((x + y) / 31) + 30 * Math.sin(x / 11)
      const b = 128 + 90 * Math.cos(y / 19) + 30 * Math.sin((x - y) / 13)
      const grain = (rand() - 0.5) * 36 // film grain
      data[i] = r + grain
      data[i + 1] = g + grain
      data[i + 2] = b + grain
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

function makeScreenshot(w, h) {
  const data = new Uint8ClampedArray(w * h * 4)
  const palette = [
    [30, 30, 30],
    [245, 245, 245],
    [60, 120, 215],
    [220, 80, 60],
  ]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // flat blocks
      const block = ((x >> 6) + (y >> 5)) % palette.length
      let [r, g, b] = palette[block]
      // sharp high-contrast "text" stripes every few px (UI / code)
      if (y % 24 < 12 && x % 8 < 4 && block === 1) {
        r = g = b = 20
      }
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function time(fn) {
  await fn() // warmup (WASM JIT / module init)
  const ts = []
  let bytes = 0
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now()
    const out = await fn()
    ts.push(performance.now() - t)
    bytes = out.byteLength
  }
  return { ms: median(ts), bytes }
}

const FORMATS = [
  ['jpeg', (d) => encodeJpeg(d, { quality: QUALITY })],
  ['webp', (d) => encodeWebp(d, { quality: QUALITY })],
  ['avif q6', (d) => encodeAvif(d, { quality: QUALITY, speed: 6 })],
  ['avif q9', (d) => encodeAvif(d, { quality: QUALITY, speed: 9 })],
]

const CONTENTS = [
  ['photo', makePhoto],
  ['screenshot', makeScreenshot],
]
const SIZES = [
  [640, 480],
  [1280, 960],
]

async function report(label, img) {
  const rawKB = (img.data.length / 1024).toFixed(0)
  console.log(`■ ${label}  ${img.width}×${img.height}  (raw RGBA ${rawKB} KB)`)
  console.log(
    `  ${'format'.padEnd(10)} ${'time'.padStart(9)} ${'size'.padStart(10)} ${'vs jpeg'.padStart(9)}`,
  )
  let jpegBytes = 0
  for (const [name, enc] of FORMATS) {
    const { ms, bytes } = await time(() => enc(img))
    if (name === 'jpeg') jpegBytes = bytes
    const vsJpeg =
      jpegBytes && name !== 'jpeg'
        ? `${((bytes / jpegBytes) * 100).toFixed(0)}%`
        : '—'
    console.log(
      `  ${name.padEnd(10)} ${`${ms.toFixed(1)}ms`.padStart(9)} ${`${(bytes / 1024).toFixed(1)}KB`.padStart(10)} ${vsJpeg.padStart(9)}`,
    )
  }
  console.log('')
}

console.log(`\nImage-encode benchmark — quality ${QUALITY}, median of ${RUNS} runs`)
console.log(`Node ${process.version}`)

// Real on-disk images (truthful size comparison).
const REAL = [
  ['hero (UI screenshot)', 'media/hero.png'],
  ['paper texture (photo)', 'media/vditor/dist/js/highlight.js/styles/brown-papersq.png'],
  ['pojoaque (photo)', 'media/vditor/dist/js/highlight.js/styles/pojoaque.jpg'],
]
console.log('\n── REAL IMAGES ──\n')
for (const [label, path] of REAL) {
  try {
    await report(label, await loadImage(path))
  } catch (e) {
    console.log(`  (skipped ${path}: ${e.message})\n`)
  }
}

// Quality sweep on one real photo — reveals where AVIF actually wins (lower
// bitrate). A fixed nominal "quality" is NOT comparable across codecs; the
// curve is. webp/avif at q40 vs jpeg at q40 shows the low-bitrate advantage.
console.log('── QUALITY SWEEP (real hero 640×640) ──\n')
try {
  const hero = await loadImage('media/hero.png')
  console.log(
    `  ${'q'.padEnd(5)} ${'jpeg'.padStart(9)} ${'webp'.padStart(9)} ${'avif s6'.padStart(9)}`,
  )
  for (const q of [30, 50, 70, 90]) {
    const j = (await encodeJpeg(hero, { quality: q })).byteLength / 1024
    const w = (await encodeWebp(hero, { quality: q })).byteLength / 1024
    const a =
      (await encodeAvif(hero, { quality: q, speed: 6 })).byteLength / 1024
    console.log(
      `  ${String(q).padEnd(5)} ${`${j.toFixed(1)}KB`.padStart(9)} ${`${w.toFixed(1)}KB`.padStart(9)} ${`${a.toFixed(1)}KB`.padStart(9)}`,
    )
  }
  console.log('')
} catch (e) {
  console.log(`  (sweep skipped: ${e.message})\n`)
}

console.log('── SYNTHETIC (controlled scaling / encode-time story) ──\n')
for (const [cname, make] of CONTENTS) {
  for (const [w, h] of SIZES) {
    const img = make(w, h)
    const rawKB = (img.data.length / 1024).toFixed(0)
    console.log(`■ ${cname}  ${w}×${h}  (raw RGBA ${rawKB} KB)`)
    console.log(
      `  ${'format'.padEnd(10)} ${'time'.padStart(9)} ${'size'.padStart(10)} ${'vs jpeg'.padStart(9)}`,
    )
    let jpegBytes = 0
    for (const [name, enc] of FORMATS) {
      const { ms, bytes } = await time(() => enc(img))
      if (name === 'jpeg') jpegBytes = bytes
      const vsJpeg =
        jpegBytes && name !== 'jpeg'
          ? `${((bytes / jpegBytes) * 100).toFixed(0)}%`
          : '—'
      console.log(
        `  ${name.padEnd(10)} ${`${ms.toFixed(1)}ms`.padStart(9)} ${`${(bytes / 1024).toFixed(1)}KB`.padStart(10)} ${vsJpeg.padStart(9)}`,
      )
    }
    console.log('')
  }
}
