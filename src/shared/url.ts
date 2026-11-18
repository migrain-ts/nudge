import type { KeyValue } from './types'

export function buildUrl(url: string, params: KeyValue[]): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('invalid-url')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('invalid-url')
  }
  for (const p of params) {
    if (!p.enabled || p.key === '') continue
    if (parsed.searchParams.has(p.key, p.value)) continue
    parsed.searchParams.append(p.key, p.value)
  }
  return parsed.toString()
}
