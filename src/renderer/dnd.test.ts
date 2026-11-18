import { describe, expect, it } from 'vitest'
import { computeDrop, isNoopMove, moveIndex } from './dnd'

describe('computeDrop', () => {
  it('after a row inserts at index + 1', () => {
    expect(computeDrop('a', 1, 'after', 3)).toEqual({ dir: 'a', index: 2 })
  })
  it('before a row inserts at its index', () => {
    expect(computeDrop('a', 1, 'before', 3)).toEqual({ dir: 'a', index: 1 })
  })
  it('empty folder target gives index 0', () => {
    expect(computeDrop('a', null, 'before', 0)).toEqual({ dir: 'a', index: 0 })
  })
  it('folder body drop (no row) appends at length', () => {
    expect(computeDrop('a', null, 'after', 3)).toEqual({ dir: 'a', index: 3 })
  })
})

describe('moveIndex', () => {
  it('shifts down by one when moving later within the same folder', () => {
    expect(moveIndex({ dir: 'a', index: 3 }, 'a', 0)).toBe(2)
  })
  it('keeps the index when moving earlier or across folders', () => {
    expect(moveIndex({ dir: 'a', index: 0 }, 'a', 2)).toBe(0)
    expect(moveIndex({ dir: 'b', index: 3 }, 'a', 0)).toBe(3)
  })
})

describe('moveIndex last position', () => {
  it('dropping after the last row of the same folder lands at the end', () => {
    // folder [a,b,c], drag a (0) after c -> target 3 -> list without a has 2 items, insert at 2
    expect(moveIndex({ dir: 'x', index: 3 }, 'x', 0)).toBe(2)
  })
})

describe('isNoopMove', () => {
  const src = { dir: 'x', index: 1 }
  it('is a no-op when dropped on itself or just after itself', () => {
    expect(isNoopMove(src, { dir: 'x', index: 1 })).toBe(true)
    expect(isNoopMove(src, { dir: 'x', index: 2 })).toBe(true)
  })
  it('is a real move for other positions or other folders', () => {
    expect(isNoopMove(src, { dir: 'x', index: 0 })).toBe(false)
    expect(isNoopMove(src, { dir: 'x', index: 3 })).toBe(false)
    expect(isNoopMove(src, { dir: 'y', index: 1 })).toBe(false)
  })
})
