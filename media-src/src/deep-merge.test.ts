import { test, expect } from 'vitest'
import { deepMerge } from './deep-merge.ts'

test('merges flat properties from multiple sources, later wins', () => {
  const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })
  expect(result).toEqual({ a: 1, b: 3, c: 4 })
})

test('deep-merges nested objects without clobbering sibling keys', () => {
  const result = deepMerge(
    { preview: { theme: { current: 'light' }, hljs: { style: 'a' } } },
    { preview: { theme: { current: 'dark' } } }
  )
  expect(result).toEqual({
    preview: { theme: { current: 'dark' }, hljs: { style: 'a' } },
  })
})

test('skips undefined source values (keeps target value)', () => {
  const result = deepMerge({ a: 1, b: 2 }, { a: undefined, c: 3 })
  expect(result).toEqual({ a: 1, b: 2, c: 3 })
})

test('replaces arrays instead of merging them by index', () => {
  const result = deepMerge({ list: [1, 2, 3] }, { list: [9] })
  expect(result).toEqual({ list: [9] })
})

test('replaces a primitive with an object and vice versa', () => {
  expect(deepMerge({ a: 1 }, { a: { x: 1 } })).toEqual({ a: { x: 1 } })
  expect(deepMerge({ a: { x: 1 } }, { a: 5 })).toEqual({ a: 5 })
})

test('does not mutate the input objects', () => {
  const target = { a: { x: 1 } }
  const source = { a: { y: 2 } }
  deepMerge(target, source)
  expect(target).toEqual({ a: { x: 1 } })
  expect(source).toEqual({ a: { y: 2 } })
})

test('merges three sources left to right', () => {
  const result = deepMerge({ a: 1 }, { b: 2 }, { a: 9, c: 3 })
  expect(result).toEqual({ a: 9, b: 2, c: 3 })
})
