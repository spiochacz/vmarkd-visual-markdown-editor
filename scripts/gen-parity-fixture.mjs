// Task 532 — regenerate test/vscode-e2e/fixtures/parity-canon.md from the element registry
// (test/parity/elements.ts). The committed file must equal this output; a unit test
// (test/backend/parity-registry.test.ts) fails when it does not. Run: node scripts/gen-parity-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// esbuild lives in media-src/node_modules (the webview unit's dependency).
const esbuild = createRequire(path.join(root, 'media-src', 'package.json'))('esbuild')
const src = readFileSync(path.join(root, 'test/parity/elements.ts'), 'utf8')
const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'esm' })
const mod = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const out = path.join(root, 'test/vscode-e2e/fixtures/parity-canon.md')
writeFileSync(out, mod.buildParityFixture())
console.log(`wrote ${out}`)
