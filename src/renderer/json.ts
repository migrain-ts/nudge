export type Token = { text: string; kind: 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'plain' }

const NUM = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/
const isWs = (c: number) => c === 32 || c === 10 || c === 13 || c === 9
const isDelim = (c: number) => isWs(c) || c === 44 || c === 58 || c === 93 || c === 125 || c === 91 || c === 123 || c === 34

/**
 * Single-pass pretty printer over the RAW text: keeps the original literals (keys, strings, numbers).
 * Lazy: pulling N lines only scans what those lines need. Throws SyntaxError on invalid JSON.
 */
export function* jsonLines(raw: string): Generator<string, void, undefined> {
  const stack: string[] = []
  const n = raw.length
  let i = 0
  let expect: 'value' | 'valueOrEnd' | 'key' | 'keyOrEnd' | 'colon' | 'commaOrEnd' = 'value'
  let line = ''
  let afterColon = false
  const bad = (): never => { throw new SyntaxError(`Invalid JSON at position ${i}`) }
  const ind = () => '  '.repeat(stack.length)
  const readString = (): string => {
    const start = i++
    while (i < n) {
      const c = raw.charCodeAt(i)
      if (c === 92) i += 2
      else if (c === 34) return raw.slice(start, ++i)
      else i++
    }
    return bad()
  }
  for (;;) {
    while (i < n && isWs(raw.charCodeAt(i))) i++
    if (i >= n) break
    const c = raw[i]
    const top = stack[stack.length - 1]
    if (expect === 'colon') {
      if (c !== ':') bad()
      line += ': '; i++; expect = 'value'; afterColon = true
      continue
    }
    if (expect === 'commaOrEnd') {
      if (top === undefined) bad()
      if (c === ',') {
        line += ','; yield line; line = ''; i++
        expect = top === '{' ? 'key' : 'value'
        continue
      }
      if (!((c === '}' && top === '{') || (c === ']' && top === '['))) bad()
      yield line
      stack.pop(); line = ind() + c; i++
      continue
    }
    if (expect === 'key' || expect === 'keyOrEnd') {
      if (c === '}' && expect === 'keyOrEnd') { line += c; stack.pop(); i++; expect = 'commaOrEnd'; continue }
      if (c !== '"') bad()
      if (line !== '') { yield line; line = '' }
      line = ind() + readString()
      expect = 'colon'
      continue
    }
    // value / valueOrEnd
    if (c === ']' && expect === 'valueOrEnd') { line += c; stack.pop(); i++; expect = 'commaOrEnd'; continue }
    if (!afterColon) {
      if (line !== '') { yield line; line = '' }
      line = ind()
    }
    afterColon = false
    if (c === '{' || c === '[') {
      line += c; stack.push(c); i++
      expect = c === '{' ? 'keyOrEnd' : 'valueOrEnd'
    } else {
      if (c === '"') line += readString()
      else {
        const start = i
        while (i < n && !isDelim(raw.charCodeAt(i))) i++
        const lit = raw.slice(start, i)
        if (!NUM.test(lit)) bad()
        line += lit
      }
      expect = 'commaOrEnd'
    }
  }
  if (stack.length > 0 || expect !== 'commaOrEnd') bad()
  yield line
}

export function prettyJson(raw: string): string | null {
  try {
    return [...jsonLines(raw)].join('\n')
  } catch {
    return null
  }
}

/** Split a long line into pieces of at most `max` chars so no DOM node holds megabytes. */
export function chunkLine(line: string, max: number): string[] {
  if (line.length <= max) return [line]
  const out: string[] = []
  for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max))
  return out
}

// string | number | true/false | null | anything else (punctuation, whitespace, garbage)
const TOKEN = /("(?:[^"\\]|\\.)*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([^"\d\-tfn]+|.)/g

function tokenizeLine(line: string): Token[] {
  const out: Token[] = []
  for (const m of line.matchAll(TOKEN)) {
    const [text, str, num, bool, nul] = m
    if (str !== undefined) {
      const key = /^\s*:/.test(line.slice(m.index + text.length))
      out.push({ text, kind: key ? 'key' : 'string' })
    } else if (num !== undefined) out.push({ text, kind: 'number' })
    else if (bool !== undefined) out.push({ text, kind: 'bool' })
    else if (nul !== undefined) out.push({ text, kind: 'null' })
    else out.push({ text, kind: 'punct' })
  }
  return out
}

/** One token list per line of pretty-printed JSON (strings never span lines). */
export function tokenizeJson(pretty: string): Token[][] {
  return pretty.split('\n').map(tokenizeLine)
}
