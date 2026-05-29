import { test } from 'node:test'
import assert from 'node:assert/strict'
import { debounce } from './debounce.ts'

test('does not invoke the function immediately', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const fn = debounce(() => {
    calls++
  }, 100)
  fn()
  assert.equal(calls, 0)
})

test('invokes the function once after the wait elapses', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const fn = debounce(() => {
    calls++
  }, 100)
  fn()
  t.mock.timers.tick(100)
  assert.equal(calls, 1)
})

test('collapses rapid successive calls into a single invocation', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  const fn = debounce(() => {
    calls++
  }, 100)
  fn()
  fn()
  fn()
  t.mock.timers.tick(99)
  assert.equal(calls, 0)
  t.mock.timers.tick(1)
  assert.equal(calls, 1)
})

test('passes the latest arguments to the function', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const received: number[] = []
  const fn = debounce((x: number) => {
    received.push(x)
  }, 100)
  fn(1)
  fn(2)
  fn(3)
  t.mock.timers.tick(100)
  assert.deepEqual(received, [3])
})
