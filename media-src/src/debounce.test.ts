import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import { debounce } from './debounce.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test('does not invoke the function immediately', () => {
  let calls = 0
  const fn = debounce(() => {
    calls++
  }, 100)
  fn()
  expect(calls).toBe(0)
})

test('invokes the function once after the wait elapses', () => {
  let calls = 0
  const fn = debounce(() => {
    calls++
  }, 100)
  fn()
  vi.advanceTimersByTime(100)
  expect(calls).toBe(1)
})

test('collapses rapid successive calls into a single invocation', () => {
  let calls = 0
  const fn = debounce(() => {
    calls++
  }, 100)
  fn()
  fn()
  fn()
  vi.advanceTimersByTime(99)
  expect(calls).toBe(0)
  vi.advanceTimersByTime(1)
  expect(calls).toBe(1)
})

test('passes the latest arguments to the function', () => {
  const received: number[] = []
  const fn = debounce((x: number) => {
    received.push(x)
  }, 100)
  fn(1)
  fn(2)
  fn(3)
  vi.advanceTimersByTime(100)
  expect(received).toEqual([3])
})
