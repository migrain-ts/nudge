import { expect, test } from 'vitest'
import { buildUrl } from './url'

test('appends enabled params to existing query', () => {
  expect(buildUrl('http://a/p?x=1', [{ key: 'y', value: '2', enabled: true }])).toBe('http://a/p?x=1&y=2')
})

test('ignores disabled params', () => {
  expect(buildUrl('http://a/p', [{ key: 'y', value: '2', enabled: false }])).toBe('http://a/p')
})

test('ignores params with an empty key', () => {
  expect(buildUrl('http://a/p', [{ key: '', value: '2', enabled: true }])).toBe('http://a/p')
})

test('throws invalid-url for empty or non-url input', () => {
  expect(() => buildUrl('', [])).toThrow('invalid-url')
  expect(() => buildUrl('not a url', [])).toThrow('invalid-url')
})

test('throws invalid-url when there is no http or https protocol', () => {
  expect(() => buildUrl('localhost:3000/x', [])).toThrow('invalid-url')
})

test('does not append a key/value pair already present', () => {
  expect(buildUrl('http://a/p?a=1', [{ key: 'a', value: '1', enabled: true }])).toBe('http://a/p?a=1')
})

test('appends the same key with a different value', () => {
  expect(buildUrl('http://a/p?a=1', [{ key: 'a', value: '2', enabled: true }])).toBe('http://a/p?a=1&a=2')
})

test('preserves the hash fragment', () => {
  expect(buildUrl('http://a/p#frag', [{ key: 'y', value: '2', enabled: true }])).toBe('http://a/p?y=2#frag')
})

test('rejects a non-http protocol', () => {
  expect(() => buildUrl('ftp://a/p', [])).toThrow('invalid-url')
})
