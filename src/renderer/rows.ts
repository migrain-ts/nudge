import { chunkLine, jsonLines, tokenizeJson, type Token } from './json'

export const MAX_PIECE = 2000
export const ROW_BUDGET = 500

export type Row = { tokens: Token[] }

function* plainLines(text: string): Generator<string> {
  let i = 0
  for (;;) {
    const j = text.indexOf('\n', i)
    if (j < 0) { yield text.slice(i); return }
    yield text.slice(i, j)
    i = j + 1
  }
}

/**
 * Lazily turns a body into display rows. A row is one line; a line longer than MAX_PIECE is split into
 * plain text rows of at most MAX_PIECE chars (never one multi-megabyte node), one budget unit each.
 */
export function createRowSource(body: string, json: boolean) {
  let it: Iterator<string> = json ? jsonLines(body) : plainLines(body)
  let started = false
  let done = false
  // pieces of a long line wait here so a single huge line is revealed progressively too
  const pending: Row[] = []
  const toRows = (line: string): Row[] =>
    line.length <= MAX_PIECE
      ? [{ tokens: json ? tokenizeJson(line)[0] : [{ text: line, kind: 'plain' }] }]
      : chunkLine(line, MAX_PIECE).map((text) => ({ tokens: [{ text, kind: 'plain' as const }] }))
  return {
    get done() { return done && pending.length === 0 },
    take(budget = ROW_BUDGET): Row[] {
      const rows: Row[] = []
      while (rows.length < budget) {
        const p = pending.shift()
        if (p) { rows.push(p); continue }
        if (done) break
        let r: IteratorResult<string>
        try {
          r = it.next()
        } catch {
          if (!started && json) { it = plainLines(body); json = false; continue } // not JSON after all: plain text
          done = true
          break
        }
        started = true
        if (r.done) { done = true; break }
        pending.push(...toRows(r.value))
      }
      return rows
    }
  }
}

/** Source + first batch built together, so a double-invoked state initializer (StrictMode) never splits them. */
export function initRows(body: string, json: boolean) {
  const src = createRowSource(body, json)
  return { src, rows: src.take(ROW_BUDGET) }
}
