import { describe, expect, it } from 'vitest'
import { chunkLine, jsonLines, prettyJson, tokenizeJson } from './json'

describe('prettyJson', () => {
  it('indents with 2 spaces', () => expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}'))
  it('returns null when invalid', () => expect(prettyJson('not json')).toBeNull())
  it('handles scalars and empty input', () => {
    expect(prettyJson('42')).toBe('42')
    expect(prettyJson('')).toBeNull()
  })
})

describe('tokenizeJson', () => {
  it('marks keys and numbers', () => {
    const lines = tokenizeJson(prettyJson('{"a":1}')!)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContainEqual({ text: '"a"', kind: 'key' })
    expect(lines[1]).toContainEqual({ text: '1', kind: 'number' })
  })
  it('marks strings, bools, null, negatives and exponents', () => {
    const [l] = tokenizeJson('["x\\"y", true, false, null, -1.5e3]')
    const kinds = l.filter((t) => t.kind !== 'punct').map((t) => t.kind)
    expect(kinds).toEqual(['string', 'bool', 'bool', 'null', 'number'])
  })
  it('keeps a string containing a colon a string, and rebuilds the line losslessly', () => {
    const src = '  "k": "a: b",'
    const [l] = tokenizeJson(src)
    expect(l.map((t) => t.text).join('')).toBe(src)
    expect(l.filter((t) => t.kind === 'string')).toEqual([{ text: '"a: b"', kind: 'string' }])
  })
  it('does not choke on non-json text', () => {
    const [l] = tokenizeJson('???')
    expect(l.map((t) => t.text).join('')).toBe('???')
  })
})

describe('lossless pretty printing', () => {
  const p = (s: string) => prettyJson(s)
  it('keeps big integers exactly', () => expect(p('{"id":1234567890123456789}')).toBe('{\n  "id": 1234567890123456789\n}'))
  it('keeps number literals as written', () => {
    expect(p('[1.0,1e2,-0,1E+2,0.50]')).toBe('[\n  1.0,\n  1e2,\n  -0,\n  1E+2,\n  0.50\n]')
  })
  it('keeps duplicate keys and server order, even integer-like keys', () => {
    expect(p('{"a":1,"a":2}')).toBe('{\n  "a": 1,\n  "a": 2\n}')
    expect(p('{"b":1,"2":2,"1":3}')).toBe('{\n  "b": 1,\n  "2": 2,\n  "1": 3\n}')
  })
  it('keeps string escapes as written', () => {
    expect(p('{"u":"a\\/b é \\u00e9 \\"q\\" \\\\"}')).toBe('{\n  "u": "a\\/b é \\u00e9 \\"q\\" \\\\"\n}')
  })
  it('prints empty containers on one line, nested and scalars', () => {
    expect(p('{}')).toBe('{}')
    expect(p('[]')).toBe('[]')
    expect(p('{"a":{},"b":[],"c":[{"d":[1]}]}')).toBe('{\n  "a": {},\n  "b": [],\n  "c": [\n    {\n      "d": [\n        1\n      ]\n    }\n  ]\n}')
    expect(p(' "x" ')).toBe('"x"')
    expect(p('true')).toBe('true')
    expect(p('null')).toBe('null')
  })
  it('handles whitespace in the source', () => expect(p('{ "a" :\n [ 1 , 2 ] }')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}'))
  it('returns null for invalid input', () => {
    for (const bad of ['{"a":', '{"a" 1}', '[1,]', '{"a":1,}', '"abc', '[1 2]', '{"a":1}}', 'tru', '{1:2}', '[', '1 2', '{"a":01x}'])
      expect(p(bad), bad).toBeNull()
  })
})

describe('jsonLines', () => {
  it('is lazy: pulling 2 lines of a huge doc does not walk it all', () => {
    const raw = '[' + '1,'.repeat(200000) + '1'
    const it = jsonLines(raw) // unterminated, would throw if fully consumed
    expect(it.next().value).toBe('[')
    expect(it.next().value).toBe('  1,')
  })
})

describe('chunkLine', () => {
  it('leaves short lines alone', () => expect(chunkLine('abc', 5)).toEqual(['abc']))
  it('splits long lines losslessly', () => {
    const s = 'x'.repeat(12345)
    const c = chunkLine(s, 2000)
    expect(c).toHaveLength(7)
    expect(c.every((x) => x.length <= 2000)).toBe(true)
    expect(c.join('')).toBe(s)
  })
  it('empty line gives one empty piece', () => expect(chunkLine('', 10)).toEqual(['']))
})
