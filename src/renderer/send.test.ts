import { describe, expect, it, vi } from 'vitest'
import type { RequestDoc, SendResult, WorkspaceTree } from '../shared/types'
import { createSender } from './send'
import { activeVariables, initialState, reducer, type Action, type State } from './store'

const doc: RequestDoc = { name: 'a', method: 'GET', url: 'http://x/{{v}}', params: [], headers: [], bodyType: 'none', body: '' }
const okRes: SendResult = { ok: true, status: 200, statusText: 'OK', durationMs: 5, body: '{}', isJson: true, truncated: false, sizeBytes: 2 }
const tree = (active: string | null): WorkspaceTree => ({
  name: 'w', folders: [], warnings: [], activeEnvironment: active,
  environments: [{ name: 'dev', variables: [{ key: 'v', value: '1', enabled: true }] }]
})

function setup(send: (id: string) => Promise<SendResult>, missing: string[] = []) {
  let state: State = { ...initialState, draft: doc, selected: { dir: 'd', file: 'f' }, draftId: 1 }
  const dispatch = (a: Action) => { state = reducer(state, a) }
  const api = {
    send: vi.fn((_d: RequestDoc, _v: unknown, id: string) => send(id)),
    cancel: vi.fn(async () => {}),
    missingVariables: vi.fn(async () => missing)
  }
  const flush = vi.fn(async () => {})
  const onMissing = vi.fn()
  let n = 0
  const sender = createSender({ api, getState: () => state, dispatch, flush, onMissing, newId: () => `id${++n}` })
  return { sender, api, flush, onMissing, get: () => state, set: (s: State) => { state = s } }
}

describe('activeVariables', () => {
  it('is empty without tree or active env, else the env variables', () => {
    expect(activeVariables(initialState)).toEqual([])
    expect(activeVariables({ ...initialState, tree: tree(null) })).toEqual([])
    expect(activeVariables({ ...initialState, tree: tree('dev') })).toHaveLength(1)
  })
})

describe('createSender', () => {
  it('flushes, sets sending, stores the result, clears sending', async () => {
    const t = setup(() => new Promise((r) => setTimeout(() => r(okRes), 5)))
    const p = t.sender.send()
    expect(t.get().sending).toBe(true) // claimed synchronously
    await p
    expect(t.flush).toHaveBeenCalled()
    expect(t.api.send.mock.calls[0][2]).toBe('id1')
    expect(t.get().response).toEqual(okRes)
    expect(t.get().sending).toBe(false)
  })
  it('reports missing variables but still sends', async () => {
    const t = setup(async () => okRes, ['token'])
    await t.sender.send()
    expect(t.onMissing).toHaveBeenLastCalledWith(['token'])
    expect(t.get().response).toEqual(okRes)
  })
  it('ignores a result when the selected request changed', async () => {
    let release!: (r: SendResult) => void
    const t = setup(() => new Promise((r) => { release = r }))
    const p = t.sender.send()
    await new Promise((r) => setTimeout(r))
    t.set({ ...t.get(), draftId: 2, sending: false })
    release(okRes)
    await p
    expect(t.get().response).toBeNull()
  })
  it('a stale earlier result does not overwrite or clear a newer send', async () => {
    const rel: Array<(r: SendResult) => void> = []
    const t = setup(() => new Promise((r) => { rel.push(r) }))
    const p1 = t.sender.send()
    await new Promise((r) => setTimeout(r))
    t.sender.abandon()
    const p2 = t.sender.send()
    await new Promise((r) => setTimeout(r))
    rel[0]({ ok: true, status: 500, statusText: 'old', durationMs: 1, body: '', isJson: false, truncated: false, sizeBytes: 0 })
    await p1
    expect(t.get().response).toBeNull()
    expect(t.get().sending).toBe(true)
    rel[1](okRes)
    await p2
    expect(t.get().response).toEqual(okRes)
    expect(t.get().sending).toBe(false)
  })
  it('two back-to-back send() calls produce exactly one api.send', async () => {
    const t = setup(async () => okRes)
    const a = t.sender.send()
    const b = t.sender.send()
    await Promise.all([a, b])
    expect(t.api.send).toHaveBeenCalledTimes(1)
    expect(t.flush).toHaveBeenCalledTimes(1)
  })
  it('cancel while the flush is pending: api.send never called, sending cleared, cancelled shown', async () => {
    let release!: () => void
    const t = setup(async () => okRes)
    const gate = new Promise<void>((r) => { release = r })
    const sender = createSender({ variables: activeVariables, api: t.api, getState: t.get, dispatch: (a) => t.set(reducer(t.get(), a)), flush: () => gate, onMissing: t.onMissing, newId: () => 'z' })
    const p = sender.send()
    sender.cancel()
    release()
    await p
    expect(t.api.send).not.toHaveBeenCalled()
    expect(t.get().sending).toBe(false)
    expect(t.get().response).toMatchObject({ ok: false, kind: 'cancelled' })
  })
  it('abandon while the flush is pending: no send, nothing shown', async () => {
    let release!: () => void
    const t = setup(async () => okRes)
    const gate = new Promise<void>((r) => { release = r })
    const sender = createSender({ variables: activeVariables, api: t.api, getState: t.get, dispatch: (a) => t.set(reducer(t.get(), a)), flush: () => gate, onMissing: t.onMissing, newId: () => 'z' })
    const p = sender.send()
    sender.abandon()
    release()
    await p
    expect(t.api.send).not.toHaveBeenCalled()
    expect(t.get().response).toBeNull()
  })
  it('a late missingVariables answer after abandon does not show a banner', async () => {
    let answer!: (n: string[]) => void
    const t = setup(async () => okRes)
    t.api.missingVariables.mockImplementation(() => new Promise<string[]>((r) => { answer = r }))
    const p = t.sender.send()
    await new Promise((r) => setTimeout(r))
    expect(t.api.send).toHaveBeenCalledTimes(1) // not blocked by the pending check
    t.sender.abandon()
    answer(['x'])
    await p
    await new Promise((r) => setTimeout(r))
    expect(t.onMissing).not.toHaveBeenCalled()
  })
  it('a synchronously throwing missingVariables does not block the send', async () => {
    const t = setup(async () => okRes)
    t.api.missingVariables.mockImplementation(() => { throw new Error('sync boom') })
    await t.sender.send()
    expect(t.api.send).toHaveBeenCalledTimes(1)
    expect(t.get().response).toEqual(okRes)
    expect(t.get().sending).toBe(false)
  })
  it('ignores send while one is in flight; cancel calls api.cancel with the id', async () => {
    let release!: (r: SendResult) => void
    const t = setup(() => new Promise((r) => { release = r }))
    const p = t.sender.send()
    await new Promise((r) => setTimeout(r))
    await t.sender.send()
    expect(t.api.send).toHaveBeenCalledTimes(1)
    t.sender.cancel()
    expect(t.api.cancel).toHaveBeenCalledWith('id1')
    release({ ok: false, kind: 'cancelled', error: 'x' })
    await p
    expect(t.get().response).toEqual({ ok: false, kind: 'cancelled', error: 'x' })
    expect(t.get().sending).toBe(false)
  })
  it('turns a thrown api error into a network failure', async () => {
    const t = setup(async () => { throw new Error('boom') })
    await t.sender.send()
    expect(t.get().response).toMatchObject({ ok: false, kind: 'network' })
    expect(t.get().sending).toBe(false)
  })
  it('deleting the selected request resets sending and response', () => {
    const s = reducer(
      { ...initialState, tree: { ...tree(null), folders: [{ dir: 'd', requests: [{ file: 'f', doc }] }] }, selected: { dir: 'd', file: 'f' }, draft: doc, sending: true, response: okRes },
      { type: 'treeRefreshed', tree: { ...tree(null), folders: [{ dir: 'd', requests: [] }] } }
    )
    expect(s.selected).toBeNull()
    expect(s.sending).toBe(false)
    expect(s.response).toBeNull()
  })
  it('selecting another request resets sending', () => {
    const s = reducer({ ...initialState, tree: { ...tree(null), folders: [{ dir: 'd', requests: [{ file: 'f', doc }] }] }, sending: true }, { type: 'select', dir: 'd', file: 'f' })
    expect(s.sending).toBe(false)
  })
})
