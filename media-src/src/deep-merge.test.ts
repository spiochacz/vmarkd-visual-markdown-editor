import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deepMerge } from './deep-merge.ts'

test('merges flat properties from multiple sources, later wins', () => {
  const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })
  assert.deepEqual(result, { a: 1, b: 3, c: 4 })
})

test('deep-merges nested objects without clobbering sibling keys', () => {
  const result = deepMerge(
    { preview: { theme: { current: 'light' }, hljs: { style: 'a' } } },
    { preview: { theme: { current: 'dark' } } }
  )
  assert.deepEqual(result, {
    preview: { theme: { current: 'dark' }, hljs: { style: 'a' } },
  })
})

test('skips undefined source values (keeps target value)', () => {
  const result = deepMerge({ a: 1, b: 2 }, { a: undefined, c: 3 })
  assert.deepEqual(result, { a: 1, b: 2, c: 3 })
})

test('replaces arrays instead of merging them by index', () => {
  const result = deepMerge({ list: [1, 2, 3] }, { list: [9] })
  assert.deepEqual(result, { list: [9] })
})

test('replaces a primitive with an object and vice versa', () => {
  assert.deepEqual(deepMerge({ a: 1 }, { a: { x: 1 } }), { a: { x: 1 } })
  assert.deepEqual(deepMerge({ a: { x: 1 } }, { a: 5 }), { a: 5 })
})

test('does not mutate the input objects', () => {
  const target = { a: { x: 1 } }
  const source = { a: { y: 2 } }
  deepMerge(target, source)
  assert.deepEqual(target, { a: { x: 1 } })
  assert.deepEqual(source, { a: { y: 2 } })
})

test('merges three sources left to right', () => {
  const result = deepMerge({ a: 1 }, { b: 2 }, { a: 9, c: 3 })
  assert.deepEqual(result, { a: 9, b: 2, c: 3 })
})
