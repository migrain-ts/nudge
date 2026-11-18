import { describe, expect, it } from 'vitest'
import { isAllowedNavigation } from './navigation'

const FILE = 'file:///app/out/renderer/index.html'
const DEV = 'http://localhost:5173/'

describe('isAllowedNavigation', () => {
  it('allows reloading the current page', () => {
    expect(isAllowedNavigation(FILE, FILE)).toBe(true)
    expect(isAllowedNavigation(DEV, DEV)).toBe(true)
  })
  it('ignores the hash', () => {
    expect(isAllowedNavigation(FILE + '#x', FILE)).toBe(true)
    expect(isAllowedNavigation(FILE, FILE + '#y')).toBe(true)
  })
  it('blocks every other URL', () => {
    expect(isAllowedNavigation('file:///etc/hosts', FILE)).toBe(false)
    expect(isAllowedNavigation('https://example.com', FILE)).toBe(false)
    expect(isAllowedNavigation('http://localhost:5173/other', DEV)).toBe(false)
    expect(isAllowedNavigation(FILE + '?q=1', FILE)).toBe(false)
  })
  it('blocks malformed URLs', () => {
    expect(isAllowedNavigation('not a url', FILE)).toBe(false)
    expect(isAllowedNavigation(FILE, '')).toBe(false)
  })
})
