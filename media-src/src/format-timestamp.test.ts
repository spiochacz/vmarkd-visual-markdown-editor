import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatTimestamp } from './format-timestamp.ts'

test('formats a date as yyyyMMdd_HHmmss', () => {
  // local-time components: 2026-05-29 19:07:12
  const date = new Date(2026, 4, 29, 19, 7, 12)
  assert.equal(formatTimestamp(date), '20260529_190712')
})

test('zero-pads single-digit month, day, hour, minute and second', () => {
  // 2026-01-02 03:04:05
  const date = new Date(2026, 0, 2, 3, 4, 5)
  assert.equal(formatTimestamp(date), '20260102_030405')
})
