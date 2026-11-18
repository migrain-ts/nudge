import { expect, test } from 'vitest'
import { safeFileName } from './filename'

test('replaces forbidden characters with a dash', () => {
  expect(safeFileName('a/b:c', [])).toBe('a-b-c')
})

test('suffixes Windows reserved names', () => {
  expect(safeFileName('CON', [])).toBe('CON-')
})

test('falls back to untitled when empty', () => {
  expect(safeFileName('', [])).toBe('untitled')
})

test('strips trailing dots', () => {
  expect(safeFileName('x.', [])).toBe('x')
})

test('makes the name unique among taken names', () => {
  expect(safeFileName('x', ['x'])).toBe('x 2')
})

test('suffixes a reserved name before the first dot', () => {
  expect(safeFileName('con.txt', [])).toBe('con-.txt')
})

test('suffixes a reserved name before the first dot, case-insensitive', () => {
  expect(safeFileName('NUL.backup', [])).toBe('NUL-.backup')
})

test('deduplicates case-insensitively', () => {
  expect(safeFileName('X', ['x'])).toBe('X 2')
})
test('caps very long names to a filesystem-safe byte length', () => {
  expect(Buffer.byteLength(safeFileName('x'.repeat(300), []))).toBeLessThanOrEqual(200)
  expect(Buffer.byteLength(safeFileName('日本語'.repeat(80), []))).toBeLessThanOrEqual(200)
})
