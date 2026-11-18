const FORBIDDEN = /[\\/:*?"<>|\x00-\x1f]/g
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

// Filesystems cap a name at 255 bytes; keep room for ".json" and a " N" uniqueness suffix.
const MAX_BYTES = 200
const ENC = new TextEncoder()

function truncateBytes(s: string, max: number): string {
  let out = ''
  let bytes = 0
  for (const ch of s) {
    bytes += ENC.encode(ch).length
    if (bytes > max) break
    out += ch
  }
  return out
}

export function safeFileName(name: string, taken: string[]): string {
  let base = truncateBytes(name.replace(FORBIDDEN, '-').trim(), MAX_BYTES).replace(/[. ]+$/, '')
  if (base === '') base = 'untitled'

  const dot = base.indexOf('.')
  const first = dot === -1 ? base : base.slice(0, dot)
  if (RESERVED.test(first)) base = `${first}-${base.slice(first.length)}`

  const takenLower = new Set(taken.map((t) => t.toLowerCase()))
  let candidate = base
  let n = 2
  while (takenLower.has(candidate.toLowerCase())) {
    candidate = `${base} ${n}`
    n++
  }
  return candidate
}
