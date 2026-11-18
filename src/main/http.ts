import { buildUrl } from '../shared/url'
import { substitute } from '../shared/variables'
import type { KeyValue, RequestDoc, SendResult } from '../shared/types'

const MAX_BODY_BYTES = 5 * 1024 * 1024

function enabledRows(rows: KeyValue[]): KeyValue[] {
  return rows.filter((r) => r.enabled && r.key !== '')
}

export function findMissingVariables(doc: RequestDoc, variables: KeyValue[]): string[] {
  const texts = [doc.url]
  for (const r of enabledRows(doc.params)) texts.push(r.key, r.value)
  for (const r of enabledRows(doc.headers)) texts.push(r.key, r.value)
  if (doc.bodyType !== 'none') texts.push(doc.body)
  const names = new Set<string>()
  for (const t of texts) for (const m of substitute(t, variables).missing) names.add(m)
  return [...names]
}

function isJsonText(text: string): boolean {
  if (text.trim() === '') return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export async function sendRequest(
  doc: RequestDoc,
  variables: KeyValue[],
  signal?: AbortSignal,
  timeoutMs = 30000
): Promise<SendResult> {
  const sub = (t: string): string => substitute(t, variables).text
  const controller = new AbortController()
  let timedOut = false
  const onAbort = (): void => controller.abort()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  try {
    if (signal?.aborted) return { ok: false, kind: 'cancelled', error: 'Request cancelled' }

    let url: string
    try {
      const params = enabledRows(doc.params).map((p) => ({ ...p, key: sub(p.key), value: sub(p.value) }))
      url = buildUrl(sub(doc.url), params)
    } catch {
      return { ok: false, kind: 'invalid-url', error: 'Invalid URL' }
    }

    const headers = new Headers()
    for (const h of enabledRows(doc.headers)) {
      const key = sub(h.key).trim()
      try {
        headers.append(key, sub(h.value))
      } catch {
        return { ok: false, kind: 'invalid-header', error: `Invalid header: "${key}"` }
      }
    }

    const canHaveBody = doc.method !== 'GET' && doc.method !== 'HEAD' && doc.bodyType !== 'none'
    if (canHaveBody && !headers.has('content-type')) {
      headers.set('content-type', doc.bodyType === 'json' ? 'application/json' : 'text/plain')
    }

    const start = performance.now()
    const res = await fetch(url, {
      method: doc.method,
      headers,
      body: canHaveBody ? sub(doc.body) : undefined,
      signal: controller.signal
    })

    const chunks: Uint8Array[] = []
    let counted = 0
    let truncated = false
    if (doc.method !== 'HEAD' && res.body) {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const room = MAX_BODY_BYTES - counted
        if (value.byteLength > room) {
          chunks.push(value.subarray(0, room))
          counted += room
          truncated = true
          await reader.cancel()
          break
        }
        chunks.push(value)
        counted += value.byteLength
      }
    }
    const durationMs = Math.max(performance.now() - start, 0.001)

    const text = new TextDecoder('utf-8').decode(Buffer.concat(chunks))
    // sizeBytes: for a truncated body, the content-length the server sent (ignored when compressed, since
    // it counts the compressed bytes) but never less than what was actually read.
    const declared = res.headers.has('content-encoding') ? 0 : Number(res.headers.get('content-length'))
    const sizeBytes = truncated && Number.isFinite(declared) ? Math.max(declared, counted) : counted

    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      durationMs,
      body: text,
      isJson: !truncated && isJsonText(text),
      truncated,
      sizeBytes
    }
  } catch (e) {
    if (timedOut) return { ok: false, kind: 'timeout', error: `Timed out after ${timeoutMs} ms` }
    if (controller.signal.aborted) return { ok: false, kind: 'cancelled', error: 'Request cancelled' }
    return { ok: false, kind: 'network', error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
