import { describe, it, expect } from 'vitest'
import { wordCount, readingTime } from '../../src/reading-time'

describe('wordCount', () => {
  it('counts runs of non-whitespace', () => {
    expect(wordCount('one two three')).toBe(3)
    expect(wordCount('  spaced   out \n words ')).toBe(3)
    expect(wordCount('')).toBe(0)
    expect(wordCount('   \n\t ')).toBe(0)
  })
})

describe('readingTime', () => {
  it('rounds up at ~200 wpm, min 1 min for any non-empty doc', () => {
    expect(readingTime('')).toBe('~0 min read')
    expect(readingTime('a b c')).toBe('~1 min read')
    expect(readingTime(Array(200).fill('w').join(' '))).toBe('~1 min read')
    expect(readingTime(Array(201).fill('w').join(' '))).toBe('~2 min read')
    expect(readingTime(Array(600).fill('w').join(' '))).toBe('~3 min read')
  })
})
