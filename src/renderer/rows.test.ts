import { describe, expect, it } from 'vitest'
import { createRowSource, initRows } from './rows'

describe('createRowSource', () => {
  it('takes lines by budget and is done at the end', () => {
    const src = createRowSource('a\nb\nc', false)
    expect(src.take(2)).toHaveLength(2)
    expect(src.done).toBe(false)
    expect(src.take(2)).toHaveLength(1)
    expect(src.done).toBe(true)
  })
  it('a giant single line is chunked and costs per piece', () => {
    const src = createRowSource('x'.repeat(10_000_000), false)
    const rows = src.take(500)
    expect(rows).toHaveLength(500)
    expect(rows.every((r) => r.tokens[0].text.length <= 2000)).toBe(true)
    expect(src.done).toBe(false)
    expect(src.take(10_000)).toHaveLength(4500)
    expect(src.done).toBe(true)
  })
  it('tokenizes JSON lines and falls back to plain text when invalid', () => {
    const j = createRowSource('{"a":1}', true).take()
    expect(j.map((r) => r.tokens.map((t) => t.text).join(''))).toEqual(['{', '  "a": 1', '}'])
    const bad = createRowSource('<html>\nno', true).take()
    expect(bad.map((r) => r.tokens[0].text)).toEqual(['<html>', 'no'])
  })
})

describe('initRows (StrictMode-safe initializer)', () => {
  const body = JSON.stringify({ items: Array.from({ length: 2000 }, (_, i) => i) })
  const text = (rows: { tokens: { text: string }[] }[]) => rows.map((r) => r.tokens.map((t) => t.text).join(''))
  it('two independent calls give the same first batch and each src continues at row 500', () => {
    const a = initRows(body, true)
    const b = initRows(body, true)
    expect(text(a.rows)).toEqual(text(b.rows))
    expect(a.rows).toHaveLength(500)
    const nextA = text(a.src.take())
    expect(nextA).toEqual(text(b.src.take()))
    expect(nextA[0]).toBe('    ' + '498,') // row 500 (index 500): contiguous after row 499
  })
})
