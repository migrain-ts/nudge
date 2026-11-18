import { gzipSync } from 'node:zlib'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { KeyValue, RequestDoc } from '../shared/types'
import { findMissingVariables, sendRequest } from './http'

let server: Server
let base: string
const BIG = 5 * 1024 * 1024 + 1000

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/json') {
      res.setHeader('content-type', 'application/json')
      res.end('{"a":1}')
    } else if (url.pathname === '/echo') {
      const body = await readBody(req)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, headers: req.headers, body }))
    } else if (url.pathname === '/204') {
      res.statusCode = 204
      res.end()
    } else if (url.pathname === '/html') {
      res.setHeader('content-type', 'text/html')
      res.end('<h1>hi</h1>')
    } else if (url.pathname === '/big') {
      res.setHeader('content-type', 'application/json')
      res.end(Buffer.alloc(BIG, 'a'))
    } else if (url.pathname === '/gzip-big') {
      const zipped = gzipSync(Buffer.alloc(8 * 1024 * 1024, 'a'))
      res.setHeader('content-type', 'text/plain')
      res.setHeader('content-encoding', 'gzip')
      res.setHeader('content-length', zipped.length)
      res.end(zipped)
    } else if (url.pathname === '/redirect') {
      res.statusCode = 302
      res.setHeader('location', '/json')
      res.end()
    } else if (url.pathname === '/slow') {
      setTimeout(() => res.end('late'), 1000)
    } else {
      res.statusCode = 404
      res.end('nope')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
})

const kv = (key: string, value: string, enabled = true): KeyValue => ({ key, value, enabled })
const doc = (o: Partial<RequestDoc>): RequestDoc => ({
  name: 't',
  method: 'GET',
  url: base + '/json',
  params: [],
  headers: [],
  bodyType: 'none',
  body: '',
  ...o
})

describe('sendRequest', () => {
  it('simple GET', async () => {
    const r = await sendRequest(doc({}), [])
    expect(r).toMatchObject({ ok: true, status: 200, isJson: true, truncated: false, body: '{"a":1}' })
    if (r.ok) expect(r.durationMs).toBeGreaterThan(0)
  })

  it('POST json sends body and default content-type', async () => {
    const r = await sendRequest(doc({ method: 'POST', url: base + '/echo', bodyType: 'json', body: '{"x":1}' }), [])
    if (!r.ok) throw new Error('fail')
    const echo = JSON.parse(r.body)
    expect(echo.body).toBe('{"x":1}')
    expect(echo.headers['content-type']).toBe('application/json')
  })

  it('keeps user content-type (case-insensitive)', async () => {
    const r = await sendRequest(
      doc({ method: 'POST', url: base + '/echo', bodyType: 'json', body: '{}', headers: [kv('Content-Type', 'application/vnd.x+json')] }),
      []
    )
    if (!r.ok) throw new Error('fail')
    expect(JSON.parse(r.body).headers['content-type']).toBe('application/vnd.x+json')
  })

  it('text body defaults to text/plain', async () => {
    const r = await sendRequest(doc({ method: 'PUT', url: base + '/echo', bodyType: 'text', body: 'hello' }), [])
    if (!r.ok) throw new Error('fail')
    expect(JSON.parse(r.body).headers['content-type']).toBe('text/plain')
  })

  it('GET never sends a body', async () => {
    const r = await sendRequest(doc({ url: base + '/echo', bodyType: 'json', body: '{"x":1}' }), [])
    if (!r.ok) throw new Error('fail')
    expect(JSON.parse(r.body).body).toBe('')
  })

  it('skips disabled headers and params', async () => {
    const r = await sendRequest(
      doc({ url: base + '/echo', headers: [kv('x-off', '1', false), kv('x-on', '2')], params: [kv('p', '1', false)] }),
      []
    )
    if (!r.ok) throw new Error('fail')
    const echo = JSON.parse(r.body)
    expect(echo.headers['x-off']).toBeUndefined()
    expect(echo.headers['x-on']).toBe('2')
  })

  it('substitutes variables in url, params, headers and body', async () => {
    const vars = [kv('baseUrl', base), kv('tok', 'abc'), kv('v', 'val')]
    const r = await sendRequest(
      doc({
        method: 'POST',
        url: '{{baseUrl}}/echo',
        params: [kv('q', '{{v}}')],
        headers: [kv('x-token', '{{tok}}')],
        bodyType: 'text',
        body: 'b={{v}}'
      }),
      vars
    )
    if (!r.ok) throw new Error(JSON.stringify(r))
    const echo = JSON.parse(r.body)
    expect(echo.headers['x-token']).toBe('abc')
    expect(echo.body).toBe('b=val')
  })

  it('204 gives empty body', async () => {
    const r = await sendRequest(doc({ url: base + '/204' }), [])
    expect(r).toMatchObject({ ok: true, status: 204, body: '', isJson: false })
  })

  it('html is plain text, not json', async () => {
    const r = await sendRequest(doc({ url: base + '/html' }), [])
    expect(r).toMatchObject({ ok: true, body: '<h1>hi</h1>', isJson: false })
  })

  it('truncates bodies over 5 MiB', async () => {
    const r = await sendRequest(doc({ url: base + '/big' }), [])
    if (!r.ok) throw new Error('fail')
    expect(r.truncated).toBe(true)
    expect(r.isJson).toBe(false)
    expect(r.sizeBytes).toBe(BIG)
    expect(r.body.length).toBeLessThanOrEqual(5 * 1024 * 1024)
  })

  it('truncated gzip body: size is never below the bytes counted (content-length is the compressed size)', async () => {
    const r = await sendRequest(doc({ url: base + '/gzip-big' }), [])
    if (!r.ok) throw new Error('fail')
    expect(r.truncated).toBe(true)
    expect(r.sizeBytes).toBeGreaterThanOrEqual(5 * 1024 * 1024)
  })

  it('invalid header names or values give a clear error instead of a raw TypeError', async () => {
    for (const key of ['{{tok}}', 'a b']) {
      const r = await sendRequest(doc({ headers: [kv(key, 'v')] }), [])
      expect(r).toEqual({ ok: false, kind: 'invalid-header', error: `Invalid header: "${key}"` })
    }
    const r = await sendRequest(doc({ headers: [kv('X-Name', 'héllo ✓')] }), [])
    expect(r).toMatchObject({ ok: false, kind: 'invalid-header', error: 'Invalid header: "X-Name"' })
  })

  it('trims header keys', async () => {
    const r = await sendRequest(doc({ url: base + '/echo', headers: [kv('  X-Pad  ', 'ok')] }), [])
    if (!r.ok) throw new Error('fail')
    expect(JSON.parse(r.body).headers['x-pad']).toBe('ok')
  })

  it('follows redirects', async () => {
    const r = await sendRequest(doc({ url: base + '/redirect' }), [])
    expect(r).toMatchObject({ ok: true, status: 200, body: '{"a":1}' })
  })

  it('invalid url', async () => {
    expect(await sendRequest(doc({ url: 'not a url' }), [])).toMatchObject({ ok: false, kind: 'invalid-url' })
  })

  it('network error on closed port', async () => {
    expect(await sendRequest(doc({ url: 'http://127.0.0.1:1/' }), [])).toMatchObject({ ok: false, kind: 'network' })
  })

  it('timeout', async () => {
    expect(await sendRequest(doc({ url: base + '/slow' }), [], undefined, 50)).toMatchObject({ ok: false, kind: 'timeout' })
  })

  it('cancelled', async () => {
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 30)
    expect(await sendRequest(doc({ url: base + '/slow' }), [], ac.signal)).toMatchObject({ ok: false, kind: 'cancelled' })
  })

  it('already-aborted signal is cancelled', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await sendRequest(doc({ url: base + '/json' }), [], ac.signal)).toMatchObject({ ok: false, kind: 'cancelled' })
  })
})

describe('findMissingVariables', () => {
  it('lists unique names across url, params, headers, body', () => {
    const d = doc({
      url: '{{a}}/x',
      params: [kv('{{b}}', '{{a}}')],
      headers: [kv('h', '{{c}}')],
      body: '{{d}} {{b}}',
      bodyType: 'text'
    })
    expect(findMissingVariables(d, [kv('c', '1')]).sort()).toEqual(['a', 'b', 'd'])
  })
})
