import type { KeyValue } from './types'

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g

export function substitute(text: string, vars: KeyValue[]): { text: string; missing: string[] } {
  const missing: string[] = []
  const result = text.replace(PLACEHOLDER, (match, name: string) => {
    const found = vars.find((v) => v.key === name && v.enabled)
    if (found) return found.value
    if (!missing.includes(name)) missing.push(name)
    return match
  })
  return { text: result, missing }
}
