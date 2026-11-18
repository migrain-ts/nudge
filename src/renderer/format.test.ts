import { describe, expect, it } from 'vitest'
import { formatDuration, formatSize, ignoredLabel } from './format'

describe('formatDuration', () => {
  it('ms below one second, rounded', () => {
    expect(formatDuration(142)).toBe('142 ms')
    expect(formatDuration(999.4)).toBe('999 ms')
  })
  it('seconds from 999.5, with a decimal point', () => {
    expect(formatDuration(999.6)).toBe('1 s')
    expect(formatDuration(1000)).toBe('1 s')
    expect(formatDuration(1500)).toBe('1.5 s')
    expect(formatDuration(12340)).toBe('12.34 s')
  })
})
describe('formatSize', () => {
  it('formats', () => {
    expect(formatSize(12)).toBe('12 B')
    expect(formatSize(2355)).toBe('2.3 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5 MB')
  })
})
describe('ignoredLabel', () => {
  it('pluralises', () => {
    expect(ignoredLabel(1)).toBe('1 file ignored')
    expect(ignoredLabel(3)).toBe('3 files ignored')
  })
})
