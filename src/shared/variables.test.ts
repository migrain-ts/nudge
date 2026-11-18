import { expect, test } from 'vitest'
import { substitute } from './variables'

test('replaces a known variable', () => {
  expect(substitute('{{baseUrl}}/u', [{ key: 'baseUrl', value: 'http://x', enabled: true }])).toEqual({
    text: 'http://x/u',
    missing: [],
  })
})

test('leaves unknown variable unchanged and reports it as missing', () => {
  expect(substitute('{{baseUrl}}/u', [])).toEqual({ text: '{{baseUrl}}/u', missing: ['baseUrl'] })
})

test('treats a disabled variable as missing', () => {
  expect(substitute('{{b}}', [{ key: 'b', value: 'X', enabled: false }])).toEqual({
    text: '{{b}}',
    missing: ['b'],
  })
})

test('does not re-substitute a value containing a placeholder', () => {
  const vars = [
    { key: 'a', value: '{{b}}', enabled: true },
    { key: 'b', value: 'X', enabled: true },
  ]
  expect(substitute('{{a}}', vars)).toEqual({ text: '{{b}}', missing: [] })
})

test('accepts whitespace inside braces', () => {
  expect(substitute('{{ b }}', [{ key: 'b', value: 'X', enabled: true }])).toEqual({ text: 'X', missing: [] })
})
