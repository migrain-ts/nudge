import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutosaver, leaveProject, createSelectedSave, ownedSelected, resaveDoc, persistUnsaved } from './useAutosave'
import { reducer, type State } from './store'
import type { RequestDoc, WorkspaceTree } from '../shared/types'

const d = (url: string): RequestDoc => ({ name: 'n', method: 'GET', url, params: [], headers: [], bodyType: 'none', body: '' })

describe('createAutosaver', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('debounces: three rapid schedules save once with the last doc', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(save, 500)
    a.schedule(d('1')); vi.advanceTimersByTime(100)
    a.schedule(d('2')); vi.advanceTimersByTime(100)
    a.schedule(d('3'))
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(d('3'))
  })
  it('flush saves immediately and cancels the timer', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(save, 500)
    a.schedule(d('1'))
    await a.flush()
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })
  it('flush with nothing pending does nothing', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await createAutosaver(save).flush()
    expect(save).not.toHaveBeenCalled()
  })
  it('cancel drops the pending doc', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(save, 500)
    a.schedule(d('1')); a.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })
})

describe('autosave target is resolved at flush time', () => {
  const tree = (file: string): WorkspaceTree => ({
    name: 'P', folders: [{ dir: 'a', requests: [{ file, doc: d('x') }] }], environments: [], activeEnvironment: null, warnings: []
  })
  const base: State = { tree: tree('old.json'), selected: { dir: 'a', file: 'old.json' }, draft: d('x'), response: null, sending: false, draftId: 0, unsaved: {}, session: 1 }

  it('edit then rename re-points selected: flush writes to the NEW path', async () => {
    let state = base
    const write = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(createSelectedSave(() => state.selected, write, () => {}), 500)
    a.schedule(d('edited'))
    state = reducer(state, { type: 'treeRefreshed', tree: tree('new.json'), reselect: { dir: 'a', file: 'new.json' } })
    await a.flush()
    expect(write).toHaveBeenCalledWith('a', 'new.json', d('edited'))
  })
  it('edit then selection cleared: flush writes nothing', async () => {
    let state = base
    const write = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(createSelectedSave(() => state.selected, write, () => {}), 500)
    a.schedule(d('edited'))
    state = reducer(state, { type: 'treeRefreshed', tree: { ...tree('x'), folders: [{ dir: 'a', requests: [] }] } })
    expect(state.selected).toBeNull()
    await a.flush()
    expect(write).not.toHaveBeenCalled()
  })
})

describe('docSaved / select immutability', () => {
  const doc = { ...d('x'), params: [{ key: 'a', value: '1', enabled: true }] }
  const tree: WorkspaceTree = { name: 'P', folders: [{ dir: 'a', requests: [{ file: 'r.json', doc }] }], environments: [], activeEnvironment: null, warnings: [] }
  it('docSaved replaces one tree entry without touching draft', () => {
    const draft = { ...doc, url: 'typing' }
    const s0: State = { tree, selected: { dir: 'a', file: 'r.json' }, draft, response: null, sending: false, draftId: 0, unsaved: {}, session: 1 }
    const s = reducer(s0, { type: 'docSaved', dir: 'a', file: 'r.json', doc: { ...doc, method: 'POST' } })
    expect(s.tree!.folders[0].requests[0].doc.method).toBe('POST')
    expect(s.draft).toBe(draft)
  })
  it('select does not share params/headers arrays with the tree', () => {
    const s = reducer({ tree, selected: null, draft: null, response: null, sending: false, draftId: 0, unsaved: {}, session: 1 }, { type: 'select', dir: 'a', file: 'r.json' })
    expect(s.draft!.params).not.toBe(doc.params)
    expect(s.draft!.params[0]).not.toBe(doc.params[0])
  })
})

describe('autosaver races and retry', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const tree = (file: string): WorkspaceTree => ({
    name: 'P', folders: [{ dir: 'a', requests: [{ file, doc: d('x') }] }], environments: [], activeEnvironment: null, warnings: []
  })
  const base: State = { tree: tree('old.json'), selected: { dir: 'a', file: 'old.json' }, draft: d('x'), response: null, sending: false, draftId: 1, unsaved: {}, session: 1 }

  it('edit, flush, rename: nothing is written to the old path afterwards', async () => {
    let state = base
    const write = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(createSelectedSave(() => state.selected, write, () => {}), 500)
    a.schedule(d('e1'))
    await a.flush()
    const release = a.hold()
    a.schedule(d('e2')) // keystroke during the rename: must not fire before re-point
    await vi.advanceTimersByTimeAsync(2000)
    expect(write).toHaveBeenCalledTimes(1)
    state = reducer(state, { type: 'treeRefreshed', tree: tree('new.json'), reselect: { dir: 'a', file: 'new.json' } })
    release()
    await vi.advanceTimersByTimeAsync(600)
    expect(write.mock.calls.map((c) => c[1])).toEqual(['old.json', 'new.json'])
  })
  it('delete: cancel drops the pending save, nothing written', async () => {
    let state = base
    const write = vi.fn().mockResolvedValue(undefined)
    const a = createAutosaver(createSelectedSave(() => state.selected, write, () => {}), 500)
    a.schedule(d('e'))
    a.cancel()
    state = reducer(state, { type: 'treeRefreshed', tree: { ...tree('x'), folders: [{ dir: 'a', requests: [] }] } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).not.toHaveBeenCalled()
  })
  it('ownership: a pending doc of a request that is no longer the draft is dropped', () => {
    let id = 1
    const sel = { dir: 'a', file: 'r.json' }
    const get = ownedSelected(1, () => id, () => sel)
    expect(get()).toBe(sel)
    id = 2
    expect(get()).toBeNull()
  })
  it('failure keeps the doc pending and retries; success clears the failure', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk')).mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined)
    const results: boolean[] = []
    const a = createAutosaver(createSelectedSave(() => base.selected, write, (r) => results.push(r.ok)), 500)
    a.schedule(d('e'))
    await vi.advanceTimersByTimeAsync(500)
    expect(results).toEqual([false])
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(results).toEqual([false, false, true])
    expect(write).toHaveBeenLastCalledWith('a', 'old.json', d('e'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(write).toHaveBeenCalledTimes(3)
  })
  it('stops retrying after 5 failed attempts', async () => {
    const write = vi.fn().mockRejectedValue(new Error('disk'))
    const a = createAutosaver(createSelectedSave(() => base.selected, write, () => {}), 500)
    a.schedule(d('e'))
    await vi.advanceTimersByTimeAsync(60000)
    expect(write).toHaveBeenCalledTimes(5)
  })
  it('failed save + select another request: edited doc is still there when selecting back', () => {
    const doc2 = d('other')
    const t: WorkspaceTree = { ...tree('a.json'), folders: [{ dir: 'a', requests: [{ file: 'a.json', doc: d('x') }, { file: 'b.json', doc: doc2 }] }] }
    let s: State = { ...base, tree: t, selected: { dir: 'a', file: 'a.json' } }
    s = reducer(s, { type: 'docSaved', dir: 'a', file: 'a.json', doc: d('edited'), failed: true })
    expect(s.unsaved).toEqual({ 'a/a.json': true })
    s = reducer(s, { type: 'select', dir: 'a', file: 'b.json' })
    s = reducer(s, { type: 'select', dir: 'a', file: 'a.json' })
    expect(s.draft!.url).toBe('edited')
  })
  it('draftId changes on select/clear but not on a rename re-point', () => {
    let s = reducer({ ...base, draftId: 5 }, { type: 'treeRefreshed', tree: tree('new.json'), reselect: { dir: 'a', file: 'new.json' } })
    expect(s.draftId).toBe(5)
    s = reducer(s, { type: 'treeRefreshed', tree: { ...tree('x'), folders: [{ dir: 'a', requests: [] }] } })
    expect(s.draftId).not.toBe(5)
  })
})

describe('unsaved requests are tracked per target', () => {
  const t: WorkspaceTree = {
    name: 'P', environments: [], activeEnvironment: null, warnings: [],
    folders: [{ dir: 'a', requests: [{ file: 'a.json', doc: d('x') }, { file: 'b.json', doc: d('y') }] }]
  }
  const s0: State = { tree: t, selected: { dir: 'a', file: 'a.json' }, draft: d('x'), response: null, sending: false, draftId: 1, unsaved: {}, session: 1 }
  const failA = (s: State) => reducer(s, { type: 'docSaved', dir: 'a', file: 'a.json', doc: d('edited'), failed: true })

  it('a successful save on B does not clear A; re-selecting A re-schedules its edited doc; A saved clears only A', () => {
    let s = failA(s0)
    s = reducer(s, { type: 'select', dir: 'a', file: 'b.json' })
    expect(resaveDoc(s)).toBeNull()
    s = reducer(s, { type: 'docSaved', dir: 'a', file: 'b.json', doc: d('y2') })
    expect(s.unsaved).toEqual({ 'a/a.json': true })
    s = reducer(s, { type: 'select', dir: 'a', file: 'a.json' })
    expect(resaveDoc(s)?.url).toBe('edited')
    s = reducer(s, { type: 'docSaved', dir: 'a', file: 'b.json', doc: d('y3') })
    expect(s.unsaved).toEqual({ 'a/a.json': true })
    s = reducer(s, { type: 'docSaved', dir: 'a', file: 'a.json', doc: d('edited') })
    expect(s.unsaved).toEqual({})
  })
  it('rename/move re-points the key; delete removes it', () => {
    const s = failA(s0)
    const moved: WorkspaceTree = { ...t, folders: [{ dir: 'c', requests: [{ file: 'n.json', doc: d('x') }] }, { dir: 'a', requests: [{ file: 'b.json', doc: d('y') }] }] }
    const r = reducer(s, { type: 'treeRefreshed', tree: moved, reselect: { dir: 'c', file: 'n.json' } })
    expect(r.unsaved).toEqual({ 'c/n.json': true })
    const gone: WorkspaceTree = { ...t, folders: [{ dir: 'a', requests: [{ file: 'b.json', doc: d('y') }] }] }
    expect(reducer(s, { type: 'treeRefreshed', tree: gone }).unsaved).toEqual({})
  })
})

describe('non-selected unsaved requests and sidebar rename/move', () => {
  const t: WorkspaceTree = {
    name: 'P', environments: [], activeEnvironment: null, warnings: [],
    folders: [{ dir: 'a', requests: [{ file: 'a.json', doc: d('x') }, { file: 'b.json', doc: d('y') }] }]
  }
  const st: State = { tree: t, selected: { dir: 'a', file: 'a.json' }, draft: d('x'), response: null, sending: false, draftId: 1, unsaved: { 'a/b.json': true }, session: 1 }

  it('treeRefreshed re-points the key of a renamed NON-selected request', () => {
    const next: WorkspaceTree = { ...t, folders: [{ dir: 'a', requests: [{ file: 'a.json', doc: d('x') }, { file: 'renamed.json', doc: d('y') }] }] }
    const r = reducer(st, { type: 'treeRefreshed', tree: next, moved: { from: { dir: 'a', file: 'b.json' }, to: { dir: 'a', file: 'renamed.json' } } })
    expect(r.unsaved).toEqual({ 'a/renamed.json': true })
    expect(r.selected).toEqual({ dir: 'a', file: 'a.json' })
  })
  it('persistUnsaved: success saves the doc and reports it; failure rejects', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    expect(await persistUnsaved({ b: true }, 'b', d('e'), save)).toBe(true)
    expect(save).toHaveBeenCalledWith(d('e'))
    expect(await persistUnsaved({}, 'b', d('e'), save)).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
    await expect(persistUnsaved({ b: true }, 'b', d('e'), vi.fn().mockRejectedValue(new Error('x')))).rejects.toThrow()
  })
})

describe('dirty / leaveProject', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('dirty is true while an edit is pending, including after a failed flush', async () => {
    const a = createAutosaver(vi.fn().mockRejectedValue(new Error('x')), 500)
    expect(a.dirty()).toBe(false)
    a.schedule(d('1'))
    expect(a.dirty()).toBe(true)
    await a.flush()
    expect(a.dirty()).toBe(true)
    a.cancel()
    expect(a.dirty()).toBe(false)
  })

  it('flushes BEFORE cancelling, then lets the caller switch', async () => {
    const calls: string[] = []
    const ctl = {
      flush: async () => { calls.push('flush') },
      cancel: () => { calls.push('cancel') },
      dirty: () => false
    }
    expect(await leaveProject(ctl, () => false, () => { calls.push('confirm'); return true })).toBe(true)
    expect(calls).toEqual(['flush', 'cancel'])
  })

  it('asks when edits could not be saved and keeps them if declined', async () => {
    const cancel = vi.fn()
    const ctl = { flush: async () => {}, cancel, dirty: () => true }
    expect(await leaveProject(ctl, () => false, () => false)).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
    expect(await leaveProject({ ...ctl, dirty: () => false }, () => true, () => true)).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reads the unsaved map AFTER the flush: cleared by the flush means no confirmation', async () => {
    let unsaved = true
    const confirmLeave = vi.fn(() => false)
    const ctl = { flush: async () => { unsaved = false }, cancel: vi.fn(), dirty: () => false }
    expect(await leaveProject(ctl, () => unsaved, confirmLeave)).toBe(true)
    expect(confirmLeave).not.toHaveBeenCalled()
  })

  it('still unsaved after the flush: asks', async () => {
    const confirmLeave = vi.fn(() => false)
    const ctl = { flush: async () => {}, cancel: vi.fn(), dirty: () => false }
    expect(await leaveProject(ctl, () => true, confirmLeave)).toBe(false)
    expect(confirmLeave).toHaveBeenCalledTimes(1)
  })

  it('works without an autosaver', async () => {
    expect(await leaveProject(null, () => false, () => false)).toBe(true)
  })
})

describe('flush and in-flight saves', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const deferred = () => {
    let resolve!: () => void, reject!: (e: Error) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('flush waits for a save already running (timer fired, nothing pending)', async () => {
    const w = deferred()
    const save = vi.fn().mockReturnValue(w.promise)
    const a = createAutosaver(save, 500)
    a.schedule(d('1'))
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    let done = false
    void a.flush().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(false)
    w.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush also writes an edit scheduled while a save was running, after it, never overlapping', async () => {
    const w = deferred()
    const save = vi.fn().mockReturnValueOnce(w.promise).mockResolvedValue(undefined)
    const a = createAutosaver(save, 500)
    a.schedule(d('1'))
    await vi.advanceTimersByTimeAsync(500)
    a.schedule(d('2'))
    let done = false
    void a.flush().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    w.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    expect(save.mock.calls.map((c) => c[0])).toEqual([d('1'), d('2')])
  })

  it('flush with nothing pending and nothing in flight is immediate', async () => {
    const a = createAutosaver(vi.fn().mockResolvedValue(undefined))
    let done = false
    void a.flush().then(() => { done = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(true)
  })

  it('a failing in-flight save does not hang flush', async () => {
    const w = deferred()
    const save = vi.fn().mockReturnValueOnce(w.promise).mockRejectedValue(new Error('x'))
    const a = createAutosaver(save, 500)
    a.schedule(d('1'))
    await vi.advanceTimersByTimeAsync(500)
    let done = false
    void a.flush().then(() => { done = true })
    w.reject(new Error('disk'))
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toBe(true)
    expect(a.dirty()).toBe(true)
  })
})
